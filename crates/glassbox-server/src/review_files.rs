use std::io;
use std::path::{Path, PathBuf};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use glassbox_comparison::{
    GitChange, GitFileChange, GitReview, GitReviewMode, compare_difftool_paths,
    compare_direct_content, compare_git_content, compare_paths, review_git,
};
use glassbox_model::{
    Change, ComparisonData, ComparisonEntry, DifftoolInput, TextHunk, UnavailableLfsObject,
};
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

#[derive(Deserialize)]
pub(crate) struct SelectedFile {
    source: ReviewSource,
    index: usize,
    path: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FileContent {
    Text {
        hunks: Vec<TextHunk>,
    },
    Media,
    UnavailableLfs {
        before: Option<UnavailableLfsObject>,
        after: Option<UnavailableLfsObject>,
    },
    Binary,
}

enum Entries {
    Git(GitReview),
    Direct(Vec<ComparisonEntry>),
}

struct Comparison {
    identity: String,
    comparison: String,
    branch: Option<String>,
    entries: Entries,
}

impl Entries {
    fn metadata(&self, index: usize) -> Option<ReviewFile> {
        match self {
            Self::Git(review) => git_file(review.changes.get(index)?),
            Self::Direct(entries) => direct_file(entries.get(index)?),
        }
    }

    fn len(&self) -> usize {
        match self {
            Self::Git(review) => review.changes.len(),
            Self::Direct(entries) => entries.len(),
        }
    }

    fn content(&self, index: usize) -> io::Result<ComparisonData> {
        match self {
            Self::Git(review) => compare_git_content(review, index),
            Self::Direct(entries) => compare_direct_content(&entries[index]),
        }
    }
}

pub(crate) async fn list(input: ReviewSource, difftool: Option<DifftoolInput>) -> Response {
    blocking(move || {
        let result = load(input, difftool)?;
        let files = (0..result.entries.len())
            .filter_map(|index| result.entries.metadata(index))
            .collect();
        Ok(ReviewFiles {
            identity: result.identity,
            comparison: result.comparison,
            branch: result.branch,
            files,
        })
    })
    .await
}

pub(crate) async fn selected(input: SelectedFile, difftool: Option<DifftoolInput>) -> Response {
    blocking(move || {
        let result = load(input.source, difftool)?;
        validate_selection(&result, input.index, &input.path)?;
        Ok(match result.entries.content(input.index)? {
            ComparisonData::Text(hunks) => FileContent::Text { hunks },
            ComparisonData::Media { .. } => FileContent::Media,
            ComparisonData::UnavailableLfs { before, after } => {
                FileContent::UnavailableLfs { before, after }
            }
            ComparisonData::Binary => FileContent::Binary,
        })
    })
    .await
}

fn validate_selection(result: &Comparison, index: usize, path: &str) -> io::Result<()> {
    if result
        .entries
        .metadata(index)
        .is_some_and(|file| file.path == path)
    {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "The changed-file list has changed. Open the comparison again.",
        ))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FileAction {
    CopyAbsolute,
    Reveal,
    Open,
}

#[derive(Deserialize)]
pub(crate) struct FileActionInput {
    #[serde(flatten)]
    selection: SelectedFile,
    action: FileAction,
}

pub(crate) async fn file_action(
    input: FileActionInput,
    difftool: Option<DifftoolInput>,
) -> Response {
    blocking(move || {
        let SelectedFile {
            source,
            index,
            path,
        } = input.selection;
        if matches!(source, ReviewSource::Difftool) {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Git difftool supplies temporary comparison inputs without a verified live path.",
            ));
        }
        let result = load(source, difftool)?;
        validate_selection(&result, index, &path)?;
        let candidate = match &result.entries {
            Entries::Git(review) => {
                let entry = &review.changes[index];
                review.root.join(
                    entry
                        .after_path
                        .as_ref()
                        .or(entry.before_path.as_ref())
                        .expect("validated Git entry"),
                )
            }
            Entries::Direct(entries) => {
                let entry = &entries[index];
                entry
                    .after
                    .as_ref()
                    .or(entry.before.as_ref())
                    .expect("validated direct entry")
                    .source_path
                    .clone()
            }
        };
        let absolute = std::path::absolute(candidate)?;
        match input.action {
            FileAction::CopyAbsolute => Ok(Some(absolute)),
            FileAction::Reveal | FileAction::Open => {
                if !absolute.is_file() {
                    return Err(io::Error::new(
                        io::ErrorKind::NotFound,
                        "There is no live file at the comparison path.",
                    ));
                }
                launch_desktop(&absolute, matches!(input.action, FileAction::Reveal))?;
                Ok(None)
            }
        }
    })
    .await
}

fn launch_desktop(path: &Path, reveal: bool) -> io::Result<()> {
    use std::process::{Command, Stdio};

    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("/usr/bin/open");
        if reveal {
            command.arg("-R");
        }
        command.arg(path);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        if reveal {
            let mut argument = std::ffi::OsString::from("/select,");
            argument.push(path);
            command.arg(argument);
        } else {
            command.arg(path);
        }
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(if reveal {
            path.parent().unwrap_or(path)
        } else {
            path
        });
        command
    };

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

async fn blocking<T: Serialize + Send + 'static>(
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> Response {
    match tokio::task::spawn_blocking(work).await {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not load the comparison",
        )
            .into_response(),
    }
}

fn load(input: ReviewSource, difftool: Option<DifftoolInput>) -> io::Result<Comparison> {
    match input {
        ReviewSource::Paths { before, after } => Ok(Comparison {
            identity: label(&after),
            comparison: "Direct comparison".into(),
            branch: None,
            entries: Entries::Direct(compare_paths(&before, &after)?),
        }),
        ReviewSource::Difftool => {
            let input = difftool.ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "No Git difftool launch is active")
            })?;
            Ok(Comparison {
                identity: "Git difftool".into(),
                comparison: "Git difftool".into(),
                branch: None,
                entries: Entries::Direct(compare_difftool_paths(&input)?),
            })
        }
        ReviewSource::Git { directory, mode } => {
            let (mode, comparison) = mode.query();
            let review = review_git(&directory, mode)?;
            Ok(Comparison {
                identity: label(&review.root),
                comparison,
                branch: review.branch_name()?,
                entries: Entries::Git(review),
            })
        }
    }
}

fn git_file(file: &GitFileChange) -> Option<ReviewFile> {
    let path = display_path(file.after_path.as_ref().or(file.before_path.as_ref())?);
    let previous_path = file
        .before_path
        .as_ref()
        .filter(|before| {
            file.after_path
                .as_ref()
                .is_some_and(|after| *before != after)
        })
        .map(|path| display_path(path));
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
}

fn direct_file(entry: &ComparisonEntry) -> Option<ReviewFile> {
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
