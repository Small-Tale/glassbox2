use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use glassbox_comparison::GitReview;
use glassbox_model::feedback::AnchorSide;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tree_sitter::{Language, Parser};

use crate::review_files::{self, SelectedFile};

const MAX_TEXT_BYTES: usize = 256 * 1024;
const MAX_CANDIDATES: usize = 64;

#[derive(Deserialize)]
pub(crate) struct Lookup {
    selection: SelectedFile,
    side: AnchorSide,
    revision: String,
    symbol: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Resolution {
    Found { destination: Destination },
    Ambiguous,
    NotFound,
    Unsupported,
    Limit,
}

#[derive(Serialize)]
struct Destination {
    path: PathBuf,
    side: AnchorSide,
    revision: String,
    diff_revision: Option<String>,
    index: Option<usize>,
    line: usize,
    text: String,
}

pub(crate) async fn lookup(input: Lookup) -> Response {
    match tokio::task::spawn_blocking(move || resolve(input)).await {
        Ok(Ok(resolution)) => Json(resolution).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not look up the definition",
        )
            .into_response(),
    }
}

fn resolve(input: Lookup) -> Result<Resolution, (StatusCode, String)> {
    let Lookup {
        selection,
        side,
        revision,
        symbol,
    } = input;
    if !is_identifier(&symbol) {
        return Err((StatusCode::BAD_REQUEST, "Choose a symbol name.".into()));
    }
    if !matches!(selection.source, review_files::ReviewSource::Git { .. }) {
        return Ok(Resolution::Unsupported);
    }
    let bad_request = |error: io::Error| (StatusCode::BAD_REQUEST, error.to_string());
    let comparison = review_files::load(selection.source, None).map_err(bad_request)?;
    review_files::validate_selection(&comparison, selection.index, &selection.path).map_err(
        |_| {
            (
                StatusCode::CONFLICT,
                "The selected file has changed.".into(),
            )
        },
    )?;
    let hunks = comparison
        .text_hunks(selection.index)
        .map_err(bad_request)?;
    let actual = review_files::text_revision(&hunks).map_err(bad_request)?;
    if actual != revision {
        return Err((
            StatusCode::CONFLICT,
            "The selected diff has changed.".into(),
        ));
    }
    let Some(review) = comparison.git() else {
        return Ok(Resolution::Unsupported);
    };
    let mut result = search(review, selection.index, side, &symbol).map_err(bad_request)?;
    if let Resolution::Found { destination } = &mut result {
        destination.diff_revision = destination
            .index
            .and_then(|index| comparison.text_hunks(index).ok())
            .and_then(|hunks| review_files::text_revision(&hunks).ok());
    }
    Ok(result)
}

fn is_identifier(value: &str) -> bool {
    if value.len() > 128 {
        return false;
    }
    let mut characters = value.chars();
    let start = |character: char| character.is_alphabetic() || matches!(character, '_' | '$');
    characters.next().is_some_and(start)
        && characters.all(|character| start(character) || character.is_numeric())
}

#[derive(Clone, Copy)]
enum Syntax {
    Rust,
    TypeScript,
    Tsx,
}

impl Syntax {
    fn from_path(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()? {
            "rs" => Some(Self::Rust),
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            _ => None,
        }
    }

    fn language(self) -> Language {
        match self {
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        }
    }

    fn is_definition(self, kind: &str) -> bool {
        match self {
            Self::Rust => matches!(
                kind,
                "function_item"
                    | "function_signature_item"
                    | "struct_item"
                    | "enum_item"
                    | "union_item"
                    | "trait_item"
                    | "type_item"
                    | "const_item"
                    | "static_item"
                    | "mod_item"
                    | "macro_definition"
            ),
            Self::TypeScript | Self::Tsx => matches!(
                kind,
                "function_declaration"
                    | "generator_function_declaration"
                    | "class_declaration"
                    | "abstract_class_declaration"
                    | "interface_declaration"
                    | "type_alias_declaration"
                    | "enum_declaration"
                    | "variable_declarator"
                    | "method_definition"
                    | "internal_module"
            ),
        }
    }
}

fn definitions(
    parser: &mut Parser,
    syntax: Syntax,
    text: &str,
    symbol: &str,
) -> io::Result<Vec<usize>> {
    parser
        .set_language(&syntax.language())
        .map_err(io::Error::other)?;
    let tree = parser
        .parse(text, None)
        .ok_or_else(|| io::Error::other("Could not parse source text"))?;
    let mut lines = Vec::new();
    let mut nodes = vec![tree.root_node()];
    while let Some(node) = nodes.pop() {
        if let Some(name) = node.child_by_field_name("name").filter(|name| {
            syntax.is_definition(node.kind()) && name.utf8_text(text.as_bytes()) == Ok(symbol)
        }) {
            lines.push(name.start_position().row + 1);
        }
        nodes.extend(node.named_children(&mut node.walk()));
    }
    Ok(lines)
}

fn search(
    review: &GitReview,
    index: usize,
    side: AnchorSide,
    symbol: &str,
) -> io::Result<Resolution> {
    use glassbox_comparison::GitFileChange;
    let path_on_side = |change: &GitFileChange| match side {
        AnchorSide::Before => change.before_path.clone(),
        AnchorSide::After => change.after_path.clone(),
    };
    let Some(path) = review.changes.get(index).and_then(path_on_side) else {
        return Ok(Resolution::NotFound);
    };
    let Some(syntax) = Syntax::from_path(&path) else {
        return Ok(Resolution::Unsupported);
    };
    let extensions = match syntax {
        Syntax::Rust => &["*.rs"][..],
        Syntax::TypeScript | Syntax::Tsx => &["*.ts", "*.tsx", "*.mts", "*.cts"][..],
    };
    let mut parser = Parser::new();
    if let Some(resolved) = search_paths(
        &mut parser,
        review,
        side,
        symbol,
        [(path.clone(), Some(index))],
    )? {
        return Ok(resolved);
    }
    let relevant = review
        .changes
        .iter()
        .enumerate()
        .filter_map(|(index, change)| {
            let candidate = path_on_side(change)?;
            (candidate != path
                && extensions.iter().any(|pattern| {
                    candidate.extension().and_then(|ext| ext.to_str()) == pattern.strip_prefix("*.")
                }))
            .then_some((candidate, Some(index)))
        })
        .take(MAX_CANDIDATES + 1)
        .collect::<Vec<_>>();
    if relevant.len() > MAX_CANDIDATES {
        return Ok(Resolution::Limit);
    }
    let reviewed = relevant
        .iter()
        .map(|(path, _)| path.clone())
        .collect::<BTreeSet<_>>();
    if let Some(resolved) = search_paths(&mut parser, review, side, symbol, relevant)? {
        return Ok(resolved);
    }
    let paths = match review.matching_text_paths(side, symbol, extensions) {
        Ok(paths) => paths,
        Err(error) if error.kind() == io::ErrorKind::FileTooLarge => return Ok(Resolution::Limit),
        Err(error) => return Err(error),
    };
    let candidates = paths
        .into_iter()
        .filter(|candidate| *candidate != path && !reviewed.contains(candidate))
        .take(MAX_CANDIDATES + 1)
        .map(|path| (path, None))
        .collect::<Vec<_>>();
    if candidates.len() > MAX_CANDIDATES {
        return Ok(Resolution::Limit);
    }
    Ok(
        search_paths(&mut parser, review, side, symbol, candidates)?
            .unwrap_or(Resolution::NotFound),
    )
}

fn search_paths(
    parser: &mut Parser,
    review: &GitReview,
    side: AnchorSide,
    symbol: &str,
    candidates: impl IntoIterator<Item = (PathBuf, Option<usize>)>,
) -> io::Result<Option<Resolution>> {
    let mut found = None;
    for (path, index) in candidates {
        let Some(syntax) = Syntax::from_path(&path) else {
            continue;
        };
        let Some(text) = review.read_text_source(side, &path, MAX_TEXT_BYTES)? else {
            continue;
        };
        if !text.contains(symbol) {
            continue;
        }
        let lines = definitions(parser, syntax, &text, symbol)?;
        if lines.len() > 1 || (!lines.is_empty() && found.is_some()) {
            return Ok(Some(Resolution::Ambiguous));
        }
        if let Some(line) = lines.first() {
            let revision = format!("{:x}", Sha256::digest(text.as_bytes()));
            found = Some(Resolution::Found {
                destination: Destination {
                    path,
                    side,
                    revision,
                    diff_revision: None,
                    index,
                    line: *line,
                    text,
                },
            });
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_definition_names_and_lines_from_the_navigation_baseline() {
        let fixtures = [
            (
                Syntax::TypeScript,
                include_str!("../tests/fixtures/symbols.ts"),
                &[
                    ("ReviewTarget", 1),
                    ("SourceId", 2),
                    ("Mode", 3),
                    ("defaultMode", 4),
                    ("resolve", 5),
                    ("makeAnchor", 6),
                    ("History", 7),
                    ("current", 8),
                    ("goBack", 9),
                    ("splitDeclaration", 12),
                    ("example", 13),
                ][..],
            ),
            (
                Syntax::Rust,
                include_str!("../tests/fixtures/symbols.rs"),
                &[
                    ("Entry", 1),
                    ("Side", 2),
                    ("Revision", 3),
                    ("LIMIT", 4),
                    ("fast_lookup", 5),
                    ("fetch", 6),
                    ("position", 8),
                    ("split_declaration", 11),
                    ("EXAMPLE", 12),
                ][..],
            ),
        ];
        let mut parser = Parser::new();
        for (syntax, text, names) in fixtures {
            for (name, line) in names {
                assert_eq!(
                    definitions(&mut parser, syntax, text, name).unwrap(),
                    vec![*line],
                    "{name}"
                );
            }
            assert!(
                definitions(&mut parser, syntax, text, "phantom")
                    .unwrap()
                    .is_empty()
            );
        }
        assert_eq!(
            definitions(
                &mut parser,
                Syntax::Tsx,
                "export const View = () => <p>Hi</p>",
                "View"
            )
            .unwrap(),
            vec![1]
        );
        assert_eq!(
            definitions(
                &mut parser,
                Syntax::TypeScript,
                "class A { method() {} } class B { method() {} }",
                "method"
            )
            .unwrap(),
            vec![1, 1]
        );
    }
}
