use std::io;

use glassbox_model::{DiffLineKind, DifftoolInput, TextHunk};

use crate::review_files::{self, ReviewSource};

const MAX_FILES: usize = 80;
const MAX_FILE_PROMPT_BYTES: usize = 6_000;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Snapshot {
    pub(super) files: Vec<InputFile>,
    pub(super) skipped: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct InputFile {
    pub(super) path: String,
    pub(super) revision: String,
    pub(super) hunks: Vec<TextHunk>,
    pub(super) prompt: String,
}

pub(super) async fn capture(
    source: ReviewSource,
    difftool: Option<DifftoolInput>,
) -> io::Result<Snapshot> {
    tokio::task::spawn_blocking(move || {
        let comparison = review_files::load(source, difftool)?;
        let mut snapshot = Snapshot {
            files: Vec::new(),
            skipped: Vec::new(),
        };
        for (index, path) in comparison.analysis_inputs() {
            if snapshot.files.len() >= MAX_FILES {
                snapshot.skipped.push(path);
                continue;
            }
            let Some(hunks) = comparison.analysis_text(index)? else {
                snapshot.skipped.push(path);
                continue;
            };
            let mut prompt = String::new();
            for line in hunks.iter().flat_map(|hunk| &hunk.lines) {
                let Some((side, number)) = line
                    .after_line
                    .map(|value| ("after", value))
                    .or_else(|| line.before_line.map(|value| ("before", value)))
                else {
                    continue;
                };
                let change = match line.kind {
                    DiffLineKind::Added => "added",
                    DiffLineKind::Removed => "removed",
                    DiffLineKind::Context => "context",
                };
                let formatted = format!("{side} {number} {change} | {}", line.text);
                if prompt.len() + formatted.len() + 1 > MAX_FILE_PROMPT_BYTES {
                    prompt.clear();
                    break;
                }
                prompt.push_str(&formatted);
                prompt.push('\n');
            }
            if prompt.is_empty() {
                snapshot.skipped.push(path);
            } else {
                let revision = review_files::text_revision(&hunks)?;
                snapshot.files.push(InputFile {
                    path,
                    revision,
                    hunks,
                    prompt,
                });
            }
        }
        Ok(snapshot)
    })
    .await
    .map_err(io::Error::other)?
}
