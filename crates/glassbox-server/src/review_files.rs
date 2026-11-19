use std::io;
use std::path::{Path, PathBuf};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use glassbox_comparison::{
    GitChange, GitReviewMode, compare_difftool_paths, compare_paths, review_git,
};
use glassbox_model::{Change, ComparisonEntry, DifftoolInput};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ReviewSource {
    Paths { before: PathBuf, after: PathBuf },
    Git { directory: PathBuf, mode: GitMode },
    Difftool,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum GitMode {
    WorkingTree,
    Staged,
    Unstaged,
    Commit { revision: String },
    Range { before: String, after: String },
    Branch { revision: String },
}

impl GitMode {
    fn query(&self) -> (GitReviewMode<'_>, String) {
        match self {
            Self::WorkingTree => (GitReviewMode::WorkingTree, "Working tree".into()),
            Self::Staged => (GitReviewMode::Staged, "Staged changes".into()),
            Self::Unstaged => (GitReviewMode::Unstaged, "Unstaged changes".into()),
            Self::Commit { revision } => (GitReviewMode::Commit(revision), revision.clone()),
            Self::Range { before, after } => (
                GitReviewMode::Range { before, after },
                format!("{before} → {after}"),
            ),
            Self::Branch { revision } => (
                GitReviewMode::Branch(revision),
                format!("Changes against {revision}"),
            ),
        }
    }
}

#[derive(Serialize)]
struct ReviewFiles {
    identity: String,
    comparison: String,
    branch: Option<String>,
    files: Vec<ReviewFile>,
}

#[derive(Serialize)]
struct ReviewFile {
    path: String,
    previous_path: Option<String>,
    status: &'static str,
}

pub(crate) async fn list(input: ReviewSource, difftool: Option<DifftoolInput>) -> Response {
    match tokio::task::spawn_blocking(|| load(input, difftool)).await {
        Ok(Ok(files)) => Json(files).into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not list review files",
        )
            .into_response(),
    }
}

fn load(input: ReviewSource, difftool: Option<DifftoolInput>) -> io::Result<ReviewFiles> {
    match input {
        ReviewSource::Paths { before, after } => Ok(direct(
            compare_paths(&before, &after)?,
            label(&after),
            "Direct comparison",
        )),
        ReviewSource::Difftool => {
            let input = difftool.ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "No Git difftool launch is active")
            })?;
            Ok(direct(
                compare_difftool_paths(&input)?,
                "Git difftool".into(),
                "Git difftool",
            ))
        }
        ReviewSource::Git { directory, mode } => {
            let (mode, comparison) = mode.query();
            let review = review_git(&directory, mode)?;
            Ok(ReviewFiles {
                identity: label(&review.root),
                comparison,
                branch: review.branch_name()?,
                files: review
                    .changes
                    .into_iter()
                    .filter_map(|file| {
                        let path =
                            display_path(file.after_path.as_ref().or(file.before_path.as_ref())?);
                        let previous_path = file
                            .before_path
                            .filter(|before| {
                                file.after_path
                                    .as_ref()
                                    .is_some_and(|after| before != after)
                            })
                            .map(|path| display_path(&path));
                        Some(ReviewFile {
                            path,
                            previous_path,
                            status: match file.change {
                                GitChange::Added => "added",
                                GitChange::Copied => "copied",
                                GitChange::Deleted => "deleted",
                                GitChange::Modified => "modified",
                                GitChange::Renamed => "renamed",
                                GitChange::TypeChanged => "type_changed",
                                GitChange::Unmerged => "unmerged",
                            },
                        })
                    })
                    .collect(),
            })
        }
    }
}

fn direct(entries: Vec<ComparisonEntry>, identity: String, comparison: &str) -> ReviewFiles {
    ReviewFiles {
        identity,
        comparison: comparison.into(),
        branch: None,
        files: entries
            .into_iter()
            .filter_map(|entry| {
                let side = entry.after.as_ref().or(entry.before.as_ref())?;
                let previous_path = entry
                    .before
                    .as_ref()
                    .filter(|before| before.display_path != side.display_path)
                    .map(|before| display_path(&before.display_path));
                Some(ReviewFile {
                    path: display_path(&side.display_path),
                    previous_path,
                    status: match entry.change {
                        Change::Added => "added",
                        Change::Deleted => "deleted",
                        Change::Modified => "modified",
                    },
                })
            })
            .collect(),
    }
}

fn label(path: &Path) -> String {
    path.file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .into_owned()
}

fn display_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}
