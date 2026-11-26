use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::prelude::*;
use glassbox_feedback::{
    BundleContext, ExportRequest, FeedbackBundle, HotSheetClient, PreparedExport, SavedReview,
};
use glassbox_model::DifftoolInput;
use glassbox_model::analysis::{AnalysisResult, FileAnalysis};
use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackChange, FeedbackId, FeedbackMessage, MessageTarget,
    ReviewAnchor, ReviewFeedback, ReviewerCategory, RiskLevel, ThreadOrigin,
};
use serde::{Deserialize, Serialize};

use crate::review_files::{self, ReviewSource};
use crate::symbols;

#[derive(Default, Clone)]
pub(crate) struct Discussion(Arc<Mutex<BTreeMap<String, Review>>>);

struct Review {
    saved: ReviewFeedback,
    bundle: FeedbackBundle,
}

#[derive(Deserialize)]
pub(crate) struct DiscussionInput {
    selection: DiscussionSelection,
    operation: Option<Operation>,
}

#[derive(Deserialize)]
pub(crate) struct DiscussionSelection {
    source: ReviewSource,
    index: Option<usize>,
    path: String,
}

#[derive(Deserialize)]
pub(crate) struct SourceLinkInput {
    selection: review_files::SelectedFile,
    thread: FeedbackId,
    index: usize,
}

#[derive(Deserialize)]
pub(crate) struct RelocateInput {
    selection: review_files::SelectedFile,
    thread: FeedbackId,
}

#[derive(Serialize)]
struct Relocation {
    /// `suggestion` carries the new place; the rest explain why there is none (HS2-RV5BD8).
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    side: Option<AnchorSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    /// The line's text, which a confirming move sends back as `if_text`.
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

impl Relocation {
    fn none(outcome: &'static str) -> Self {
        Self {
            outcome,
            side: None,
            line: None,
            text: None,
        }
    }
}

/// Suggests where a stale line comment's reviewed text now is, and stores nothing.
pub(crate) async fn relocate(
    workspace: Discussion,
    input: RelocateInput,
    difftool: Option<DifftoolInput>,
) -> Response {
    match tokio::task::spawn_blocking(move || locate(&workspace, input, difftool)).await {
        Ok(Ok(relocation)) => Json(relocation).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn locate(
    workspace: &Discussion,
    input: RelocateInput,
    difftool: Option<DifftoolInput>,
) -> Result<Relocation, ApiError> {
    let review_files::SelectedFile {
        source,
        index,
        path,
    } = input.selection;
    let key = serde_json::to_string(&source).map_err(bad_request)?;
    let anchor = {
        let reviews = workspace.0.lock().map_err(storage_error)?;
        reviews
            .get(&key)
            .and_then(|review| {
                review
                    .saved
                    .threads()
                    .iter()
                    .find(|thread| thread.id == input.thread && thread.anchor.path == path)
                    .map(|thread| thread.anchor.clone())
            })
            .ok_or_else(|| bad_request("The thread is unavailable in the selected file."))?
    };
    if !matches!(anchor.target, AnchorTarget::Line { .. }) {
        return Err(bad_request("Only a line comment can look for a new line."));
    }
    let Some(quote) = anchor.quote.as_deref() else {
        return Ok(Relocation::none("unavailable"));
    };
    let comparison = review_files::load(source, difftool).map_err(bad_request)?;
    review_files::validate_selection(&comparison, index, &path).map_err(bad_request)?;
    let hunks = comparison.text_hunks(index).map_err(bad_request)?;
    let revision = review_files::text_revision(&hunks).map_err(storage_error)?;
    if !anchor.is_stale(Some(&revision)) {
        return Ok(Relocation::none("current"));
    }
    let Some(bytes) = comparison
        .side_bytes(index, anchor.side)
        .map_err(bad_request)?
    else {
        return Ok(Relocation::none("missing"));
    };
    let text = String::from_utf8_lossy(&bytes);
    let matches: Vec<u32> = text
        .split_inclusive('\n')
        .enumerate()
        .filter(|(_, line)| line.strip_suffix('\n').unwrap_or(line) == quote)
        .map(|(offset, _)| u32::try_from(offset + 1).unwrap_or(u32::MAX))
        .collect();
    Ok(match matches.as_slice() {
        [] => Relocation::none("missing"),
        [line] => {
            // Move only accepts lines the diff shows, so a match in hidden text is reported, not offered.
            let shown = hunks.iter().flat_map(|hunk| &hunk.lines).any(|candidate| {
                let number = match anchor.side {
                    AnchorSide::Before => candidate.before_line,
                    AnchorSide::After => candidate.after_line,
                };
                number == Some(*line)
            });
            if shown {
                Relocation {
                    outcome: "suggestion",
                    side: Some(anchor.side),
                    line: Some(*line),
                    text: Some(quote.to_owned()),
                }
            } else {
                Relocation::none("hidden")
            }
        }
        _ => Relocation::none("ambiguous"),
    })
}

pub(crate) async fn follow_source_link(workspace: Discussion, input: SourceLinkInput) -> Response {
    match tokio::task::spawn_blocking(move || resolve_source_link(workspace, input)).await {
        Ok(Ok(destination)) => Json(destination).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn resolve_source_link(
    workspace: Discussion,
    input: SourceLinkInput,
) -> Result<symbols::Destination, ApiError> {
    let selection = input.selection;
    let key = serde_json::to_string(&selection.source).map_err(bad_request)?;
    let unavailable = || {
        (
            StatusCode::NOT_FOUND,
            "This source link is unavailable.".into(),
        )
    };
    let stale = || {
        (
            StatusCode::CONFLICT,
            "This source link refers to an earlier version.".into(),
        )
    };
    let (anchor, location) = {
        let reviews = workspace.0.lock().map_err(storage_error)?;
        let thread = reviews
            .get(&key)
            .and_then(|review| {
                review.saved.threads().iter().find(|thread| {
                    thread.id == input.thread && thread.anchor.path == selection.path
                })
            })
            .ok_or_else(unavailable)?;
        let ThreadOrigin::Ai {
            related_locations, ..
        } = &thread.origin
        else {
            return Err(unavailable());
        };
        let location = related_locations
            .get(input.index)
            .and_then(Option::as_ref)
            .ok_or_else(unavailable)?;
        (thread.anchor.clone(), location.clone())
    };
    let comparison = review_files::load(selection.source, None).map_err(bad_request)?;
    review_files::validate_selection(&comparison, selection.index, &selection.path)
        .map_err(|_| stale())?;
    let hunks = comparison
        .text_hunks(selection.index)
        .map_err(bad_request)?;
    let revision = review_files::text_revision(&hunks).map_err(storage_error)?;
    if anchor.is_stale(Some(&revision)) {
        return Err(stale());
    }
    let git = comparison.git().ok_or_else(unavailable)?;
    let mut destination =
        symbols::source_location(git, anchor.side, &location).ok_or_else(stale)?;
    if location.revision.as_deref() != Some(destination.revision()) {
        return Err(stale());
    }
    destination.set_diff_revision(&comparison);
    Ok(destination)
}

#[derive(Deserialize)]
pub(crate) struct SavedInput {
    source: ReviewSource,
    id: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct DeleteSavedInput {
    source: ReviewSource,
    id: String,
    confirmed: bool,
}

#[derive(Serialize)]
struct SavedView {
    reviews: Vec<SavedReview>,
    active: bool,
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Operation {
    Create {
        anchor: ReviewAnchor,
        category: ReviewerCategory,
        author: String,
        markdown: String,
    },
    Attach {
        id: FeedbackId,
        revision: u32,
        filename: String,
        content: String,
    },
    Apply {
        id: FeedbackId,
        revision: u32,
        change: FeedbackChange,
    },
    /// Rebinds a line thread to another line or side of the same file (HS2-TGAGQ4).
    Move {
        id: FeedbackId,
        revision: u32,
        anchor: ReviewAnchor,
        /// When set, the destination line must still read exactly this, so a confirmed suggestion cannot land
        /// on different text if the file changed again (HS2-RV5BD8).
        #[serde(default)]
        if_text: Option<String>,
    },
}

pub(crate) async fn handle(
    workspace: Discussion,
    input: DiscussionInput,
    difftool: Option<DifftoolInput>,
) -> Response {
    match tokio::task::spawn_blocking(move || edit(workspace, input, difftool)).await {
        Ok(Ok(feedback)) => Json(feedback).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not load the discussion",
        )
            .into_response(),
    }
}

pub(crate) async fn handoff(
    workspace: Discussion,
    source: ReviewSource,
    difftool: Option<DifftoolInput>,
) -> Response {
    let prepare = move || {
        with_review(&workspace, &source, difftool, |review| {
            review.bundle.instruction().map_err(storage_error)
        })
    };
    match tokio::task::spawn_blocking(prepare).await {
        Ok(Ok(instruction)) => Json(instruction).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not prepare the feedback handoff",
        )
            .into_response(),
    }
}

pub(crate) async fn saved_reviews(
    workspace: Discussion,
    input: SavedInput,
    difftool: Option<DifftoolInput>,
) -> Response {
    match tokio::task::spawn_blocking(move || saved(&workspace, input, difftool)).await {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => storage_error("Could not open saved feedback").into_response(),
    }
}

fn saved(
    workspace: &Discussion,
    input: SavedInput,
    difftool: Option<DifftoolInput>,
) -> Result<SavedView, ApiError> {
    let source = input.source;
    let key = serde_json::to_string(&source).map_err(bad_request)?;
    let comparison = review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
    let context = comparison.bundle_context(&source, difftool.as_ref());
    let identity = source_identity(&source, &context, difftool.as_ref())?;
    let store = crate::storage::feedback_store().map_err(storage_error)?;
    let reviews = store.saved_for_source(&identity).map_err(storage_error)?;
    let mut current = workspace.0.lock().map_err(storage_error)?;
    if let Some(id) = input.id {
        if current.contains_key(&key) {
            return Err((
                StatusCode::CONFLICT,
                "This comparison already has an active review.".into(),
            ));
        }
        let restored =
            store
                .reopen_for_source(&id, &identity)
                .map_err(|error| match error.kind() {
                    std::io::ErrorKind::WouldBlock => (StatusCode::CONFLICT, error.to_string()),
                    std::io::ErrorKind::NotFound => (StatusCode::NOT_FOUND, error.to_string()),
                    std::io::ErrorKind::InvalidInput => bad_request(error),
                    _ => storage_error(error),
                })?;
        let Some((bundle, saved)) = restored else {
            return Err((
                StatusCode::NOT_FOUND,
                "Saved review is unavailable for this comparison.".into(),
            ));
        };
        current.insert(key.clone(), Review { saved, bundle });
    }
    let active = current.get(&key);
    Ok(SavedView {
        reviews,
        active: active.is_some(),
        paths: active.map_or_else(Vec::new, |review| discussion_paths(&review.saved)),
    })
}

pub(crate) async fn delete_saved_review(
    workspace: Discussion,
    input: DeleteSavedInput,
    difftool: Option<DifftoolInput>,
) -> Response {
    match tokio::task::spawn_blocking(move || delete_saved(&workspace, input, difftool)).await {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => storage_error("Could not delete the saved review").into_response(),
    }
}

/// Delete one saved review of this comparison after confirmation (HS2-42A696).
fn delete_saved(
    workspace: &Discussion,
    input: DeleteSavedInput,
    difftool: Option<DifftoolInput>,
) -> Result<SavedView, ApiError> {
    if !input.confirmed {
        return Err((
            StatusCode::BAD_REQUEST,
            "Confirm deleting the saved review before continuing.".into(),
        ));
    }
    let source = input.source;
    let key = serde_json::to_string(&source).map_err(bad_request)?;
    let comparison = review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
    let context = comparison.bundle_context(&source, difftool.as_ref());
    let identity = source_identity(&source, &context, difftool.as_ref())?;
    let store = crate::storage::feedback_store().map_err(storage_error)?;
    store
        .delete_for_source(&input.id, &identity)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::WouldBlock => (
                StatusCode::CONFLICT,
                "This review is open in Glassbox. Close it before deleting.".into(),
            ),
            std::io::ErrorKind::NotFound => (StatusCode::NOT_FOUND, error.to_string()),
            std::io::ErrorKind::InvalidInput => bad_request(error),
            _ => storage_error(error),
        })?;
    let reviews = store.saved_for_source(&identity).map_err(storage_error)?;
    let current = workspace.0.lock().map_err(storage_error)?;
    let active = current.get(&key);
    Ok(SavedView {
        reviews,
        active: active.is_some(),
        paths: active.map_or_else(Vec::new, |review| discussion_paths(&review.saved)),
    })
}

fn discussion_paths(feedback: &ReviewFeedback) -> Vec<String> {
    use std::collections::BTreeSet;
    feedback
        .threads()
        .iter()
        .map(|thread| thread.anchor.path.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn with_review<T>(
    workspace: &Discussion,
    source: &ReviewSource,
    difftool: Option<DifftoolInput>,
    action: impl FnOnce(&Review) -> Result<T, ApiError>,
) -> Result<T, ApiError> {
    let key = serde_json::to_string(source).map_err(bad_request)?;
    let mut reviews = workspace.0.lock().map_err(storage_error)?;
    if let Some(review) = reviews.get(&key) {
        return action(review);
    }
    let comparison = review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
    let context = comparison.bundle_context(source, difftool.as_ref());
    let identity = source_identity(source, &context, difftool.as_ref())?;
    let review = start_review(context, ReviewFeedback::default(), &identity)?;
    let result = action(&review);
    reviews.insert(key, review);
    result
}

#[derive(Serialize)]
pub(crate) struct Preview {
    pub(crate) threads: usize,
    pub(crate) replies: usize,
    pub(crate) attachments: usize,
    pub(crate) paths: Vec<String>,
    pub(crate) entries: Vec<ThreadPreview>,
}

#[derive(Serialize)]
pub(crate) struct ThreadPreview {
    id: FeedbackId,
    revision: u32,
    path: String,
    excerpt: String,
    replies: usize,
    attachments: usize,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct ThreadSelection {
    id: FeedbackId,
    revision: u32,
}

impl Discussion {
    pub(crate) fn diagram_attachment(
        &self,
        selection: &DiscussionSelection,
        id: FeedbackId,
        attachment: FeedbackId,
    ) -> Result<Option<(crate::diagrams::DiagramFormat, Vec<u8>)>, ApiError> {
        let key = serde_json::to_string(&selection.source).map_err(bad_request)?;
        let reviews = self.0.lock().map_err(storage_error)?;
        let result = reviews
            .get(&key)
            .and_then(|review| {
                review
                    .saved
                    .threads()
                    .iter()
                    .find(|thread| thread.id == id && thread.anchor.path == selection.path)
            })
            .and_then(|thread| {
                std::iter::once(&thread.opening)
                    .chain(thread.replies.iter().map(|reply| &reply.message))
                    .flat_map(|message| &message.attachments)
                    .find(|item| item.id == attachment)
            })
            .and_then(|item| {
                let format =
                    crate::diagrams::DiagramFormat::for_path(std::path::Path::new(&item.filename))?;
                (item.bytes.len() <= crate::diagrams::MAX_SOURCE_BYTES)
                    .then(|| (format, item.bytes.clone()))
            });
        Ok(result)
    }

    pub(crate) fn preview(&self, source: &ReviewSource) -> Result<Preview, ApiError> {
        use std::collections::BTreeSet;
        let key = serde_json::to_string(source).map_err(bad_request)?;
        let reviews = self.0.lock().map_err(storage_error)?;
        let threads = reviews
            .get(&key)
            .map_or(&[][..], |review| review.saved.threads());
        let paths: BTreeSet<String> = threads
            .iter()
            .map(|thread| thread.anchor.path.clone())
            .collect();
        let entries: Vec<_> = threads
            .iter()
            .map(|thread| ThreadPreview {
                id: thread.id,
                revision: thread.revision,
                path: thread.anchor.path.clone(),
                excerpt: thread.opening.markdown.chars().take(120).collect(),
                replies: thread.replies.len(),
                attachments: std::iter::once(&thread.opening)
                    .chain(thread.replies.iter().map(|reply| &reply.message))
                    .map(|message| message.attachments.len())
                    .sum(),
            })
            .collect();
        Ok(Preview {
            threads: threads.len(),
            replies: entries.iter().map(|thread| thread.replies).sum(),
            attachments: entries.iter().map(|thread| thread.attachments).sum(),
            paths: paths.into_iter().collect(),
            entries,
        })
    }

    pub(crate) fn publish_analysis(
        &self,
        source: &ReviewSource,
        difftool: Option<DifftoolInput>,
        result: &AnalysisResult,
    ) -> Result<(), ApiError> {
        let key = serde_json::to_string(source).map_err(bad_request)?;
        let mut reviews = self.0.lock().map_err(storage_error)?;
        let mut next = reviews
            .get(&key)
            .map(|item| item.saved.clone())
            .unwrap_or_default();
        let mut changed = false;
        for file in &result.files {
            let (tag, risk, observations) = match &file.analysis {
                FileAnalysis::Risk {
                    aggregate,
                    observations,
                    ..
                } => {
                    let risk = if *aggregate >= 0.7 {
                        RiskLevel::High
                    } else if *aggregate >= 0.35 {
                        RiskLevel::Medium
                    } else {
                        RiskLevel::Low
                    };
                    ("Risk Analysis", Some(risk), observations)
                }
                FileAnalysis::Guidance { steps, .. } => ("Code Guidance", None, steps),
            };
            for observation in observations {
                let anchor = ReviewAnchor {
                    path: file.path.clone(),
                    side: observation.side,
                    revision: file.revision.clone(),
                    target: AnchorTarget::Line {
                        start: observation.line,
                        end: observation.line,
                    },
                    // Analysis results carry no source text, so an AI note is never offered a new line.
                    quote: None,
                };
                let origin = ThreadOrigin::Ai {
                    tags: vec![tag.into()],
                    risk,
                    related_locations: observation.related_locations.clone(),
                };
                if next.threads().iter().any(|thread| {
                    thread.anchor == anchor
                        && thread.origin == origin
                        && thread.opening.markdown == observation.text
                }) {
                    continue;
                }
                next.add(anchor, origin, "AI note".into(), observation.text.clone())
                    .map_err(bad_request)?;
                changed = true;
            }
        }
        if changed {
            if let Some(review) = reviews.get_mut(&key) {
                review.bundle.publish(&next).map_err(storage_error)?;
                review.saved = next;
            } else {
                let comparison =
                    review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
                let context = comparison.bundle_context(source, difftool.as_ref());
                let identity = source_identity(source, &context, difftool.as_ref())?;
                reviews.insert(key, start_review(context, next, &identity)?);
            }
        }
        Ok(())
    }

    pub(crate) fn prepare_export(
        &self,
        source: &ReviewSource,
        difftool: Option<DifftoolInput>,
        client: HotSheetClient,
        request: ExportRequest,
        selection: Option<&[ThreadSelection]>,
    ) -> Result<PreparedExport, ApiError> {
        with_review(self, source, difftool, |review| {
            let Some(selection) = selection else {
                return review
                    .bundle
                    .prepare_export(client, request)
                    .map_err(storage_error);
            };
            if selection.is_empty() {
                return Err(bad_request("Choose at least one feedback thread."));
            }
            let revisions: BTreeMap<_, _> = selection
                .iter()
                .map(|entry| (entry.id, entry.revision))
                .collect();
            let chosen: Vec<_> = review
                .saved
                .threads()
                .iter()
                .filter(|thread| revisions.get(&thread.id) == Some(&thread.revision))
                .collect();
            if chosen.len() != selection.len() {
                return Err((StatusCode::CONFLICT, "Selected feedback has changed. Refresh the delivery and select the threads again.".into()));
            }
            review
                .bundle
                .prepare_selected_export(client, request, &chosen)
                .map_err(storage_error)
        })
    }
}

pub(crate) fn source_identity(
    source: &ReviewSource,
    context: &BundleContext,
    difftool: Option<&DifftoolInput>,
) -> Result<String, ApiError> {
    fn absolute(path: &std::path::Path) -> std::io::Result<std::path::PathBuf> {
        std::fs::canonicalize(path).or_else(|_| std::path::absolute(path))
    }
    let identity = match source {
        ReviewSource::Git { directory, mode } => serde_json::to_string(&(
            "git",
            absolute(context.project.as_deref().unwrap_or(directory)).map_err(bad_request)?,
            mode,
        )),
        ReviewSource::Paths { before, after } => serde_json::to_string(&(
            "paths",
            absolute(before).map_err(bad_request)?,
            absolute(after).map_err(bad_request)?,
        )),
        ReviewSource::Difftool => serde_json::to_string(&("difftool", difftool)),
    };
    identity.map_err(bad_request)
}

fn start_review(
    context: BundleContext,
    saved: ReviewFeedback,
    identity: &str,
) -> Result<Review, ApiError> {
    let store = crate::storage::feedback_store().map_err(storage_error)?;
    let bundle = store
        .create_for_source(context, &saved, identity)
        .map_err(storage_error)?;
    Ok(Review { saved, bundle })
}

pub(crate) type ApiError = (StatusCode, String);

fn bad_request(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::BAD_REQUEST, error.to_string())
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn edit(
    workspace: Discussion,
    input: DiscussionInput,
    difftool: Option<DifftoolInput>,
) -> Result<DiscussionView, ApiError> {
    let DiscussionSelection {
        source,
        index,
        path,
    } = input.selection;
    let key = serde_json::to_string(&source).map_err(bad_request)?;
    let mut reviews = workspace.0.lock().map_err(storage_error)?;
    let current = reviews.get(&key);
    let mut next = current
        .map(|review| review.saved.clone())
        .unwrap_or_default();
    let Some(operation) = input.operation else {
        return Ok(view(&next, &path));
    };
    let mut new_context = None;
    match operation {
        Operation::Create {
            mut anchor,
            category,
            author,
            markdown,
        } => {
            let index = index
                .ok_or_else(|| bad_request("Choose a changed file before adding a comment."))?;
            let comparison =
                review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
            review_files::validate_selection(&comparison, index, &path).map_err(bad_request)?;
            if current.is_none() {
                new_context = Some(comparison.bundle_context(&source, difftool.as_ref()));
            }
            if matches!(anchor.target, AnchorTarget::ImageRegion { .. }) {
                let revision = comparison
                    .media_revision(index, anchor.side)
                    .map_err(bad_request)?;
                if anchor.path != path || anchor.is_stale(revision.as_deref()) {
                    return Err((
                        StatusCode::CONFLICT,
                        "The selected image has changed. Reopen the file before adding a comment."
                            .into(),
                    ));
                }
            } else {
                let text =
                    validate_line_anchor(&comparison, index, &path, &anchor, "adding a comment")?;
                anchor.quote = Some(text);
            }
            next.add(
                anchor,
                ThreadOrigin::Reviewer { category },
                author,
                markdown,
            )
            .map_err(bad_request)?;
        }
        Operation::Move {
            id,
            revision,
            mut anchor,
            if_text,
        } => {
            let index = index
                .ok_or_else(|| bad_request("Choose a changed file before moving a comment."))?;
            let comparison =
                review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
            review_files::validate_selection(&comparison, index, &path).map_err(bad_request)?;
            let existing = next
                .threads()
                .iter()
                .find(|thread| thread.id == id && thread.anchor.path == path)
                .map(|thread| (thread.anchor.side, thread.anchor.target))
                .ok_or_else(|| bad_request("The thread is unavailable in the selected file."))?;
            match (existing.1, anchor.target) {
                (AnchorTarget::Line { .. }, AnchorTarget::Line { .. }) => {
                    let text = validate_line_anchor(
                        &comparison,
                        index,
                        &path,
                        &anchor,
                        "moving the comment",
                    )?;
                    if if_text.is_some_and(|expected| expected != text) {
                        return Err((
                            StatusCode::CONFLICT,
                            "The suggested line has changed. Ask for a new suggestion.".into(),
                        ));
                    }
                    anchor.quote = Some(text);
                }
                (AnchorTarget::ImageRegion { .. }, AnchorTarget::ImageRegion { .. }) => {
                    // A region stays on its side of its image; only its bounds change (HS2-9MZ32M).
                    if anchor.side != existing.0 {
                        return Err(bad_request(
                            "A region comment stays on its side of the image.",
                        ));
                    }
                    let revision = comparison
                        .media_revision(index, anchor.side)
                        .map_err(bad_request)?;
                    if anchor.path != path || anchor.is_stale(revision.as_deref()) {
                        return Err((
                            StatusCode::CONFLICT,
                            "The selected image has changed. Reopen the file before moving the comment."
                                .into(),
                        ));
                    }
                    anchor.quote = None;
                }
                _ => {
                    return Err(bad_request(
                        "A line comment cannot become an image region, or the reverse.",
                    ));
                }
            }
            next.apply(id, revision, FeedbackChange::Move { anchor })
                .map_err(model_error)?;
        }
        Operation::Attach {
            id,
            revision,
            filename,
            content,
        } => {
            let bytes = BASE64_STANDARD.decode(content).map_err(bad_request)?;
            apply_change(
                &mut next,
                &path,
                id,
                revision,
                FeedbackChange::Attach {
                    message: MessageTarget::Opening,
                    filename,
                    bytes,
                },
            )?;
        }
        Operation::Apply {
            id,
            revision,
            change,
        } => {
            apply_change(&mut next, &path, id, revision, change)?;
        }
    }
    if let Some(review) = reviews.get_mut(&key) {
        review.bundle.publish(&next).map_err(storage_error)?;
        review.saved = next.clone();
    } else {
        let context =
            new_context.ok_or_else(|| bad_request("The selected discussion is unavailable."))?;
        let identity = source_identity(&source, &context, difftool.as_ref())?;
        reviews.insert(key, start_review(context, next.clone(), &identity)?);
    }
    Ok(view(&next, &path))
}

/// A line anchor must name a line the diff shows, on the revision the person is looking at.
fn validate_line_anchor(
    comparison: &review_files::Comparison,
    index: usize,
    path: &str,
    anchor: &ReviewAnchor,
    action: &str,
) -> Result<String, ApiError> {
    let hunks = comparison.text_hunks(index).map_err(bad_request)?;
    let revision = review_files::text_revision(&hunks).map_err(storage_error)?;
    let anchor_line = match anchor.target {
        AnchorTarget::Line { start, end } if start == end => Some(start),
        _ => None,
    };
    let text = anchor_line.and_then(|target| {
        hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .find(|line| {
                let number = match anchor.side {
                    AnchorSide::Before => line.before_line,
                    AnchorSide::After => line.after_line,
                };
                number == Some(target)
            })
            .map(|line| line.text.clone())
    });
    match text {
        Some(text) if anchor.path == path && !anchor.is_stale(Some(&revision)) => Ok(text),
        _ => Err((
            StatusCode::CONFLICT,
            format!("The selected line has changed. Reopen the file before {action}."),
        )),
    }
}

fn model_error(error: glassbox_model::feedback::FeedbackError) -> ApiError {
    use glassbox_model::feedback::FeedbackError;
    match error {
        FeedbackError::Conflict { .. } => (StatusCode::CONFLICT, error.to_string()),
        _ => bad_request(error),
    }
}

fn apply_change(
    next: &mut ReviewFeedback,
    path: &str,
    id: FeedbackId,
    revision: u32,
    change: FeedbackChange,
) -> Result<(), ApiError> {
    let thread = next
        .threads()
        .iter()
        .find(|thread| thread.id == id && thread.anchor.path == path);
    if thread.is_none() || matches!(change, FeedbackChange::Move { .. }) {
        return Err((
            StatusCode::BAD_REQUEST,
            "The thread is unavailable in the selected file.".into(),
        ));
    }
    next.apply(id, revision, change).map_err(model_error)
}

#[derive(Serialize)]
struct DiscussionView {
    threads: Vec<ThreadView>,
}

#[derive(Serialize)]
struct ThreadView {
    id: FeedbackId,
    revision: u32,
    anchor: ReviewAnchor,
    origin: ThreadOrigin,
    opening: MessageView,
    replies: Vec<ReplyView>,
}

#[derive(Serialize)]
struct ReplyView {
    id: FeedbackId,
    message: MessageView,
}

#[derive(Serialize)]
struct MessageView {
    author: String,
    markdown: String,
    attachments: Vec<AttachmentView>,
}

#[derive(Serialize)]
struct AttachmentView {
    id: FeedbackId,
    filename: String,
}

fn message_view(message: &FeedbackMessage) -> MessageView {
    MessageView {
        author: message.author.clone(),
        markdown: message.markdown.clone(),
        attachments: message
            .attachments
            .iter()
            .map(|item| AttachmentView {
                id: item.id,
                filename: item.filename.clone(),
            })
            .collect(),
    }
}

fn view(feedback: &ReviewFeedback, path: &str) -> DiscussionView {
    DiscussionView {
        threads: feedback
            .threads()
            .iter()
            .filter(|thread| thread.anchor.path == path)
            .map(|thread| ThreadView {
                id: thread.id,
                revision: thread.revision,
                anchor: thread.anchor.clone(),
                origin: thread.origin.clone(),
                opening: message_view(&thread.opening),
                replies: thread
                    .replies
                    .iter()
                    .map(|reply| ReplyView {
                        id: reply.id,
                        message: message_view(&reply.message),
                    })
                    .collect(),
            })
            .collect(),
    }
}
