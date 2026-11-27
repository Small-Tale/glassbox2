use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use glassbox_comparison::GitReview;
use glassbox_model::feedback::{AnchorSide, SourceLocation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tree_sitter::{Language, Node, Parser};

use crate::review_files::{self, GitMode, ReviewSource, SelectedFile};

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
pub(crate) struct Destination {
    path: PathBuf,
    side: AnchorSide,
    revision: String,
    diff_revision: Option<String>,
    index: Option<usize>,
    line: usize,
    text: String,
}

pub(crate) fn source_location(
    review: &GitReview,
    side: AnchorSide,
    location: &SourceLocation,
) -> Option<Destination> {
    if location.path.len() > 4096
        || location.path.contains(['\\', '\0'])
        || location
            .path
            .split('/')
            .any(|part| matches!(part, "" | "." | ".."))
        || location.path.as_bytes().get(1) == Some(&b':')
    {
        return None;
    }
    let path = PathBuf::from(&location.path);
    let text = review
        .read_tracked_text_source(side, &path, MAX_TEXT_BYTES)
        .ok()??;
    text.lines().nth(location.line.checked_sub(1)?)?;
    let revision = format!("{:x}", Sha256::digest(text.as_bytes()));
    let index = review.changes.iter().position(|change| {
        let path_on_side = match side {
            AnchorSide::Before => &change.before_path,
            AnchorSide::After => &change.after_path,
        };
        path_on_side.as_ref() == Some(&path)
    });
    Some(Destination {
        path,
        side,
        revision,
        diff_revision: None,
        index,
        line: location.line,
        text,
    })
}

/// A commit a provider may cite: 7 to 40 hex characters, never a revision expression or an option (HS2-B5K6GM).
pub(crate) fn cited_commit(commit: &str) -> Option<String> {
    ((7..=40).contains(&commit.len()) && commit.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| commit.to_ascii_lowercase())
}

/// Where a cited line is in `commit`, read from that commit's tree and checked like any source link.
pub(crate) fn commit_destination(
    directory: &Path,
    commit: &str,
    path: &str,
    line: usize,
) -> Result<Destination, (StatusCode, String)> {
    let commit = cited_commit(commit).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "A commit is 7 to 40 hexadecimal characters.".into(),
        )
    })?;
    let comparison = review_files::load(
        ReviewSource::Git {
            directory: directory.to_path_buf(),
            mode: GitMode::Commit { revision: commit },
        },
        None,
    )
    .map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            "The cited commit is not available in this repository.".into(),
        )
    })?;
    let unresolved = || {
        (
            StatusCode::NOT_FOUND,
            "The cited location does not exist in that commit.".to_owned(),
        )
    };
    let git = comparison.git().ok_or_else(unresolved)?;
    let location = SourceLocation {
        path: path.to_owned(),
        line,
        revision: None,
        commit: None,
    };
    let mut destination =
        source_location(git, AnchorSide::After, &location).ok_or_else(unresolved)?;
    destination.set_diff_revision(&comparison);
    Ok(destination)
}

#[derive(Deserialize)]
pub(crate) struct CommitLocation {
    directory: PathBuf,
    commit: String,
    path: String,
    line: usize,
}

/// `POST /api/v1/review/commit-location`: the validated destination a deep link names (HS2-B5K6GM).
pub(crate) async fn commit_location(input: CommitLocation) -> Response {
    let result = tokio::task::spawn_blocking(move || {
        commit_destination(&input.directory, &input.commit, &input.path, input.line)
    })
    .await;
    match result {
        Ok(Ok(destination)) => Json(destination).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub(crate) fn pin_location(
    review: &GitReview,
    side: AnchorSide,
    location: &mut SourceLocation,
) -> bool {
    location.revision =
        source_location(review, side, location).map(|destination| destination.revision);
    location.revision.is_some()
}

impl Destination {
    pub(crate) fn revision(&self) -> &str {
        &self.revision
    }

    pub(crate) fn set_diff_revision(&mut self, comparison: &review_files::Comparison) {
        self.diff_revision = self
            .index
            .and_then(|index| comparison.text_hunks(index).ok())
            .and_then(|hunks| review_files::text_revision(&hunks).ok());
    }
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

struct Checked {
    comparison: review_files::Comparison,
    index: usize,
}

/// Loads the selected comparison and confirms the file and the diff revision on screen are still current.
/// `None` means the source is not a Git comparison, which neither lookup supports.
fn check(selection: SelectedFile, revision: &str) -> Result<Option<Checked>, (StatusCode, String)> {
    if !matches!(selection.source, review_files::ReviewSource::Git { .. }) {
        return Ok(None);
    }
    let bad_request = |error: io::Error| (StatusCode::BAD_REQUEST, error.to_string());
    let SelectedFile {
        source,
        index,
        path,
    } = selection;
    let comparison = review_files::load(source, None).map_err(bad_request)?;
    review_files::validate_selection(&comparison, index, &path).map_err(|_| {
        (
            StatusCode::CONFLICT,
            "The selected file has changed.".into(),
        )
    })?;
    let hunks = comparison.text_hunks(index).map_err(bad_request)?;
    let actual = review_files::text_revision(&hunks).map_err(bad_request)?;
    if actual != revision {
        return Err((
            StatusCode::CONFLICT,
            "The selected diff has changed.".into(),
        ));
    }
    Ok(comparison
        .git()
        .is_some()
        .then_some(Checked { comparison, index }))
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
    let Some(checked) = check(selection, &revision)? else {
        return Ok(Resolution::Unsupported);
    };
    let Some(review) = checked.comparison.git() else {
        return Ok(Resolution::Unsupported);
    };
    let mut result = search(review, checked.index, side, &symbol)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    if let Resolution::Found { destination } = &mut result {
        destination.set_diff_revision(&checked.comparison);
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
    JavaScript,
    TypeScript,
    Tsx,
    Python,
}

impl Syntax {
    fn from_path(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()? {
            "rs" => Some(Self::Rust),
            "js" | "jsx" | "mjs" | "cjs" => Some(Self::JavaScript),
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "py" | "pyi" => Some(Self::Python),
            _ => None,
        }
    }

    fn language(self) -> Language {
        match self {
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
        }
    }

    fn path_patterns(self) -> &'static [&'static str] {
        match self {
            Self::Rust => &["*.rs"],
            Self::JavaScript | Self::TypeScript | Self::Tsx => &[
                "*.js", "*.jsx", "*.mjs", "*.cjs", "*.ts", "*.tsx", "*.mts", "*.cts",
            ],
            Self::Python => &["*.py", "*.pyi"],
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
            Self::JavaScript | Self::TypeScript | Self::Tsx => matches!(
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
            Self::Python => matches!(kind, "function_definition" | "class_definition"),
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
    let extensions = syntax.path_patterns();
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

const MAX_OUTLINE: usize = 2000;
const MAX_NAME: usize = 128;

#[derive(Deserialize)]
pub(crate) struct OutlineRequest {
    selection: SelectedFile,
    side: AnchorSide,
    revision: String,
}

#[derive(Serialize)]
pub(crate) struct OutlineSymbol {
    name: String,
    kind: &'static str,
    line: usize,
    depth: usize,
}

/// The displayed version of the file the outline describes; the client pairs it with a symbol's line to reveal it.
#[derive(Serialize)]
pub(crate) struct OutlineFile {
    path: PathBuf,
    side: AnchorSide,
    revision: String,
    diff_revision: String,
    index: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Outline {
    Found {
        file: OutlineFile,
        symbols: Vec<OutlineSymbol>,
        truncated: bool,
    },
    Unsupported,
    Unavailable,
}

pub(crate) async fn outline(input: OutlineRequest) -> Response {
    match tokio::task::spawn_blocking(move || build_outline(input)).await {
        Ok(Ok(outline)) => Json(outline).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not read the symbol outline",
        )
            .into_response(),
    }
}

fn build_outline(input: OutlineRequest) -> Result<Outline, (StatusCode, String)> {
    let OutlineRequest {
        selection,
        side,
        revision,
    } = input;
    let Some(checked) = check(selection, &revision)? else {
        return Ok(Outline::Unsupported);
    };
    let Some(review) = checked.comparison.git() else {
        return Ok(Outline::Unsupported);
    };
    let Some(path) = review
        .changes
        .get(checked.index)
        .and_then(|change| match side {
            AnchorSide::Before => change.before_path.clone(),
            AnchorSide::After => change.after_path.clone(),
        })
    else {
        return Ok(Outline::Unavailable);
    };
    let Some(syntax) = Syntax::from_path(&path) else {
        return Ok(Outline::Unsupported);
    };
    let bad_request = |error: io::Error| (StatusCode::BAD_REQUEST, error.to_string());
    let Some(text) = review
        .read_text_source(side, &path, MAX_TEXT_BYTES)
        .map_err(bad_request)?
    else {
        return Ok(Outline::Unavailable);
    };
    let (symbols, truncated) =
        outline_symbols(&mut Parser::new(), syntax, &text).map_err(bad_request)?;
    Ok(Outline::Found {
        file: OutlineFile {
            path,
            side,
            revision: format!("{:x}", Sha256::digest(text.as_bytes())),
            diff_revision: revision,
            index: checked.index,
            text,
        },
        symbols,
        truncated,
    })
}

impl Syntax {
    /// The outline entry a node declares, as its listed name and kind. Declarations inside a function body are
    /// not listed (the caller skips them), so the outline shows what the file defines rather than its locals.
    fn outline_entry(self, node: Node<'_>, text: &str) -> Option<(String, &'static str, usize)> {
        let source = text.as_bytes();
        let named = |node: Node<'_>| {
            let name = node.child_by_field_name("name")?;
            let value = name.utf8_text(source).ok()?;
            (!value.is_empty()).then(|| {
                (
                    value.chars().take(MAX_NAME).collect::<String>(),
                    name.start_position().row + 1,
                )
            })
        };
        let in_container = |node: Node<'_>, containers: &[&str]| {
            node.parent()
                .and_then(|parent| parent.parent())
                .is_some_and(|owner| containers.contains(&owner.kind()))
        };
        let (kind, name, line) = match self {
            Self::Rust => match node.kind() {
                "impl_item" => {
                    let target = node.child_by_field_name("type")?.utf8_text(source).ok()?;
                    let name = match node
                        .child_by_field_name("trait")
                        .and_then(|node| node.utf8_text(source).ok())
                    {
                        Some(trait_name) => format!("impl {trait_name} for {target}"),
                        None => format!("impl {target}"),
                    };
                    (
                        "impl",
                        name.chars().take(MAX_NAME).collect(),
                        node.start_position().row + 1,
                    )
                }
                kind => {
                    let label = match kind {
                        "function_item" | "function_signature_item" => {
                            if in_container(node, &["impl_item", "trait_item"]) {
                                "method"
                            } else {
                                "function"
                            }
                        }
                        "struct_item" | "union_item" => "struct",
                        "enum_item" => "enum",
                        "trait_item" => "trait",
                        "type_item" => "type",
                        "const_item" | "static_item" => "constant",
                        "mod_item" => "module",
                        "macro_definition" => "macro",
                        _ => return None,
                    };
                    let (name, line) = named(node)?;
                    (label, name, line)
                }
            },
            Self::JavaScript | Self::TypeScript | Self::Tsx => {
                let label = match node.kind() {
                    "function_declaration" | "generator_function_declaration" => "function",
                    "class_declaration" | "abstract_class_declaration" => "class",
                    "interface_declaration" => "interface",
                    "type_alias_declaration" => "type",
                    "enum_declaration" => "enum",
                    "method_definition" => "method",
                    "internal_module" => "module",
                    "variable_declarator" => {
                        if node.child_by_field_name("name")?.kind() != "identifier" {
                            return None;
                        }
                        match node.child_by_field_name("value").map(|value| value.kind()) {
                            Some("arrow_function" | "function_expression" | "function") => {
                                "function"
                            }
                            Some("class") => "class",
                            _ => "variable",
                        }
                    }
                    _ => return None,
                };
                let (name, line) = named(node)?;
                (label, name, line)
            }
            Self::Python => {
                let label = match node.kind() {
                    "function_definition" => {
                        if in_container(node, &["class_definition"]) {
                            "method"
                        } else {
                            "function"
                        }
                    }
                    "class_definition" => "class",
                    _ => return None,
                };
                let (name, line) = named(node)?;
                (label, name, line)
            }
        };
        Some((name, kind, line))
    }

    fn owns_body(self, kind: &str) -> bool {
        match self {
            Self::Rust => matches!(kind, "function_item" | "closure_expression"),
            Self::JavaScript | Self::TypeScript | Self::Tsx => matches!(
                kind,
                "function_declaration"
                    | "generator_function_declaration"
                    | "method_definition"
                    | "arrow_function"
                    | "function_expression"
                    | "function"
            ),
            Self::Python => kind == "function_definition",
        }
    }
}

fn outline_symbols(
    parser: &mut Parser,
    syntax: Syntax,
    text: &str,
) -> io::Result<(Vec<OutlineSymbol>, bool)> {
    parser
        .set_language(&syntax.language())
        .map_err(io::Error::other)?;
    let tree = parser
        .parse(text, None)
        .ok_or_else(|| io::Error::other("Could not parse source text"))?;
    let mut symbols = Vec::new();
    let mut stack = vec![(tree.root_node(), 0_usize, false)];
    while let Some((node, depth, in_body)) = stack.pop() {
        let mut child_depth = depth;
        if !in_body && let Some((name, kind, line)) = syntax.outline_entry(node, text) {
            if symbols.len() >= MAX_OUTLINE {
                return Ok((symbols, true));
            }
            symbols.push(OutlineSymbol {
                name,
                kind,
                line,
                depth,
            });
            child_depth += 1;
        }
        let child_body = in_body || syntax.owns_body(node.kind());
        let mut children = node.named_children(&mut node.walk()).collect::<Vec<_>>();
        children.reverse();
        stack.extend(
            children
                .into_iter()
                .map(|child| (child, child_depth, child_body)),
        );
    }
    Ok((symbols, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cited_commit_is_only_ever_a_short_or_full_hexadecimal_hash() {
        // HS2-B5K6GM: never a ref, a revision expression or an option Git could read.
        assert_eq!(cited_commit("ABCDEF1").as_deref(), Some("abcdef1"));
        assert_eq!(
            cited_commit(&"a".repeat(40)).as_deref(),
            Some(&*"a".repeat(40))
        );
        for refused in [
            "",
            "abc123",
            "HEAD",
            "main",
            "--all",
            "-abcdef1",
            "abcdef1^",
            "abcdef1~1",
            "abcdef1:path",
            "abcdefg",
            "abcdef 1",
            &"a".repeat(41),
        ] {
            assert_eq!(cited_commit(refused), None, "{refused:?}");
        }
    }

    #[test]
    fn matches_definition_names_and_lines_from_the_navigation_baseline() {
        let fixtures = [
            (
                Syntax::JavaScript,
                include_str!("../tests/fixtures/symbols.jsx"),
                &[
                    ("View", 2),
                    ("Controller", 3),
                    ("resolve", 4),
                    ("fetchValue", 6),
                ][..],
            ),
            (
                Syntax::Python,
                include_str!("../tests/fixtures/symbols.py"),
                &[("Controller", 2), ("resolve", 4), ("fetch_value", 7)][..],
            ),
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
        for (syntax, text) in [
            (
                Syntax::JavaScript,
                "class A { method() {} } class B { method() {} }",
            ),
            (
                Syntax::Python,
                "class A:\n    def method(self): ...\nclass B:\n    def method(self): ...\n",
            ),
        ] {
            assert_eq!(
                definitions(&mut parser, syntax, text, "method")
                    .unwrap()
                    .len(),
                2
            );
        }
    }

    fn listed(syntax: Syntax, text: &str) -> Vec<(String, &'static str, usize, usize)> {
        let (symbols, truncated) = outline_symbols(&mut Parser::new(), syntax, text).unwrap();
        assert!(!truncated);
        symbols
            .into_iter()
            .map(|symbol| (symbol.name, symbol.kind, symbol.line, symbol.depth))
            .collect()
    }

    fn entry(
        name: &str,
        kind: &'static str,
        line: usize,
        depth: usize,
    ) -> (String, &'static str, usize, usize) {
        (name.to_string(), kind, line, depth)
    }

    #[test]
    fn outlines_rust_declarations_with_impl_containers_and_no_locals() {
        let text = "const A: u8 = 1;\nstruct S;\nimpl S {\n    fn new() -> Self {\n        fn inner() {}\n        S\n    }\n}\ntrait T {\n    fn t(&self);\n}\nimpl T for S {\n    fn t(&self) {}\n}\nmod m {\n    pub fn f() {}\n}\nfn main() {\n    const LOCAL: u8 = 2;\n}\n";
        assert_eq!(
            listed(Syntax::Rust, text),
            vec![
                entry("A", "constant", 1, 0),
                entry("S", "struct", 2, 0),
                entry("impl S", "impl", 3, 0),
                entry("new", "method", 4, 1),
                entry("T", "trait", 9, 0),
                entry("t", "method", 10, 1),
                entry("impl T for S", "impl", 12, 0),
                entry("t", "method", 13, 1),
                entry("m", "module", 15, 0),
                entry("f", "function", 16, 1),
                entry("main", "function", 18, 0),
            ]
        );
    }

    #[test]
    fn outlines_typescript_and_javascript_declarations() {
        let text = "export interface Props { a: string }\ntype Id = string;\nenum Mode { A }\nexport class View {\n  render() { const local = 1; }\n  static make() {}\n}\nexport const make = () => { const inner = () => 1; };\nconst answer = 42;\nexport function build() { function nested() {} }\nnamespace Ns { export const x = 1; }\nconst { a, b } = obj;\n";
        assert_eq!(
            listed(Syntax::TypeScript, text),
            vec![
                entry("Props", "interface", 1, 0),
                entry("Id", "type", 2, 0),
                entry("Mode", "enum", 3, 0),
                entry("View", "class", 4, 0),
                entry("render", "method", 5, 1),
                entry("make", "method", 6, 1),
                entry("make", "function", 8, 0),
                entry("answer", "variable", 9, 0),
                entry("build", "function", 10, 0),
                entry("Ns", "module", 11, 0),
                entry("x", "variable", 11, 1),
            ]
        );
        assert_eq!(
            listed(
                Syntax::Tsx,
                "export const View = () => <p>Hi</p>;\nfunction* walk() {}\n"
            ),
            vec![
                entry("View", "function", 1, 0),
                entry("walk", "function", 2, 0)
            ]
        );
        assert_eq!(
            listed(
                Syntax::JavaScript,
                "class A { m() {} }\nconst b = class {};\n"
            ),
            vec![
                entry("A", "class", 1, 0),
                entry("m", "method", 1, 1),
                entry("b", "class", 2, 0)
            ]
        );
    }

    #[test]
    fn outlines_python_classes_methods_and_functions() {
        let text = "class A:\n    def m(self):\n        def inner(): ...\n    class B: ...\n@decorator\ndef f(): ...\n";
        assert_eq!(
            listed(Syntax::Python, text),
            vec![
                entry("A", "class", 1, 0),
                entry("m", "method", 2, 1),
                entry("B", "class", 4, 1),
                entry("f", "function", 6, 0),
            ]
        );
    }

    #[test]
    fn outline_tolerates_syntax_errors_and_caps_the_list() {
        let broken = listed(Syntax::Rust, "fn ok() {}\nfn broken( {\nfn later() {}\n");
        assert!(broken.iter().any(|(name, ..)| name == "ok"));
        assert!(listed(Syntax::Rust, "").is_empty());
        let many = (0..MAX_OUTLINE + 5)
            .map(|n| format!("fn f{n}() {{}}\n"))
            .collect::<String>();
        let (symbols, truncated) =
            outline_symbols(&mut Parser::new(), Syntax::Rust, &many).unwrap();
        assert!(truncated);
        assert_eq!(symbols.len(), MAX_OUTLINE);
        assert_eq!(symbols[0].name, "f0");
        let long = format!("fn {}() {{}}\n", "n".repeat(300));
        assert_eq!(listed(Syntax::Rust, &long)[0].0.len(), MAX_NAME);
    }
}
