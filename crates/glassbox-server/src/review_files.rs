use std::io;
use std::path::{Path, PathBuf};

use axum::Json;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use glassbox_comparison::{
    GitChange, GitFileChange, GitReview, GitReviewMode, compare_difftool_paths,
    compare_direct_content, compare_git_content, compare_paths, compare_text_bytes,
    direct_after_bytes, direct_before_bytes, git_after_bytes, git_before_bytes, review_git,
};
use glassbox_model::feedback::AnchorSide;
use glassbox_model::{
    Change, ComparisonData, ComparisonEntry, DifftoolInput, MediaAsset, TextHunk,
    UnavailableLfsObject,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ReviewSource {
    Paths { before: PathBuf, after: PathBuf },
    Git { directory: PathBuf, mode: GitMode },
    Difftool,
}

#[derive(Clone, Deserialize, Serialize)]
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
    pub(crate) source: ReviewSource,
    pub(crate) index: usize,
    pub(crate) path: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FileContent {
    Text {
        revision: String,
        hunks: Vec<TextHunk>,
        diagram: bool,
        /// Line count of the displayed side, so the client knows how much unchanged text trails the last hunk.
        after_lines: Option<u32>,
    },
    Media {
        before: Option<MediaMetadata>,
        after: Option<MediaMetadata>,
    },
    UnavailableLfs {
        before: Option<UnavailableLfsObject>,
        after: Option<UnavailableLfsObject>,
    },
    Binary,
}

#[derive(Serialize)]
struct MediaMetadata {
    content_type: &'static str,
    size: usize,
    revision: String,
}

impl MediaMetadata {
    fn from_asset(asset: &MediaAsset) -> Self {
        Self {
            content_type: asset.content_type,
            size: asset.bytes.len(),
            revision: media_revision(asset),
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct SelectedMedia {
    #[serde(flatten)]
    file: SelectedFile,
    side: AnchorSide,
    revision: String,
}

enum Entries {
    Git(GitReview),
    Direct(Vec<ComparisonEntry>),
}

pub(crate) struct Comparison {
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

pub(crate) async fn selected(
    input: SelectedFile,
    difftool: Option<DifftoolInput>,
    renderer_available: bool,
) -> Response {
    blocking(move || {
        let result = load(input.source, difftool)?;
        validate_selection(&result, input.index, &input.path)?;
        Ok(match result.display_content(input.index)? {
            ComparisonData::Text(hunks) => FileContent::Text {
                revision: text_revision(&hunks)?,
                after_lines: match hunks.is_empty() {
                    true => None,
                    false => result
                        .after_bytes(input.index)?
                        .map(|bytes| line_count(&bytes)),
                },
                hunks,
                diagram: renderer_available
                    && crate::diagrams::DiagramFormat::for_path(Path::new(&input.path)).is_some(),
            },
            ComparisonData::Media { before, after } => FileContent::Media {
                before: before.as_ref().map(MediaMetadata::from_asset),
                after: after.as_ref().map(MediaMetadata::from_asset),
            },
            ComparisonData::UnavailableLfs { before, after } => {
                FileContent::UnavailableLfs { before, after }
            }
            ComparisonData::Binary => FileContent::Binary,
        })
    })
    .await
}

/// Most unchanged lines one context request may return (HS2-DZ8ZR6).
pub(crate) const CONTEXT_LIMIT: u32 = 500;

#[derive(Deserialize)]
pub(crate) struct ContextRequest {
    #[serde(flatten)]
    file: SelectedFile,
    revision: String,
    /// First displayed-side line, 1-based.
    start: u32,
    /// Last displayed-side line, inclusive.
    end: u32,
}

#[derive(Serialize)]
struct ContextLine {
    text: String,
    ends_with_newline: bool,
}

#[derive(Serialize)]
struct Context {
    lines: Vec<ContextLine>,
    total: u32,
}

fn line_count(bytes: &[u8]) -> u32 {
    u32::try_from(bytes.split_inclusive(|byte| *byte == b'\n').count()).unwrap_or(u32::MAX)
}

fn context_lines(bytes: &[u8], start: u32, end: u32) -> io::Result<Context> {
    let text = std::str::from_utf8(bytes).map_err(io::Error::other)?;
    let take = (end - start + 1) as usize;
    let lines = text
        .split_inclusive('\n')
        .skip(start as usize - 1)
        .take(take)
        .map(|line| ContextLine {
            text: line.strip_suffix('\n').unwrap_or(line).to_owned(),
            ends_with_newline: line.ends_with('\n'),
        })
        .collect();
    Ok(Context {
        lines,
        total: line_count(bytes),
    })
}

/// Returns unchanged lines of the displayed side for the revision the client is showing.
///
/// A revision mismatch answers 409 so the client never splices lines from a changed source into a stale diff.
pub(crate) async fn context(input: ContextRequest, difftool: Option<DifftoolInput>) -> Response {
    let outcome = tokio::task::spawn_blocking(move || {
        if input.start == 0 || input.end < input.start || input.end - input.start >= CONTEXT_LIMIT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "Request between 1 and {CONTEXT_LIMIT} lines, starting at line 1 or later."
                ),
            ));
        }
        let result = load(input.file.source, difftool)?;
        validate_selection(&result, input.file.index, &input.file.path)?;
        if text_revision(&result.text_hunks(input.file.index)?)? != input.revision {
            return Ok(None);
        }
        let bytes = result.after_bytes(input.file.index)?.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "The file has no displayed lines.",
            )
        })?;
        context_lines(&bytes, input.start, input.end).map(Some)
    })
    .await;
    match outcome {
        Ok(Ok(Some(context))) => Json(context).into_response(),
        Ok(Ok(None)) => (
            StatusCode::CONFLICT,
            "The file changed after it was opened. Open the comparison again.",
        )
            .into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not load the unchanged lines",
        )
            .into_response(),
    }
}

pub(crate) async fn media(input: SelectedMedia, difftool: Option<DifftoolInput>) -> Response {
    let outcome = tokio::task::spawn_blocking(move || {
        let result = load(input.file.source, difftool)?;
        validate_selection(&result, input.file.index, &input.file.path)?;
        let asset = result.media_asset(input.file.index, input.side)?;
        Ok::<_, io::Error>(asset.filter(|asset| media_revision(asset) == input.revision))
    })
    .await;
    match outcome {
        Ok(Ok(Some(asset))) => (
            [
                (header::CONTENT_TYPE, asset.content_type),
                (header::CACHE_CONTROL, "no-store"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (
                    header::CONTENT_SECURITY_POLICY,
                    "sandbox; default-src 'none'",
                ),
            ],
            asset.bytes,
        )
            .into_response(),
        Ok(Ok(None)) => (
            StatusCode::NOT_FOUND,
            "The requested image revision is unavailable.",
        )
            .into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not load the image",
        )
            .into_response(),
    }
}

fn media_revision(asset: &MediaAsset) -> String {
    format!("{:x}", Sha256::digest(&asset.bytes))
}

pub(crate) fn text_revision(hunks: &[TextHunk]) -> io::Result<String> {
    let bytes = serde_json::to_vec(hunks).map_err(io::Error::other)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

impl Comparison {
    pub(crate) fn git(&self) -> Option<&GitReview> {
        match &self.entries {
            Entries::Git(review) => Some(review),
            Entries::Direct(_) => None,
        }
    }
    /// The display paths of the changed files, in list order.
    pub(crate) fn paths(&self) -> Vec<String> {
        (0..self.entries.len())
            .filter_map(|index| self.entries.metadata(index).map(|file| file.path))
            .collect()
    }

    /// Identifies the content a reviewer sees for one file: the text revision, both media revisions, or a
    /// fixed marker for content with no revision of its own (HS2-FTEQVQ).
    pub(crate) fn file_revision(&self, index: usize) -> io::Result<String> {
        Ok(match self.display_content(index)? {
            ComparisonData::Text(hunks) => text_revision(&hunks)?,
            ComparisonData::Media { before, after } => format!(
                "media:{}:{}",
                before.as_ref().map(media_revision).unwrap_or_default(),
                after.as_ref().map(media_revision).unwrap_or_default()
            ),
            ComparisonData::UnavailableLfs { .. } => "lfs-unavailable".into(),
            ComparisonData::Binary => "binary".into(),
        })
    }

    /// Bytes of one side of the file, `None` when that side does not exist (added or deleted).
    pub(crate) fn side_bytes(&self, index: usize, side: AnchorSide) -> io::Result<Option<Vec<u8>>> {
        match (&self.entries, side) {
            (Entries::Git(review), AnchorSide::Before) => git_before_bytes(review, index),
            (Entries::Git(review), AnchorSide::After) => git_after_bytes(review, index),
            (Entries::Direct(entries), AnchorSide::Before) => direct_before_bytes(&entries[index]),
            (Entries::Direct(entries), AnchorSide::After) => direct_after_bytes(&entries[index]),
        }
    }

    /// Bytes of the displayed side, `None` for a deleted file.
    fn after_bytes(&self, index: usize) -> io::Result<Option<Vec<u8>>> {
        match &self.entries {
            Entries::Git(review) => git_after_bytes(review, index),
            Entries::Direct(entries) => direct_after_bytes(&entries[index]),
        }
    }

    fn display_content(&self, index: usize) -> io::Result<ComparisonData> {
        let content = self.entries.content(index)?;
        if let ComparisonData::Media { before, after } = &content {
            if diagram_assets(before, after) {
                let before = before.as_ref().map_or(&[][..], |asset| &asset.bytes);
                let after = after.as_ref().map_or(&[][..], |asset| &asset.bytes);
                if [before, after]
                    .into_iter()
                    .any(|bytes| bytes.contains(&0) || std::str::from_utf8(bytes).is_err())
                {
                    return Ok(ComparisonData::Binary);
                }
                return compare_text_bytes(before, after).map(ComparisonData::Text);
            }
        }
        Ok(content)
    }

    pub(crate) fn diagram_sources(
        &self,
        index: usize,
    ) -> io::Result<crate::diagrams::DiagramSources> {
        if let ComparisonData::Media { before, after } = self.entries.content(index)? {
            if diagram_assets(&before, &after) {
                return Ok(crate::diagrams::DiagramSources {
                    before: before.map(|asset| asset.bytes),
                    after: after.map(|asset| asset.bytes),
                });
            }
        }
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "The selected file has no available diagram source.",
        ))
    }

    fn media_asset(&self, index: usize, side: AnchorSide) -> io::Result<Option<MediaAsset>> {
        match (self.entries.content(index)?, side) {
            (ComparisonData::Media { before, .. }, AnchorSide::Before) => Ok(before),
            (ComparisonData::Media { after, .. }, AnchorSide::After) => Ok(after),
            _ => Ok(None),
        }
    }

    pub(crate) fn media_revision(
        &self,
        index: usize,
        side: AnchorSide,
    ) -> io::Result<Option<String>> {
        Ok(self.media_asset(index, side)?.as_ref().map(media_revision))
    }

    pub(crate) fn analysis_inputs(&self) -> impl Iterator<Item = (usize, String)> + '_ {
        (0..self.entries.len())
            .filter_map(|index| self.entries.metadata(index).map(|file| (index, file.path)))
    }

    pub(crate) fn analysis_text(&self, index: usize) -> io::Result<Option<Vec<TextHunk>>> {
        match self.entries.content(index)? {
            ComparisonData::Text(hunks) if !hunks.is_empty() => Ok(Some(hunks)),
            _ => Ok(None),
        }
    }
}

impl Comparison {
    pub(crate) fn text_hunks(&self, index: usize) -> io::Result<Vec<TextHunk>> {
        match self.display_content(index)? {
            ComparisonData::Text(hunks) => Ok(hunks),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "The selected file has no text lines.",
            )),
        }
    }

    pub(crate) fn bundle_context(
        &self,
        source: &ReviewSource,
        difftool: Option<&DifftoolInput>,
    ) -> glassbox_feedback::BundleContext {
        let project = match &self.entries {
            Entries::Git(review) => Some(review.root.clone()),
            Entries::Direct(_) => match source {
                ReviewSource::Paths { after, .. } if after.is_dir() => Some(after.clone()),
                ReviewSource::Paths { after, .. } => after
                    .parent()
                    .filter(|parent| !parent.as_os_str().is_empty())
                    .map(Path::to_path_buf),
                _ => None,
            },
        };
        let paths = match source {
            ReviewSource::Paths { before, after } => Some((before, after)),
            ReviewSource::Difftool => difftool.map(|value| (&value.before, &value.after)),
            ReviewSource::Git { .. } => None,
        };
        glassbox_feedback::BundleContext {
            project,
            comparison: self.comparison.clone(),
            before: paths.map(|(before, _)| before.to_string_lossy().into_owned()),
            after: paths.map(|(_, after)| after.to_string_lossy().into_owned()),
        }
    }
}

fn diagram_assets(before: &Option<MediaAsset>, after: &Option<MediaAsset>) -> bool {
    [before, after]
        .into_iter()
        .flatten()
        .all(|asset| asset.content_type == "text/plain")
}

pub(crate) fn validate_selection(result: &Comparison, index: usize, path: &str) -> io::Result<()> {
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

pub(crate) fn launch_desktop(path: &Path, reveal: bool) -> io::Result<()> {
    use std::process::Stdio;

    let mut child = desktop_command(path, reveal)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn desktop_command(path: &Path, reveal: bool) -> std::process::Command {
    let mut command = std::process::Command::new("/usr/bin/open");
    if reveal {
        command.arg("-R");
    }
    command.arg(path);
    command
}

#[cfg(windows)]
fn desktop_command(path: &Path, reveal: bool) -> std::process::Command {
    use std::os::windows::process::CommandExt;

    let mut command = std::process::Command::new("explorer.exe");
    if reveal {
        // Explorer parses its own command line, so the argument is passed raw
        // instead of letting Rust quote the whole `/select,` token (HS2-P42M03).
        command.raw_arg(explorer_select_argument(path));
    } else {
        command.arg(path);
    }
    command
}

#[cfg(not(any(target_os = "macos", windows)))]
fn desktop_command(path: &Path, reveal: bool) -> std::process::Command {
    let mut command = std::process::Command::new("xdg-open");
    command.arg(if reveal {
        path.parent().unwrap_or(path)
    } else {
        path
    });
    command
}

/// The exact `explorer.exe` argument that selects `path`: `/select,"<path>"`.
///
/// Explorer only honors the selection when the quotes surround the path alone.
/// `"/select,<path>"`, which `Command::arg` produces for a path with spaces,
/// makes it open Documents with nothing selected (HS2-P42M03). Windows paths
/// cannot contain `"`, so wrapping in quotes is always safe.
#[cfg(any(windows, test))]
fn explorer_select_argument(path: &Path) -> std::ffi::OsString {
    let mut argument = std::ffi::OsString::from("/select,\"");
    argument.push(path);
    argument.push("\"");
    argument
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

pub(crate) fn load(input: ReviewSource, difftool: Option<DifftoolInput>) -> io::Result<Comparison> {
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
            let review = review_git(&directory, mode).map_err(|error| {
                if error.kind() == io::ErrorKind::NotFound
                    && std::fs::metadata(&directory)
                        .is_err_and(|error| error.kind() == io::ErrorKind::NotFound)
                {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        "Repository folder not found. Check the path and try again.",
                    )
                } else {
                    error
                }
            })?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explorer_select_quotes_only_the_path() {
        for (path, expected) in [
            (
                r"C:\Users\me\native ev\Field Notes repo\source with spaces.txt",
                r#"/select,"C:\Users\me\native ev\Field Notes repo\source with spaces.txt""#,
            ),
            (r"C:\plain\file.txt", r#"/select,"C:\plain\file.txt""#),
            (
                r"C:\Users\mé\ünï cödé.txt",
                r#"/select,"C:\Users\mé\ünï cödé.txt""#,
            ),
            (
                r"\\server\share name\a b.txt",
                r#"/select,"\\server\share name\a b.txt""#,
            ),
        ] {
            assert_eq!(explorer_select_argument(Path::new(path)), expected);
        }
    }

    #[test]
    fn explorer_select_never_wraps_the_flag_in_the_quotes() {
        let argument = explorer_select_argument(Path::new("a b"));
        let argument = argument.to_string_lossy();
        assert!(argument.starts_with("/select,\""), "{argument}");
        assert!(!argument.starts_with('"'), "{argument}");
    }
}
