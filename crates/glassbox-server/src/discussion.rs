use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::prelude::*;
use glassbox_feedback::{
    BundleContext, BundleStore, ExportRequest, FeedbackBundle, HotSheetClient, PreparedExport,
};
use glassbox_model::DifftoolInput;
use glassbox_model::analysis::{AnalysisResult, FileAnalysis};
use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackChange, FeedbackId, FeedbackMessage, MessageTarget,
    ReviewAnchor, ReviewFeedback, ReviewerCategory, RiskLevel, ThreadOrigin,
};
use serde::{Deserialize, Serialize};

use crate::review_files::{self, ReviewSource, SelectedFile};

#[derive(Default, Clone)]
pub(crate) struct Discussion(Arc<Mutex<BTreeMap<String, Review>>>);

struct Review {
    saved: ReviewFeedback,
    bundle: FeedbackBundle,
}

#[derive(Deserialize)]
pub(crate) struct DiscussionInput {
    selection: SelectedFile,
    operation: Option<Operation>,
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
    let review = start_review(context, ReviewFeedback::default())?;
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
}

impl Discussion {
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
        let attachments = threads
            .iter()
            .flat_map(|thread| {
                std::iter::once(&thread.opening)
                    .chain(thread.replies.iter().map(|reply| &reply.message))
            })
            .map(|message| message.attachments.len())
            .sum();
        Ok(Preview {
            threads: threads.len(),
            replies: threads.iter().map(|thread| thread.replies.len()).sum(),
            attachments,
            paths: paths.into_iter().collect(),
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
                };
                let origin = ThreadOrigin::Ai {
                    tags: vec![tag.into()],
                    risk,
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
                reviews.insert(key, start_review(context, next)?);
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
    ) -> Result<PreparedExport, ApiError> {
        with_review(self, source, difftool, |review| {
            review
                .bundle
                .prepare_export(client, request)
                .map_err(storage_error)
        })
    }
}

fn start_review(context: BundleContext, saved: ReviewFeedback) -> Result<Review, ApiError> {
    let store = if let Some(directory) = std::env::var_os("GLASSBOX_FEEDBACK_DIRECTORY") {
        BundleStore::in_directory(PathBuf::from(directory))
    } else {
        BundleStore::for_current_user().map_err(storage_error)?
    };
    let bundle = store.create(context, &saved).map_err(storage_error)?;
    Ok(Review { saved, bundle })
}

type ApiError = (StatusCode, String);

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
    let SelectedFile {
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
    let comparison = review_files::load(source.clone(), difftool.clone()).map_err(bad_request)?;
    review_files::validate_selection(&comparison, index, &path).map_err(bad_request)?;
    match operation {
        Operation::Create {
            anchor,
            category,
            author,
            markdown,
        } => {
            let hunks = comparison.text_hunks(index).map_err(bad_request)?;
            let revision = review_files::text_revision(&hunks).map_err(storage_error)?;
            let anchor_line = match anchor.target {
                AnchorTarget::Line { start, end } if start == end => Some(start),
                _ => None,
            };
            let has_line = anchor_line.is_some_and(|target| {
                hunks.iter().flat_map(|hunk| &hunk.lines).any(|line| {
                    let number = match anchor.side {
                        AnchorSide::Before => line.before_line,
                        AnchorSide::After => line.after_line,
                    };
                    number == Some(target)
                })
            });
            if anchor.path != path || anchor.is_stale(Some(&revision)) || !has_line {
                return Err((
                    StatusCode::CONFLICT,
                    "The selected line has changed. Reopen the file before adding a comment."
                        .into(),
                ));
            }
            next.add(
                anchor,
                ThreadOrigin::Reviewer { category },
                author,
                markdown,
            )
            .map_err(bad_request)?;
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
        let context = comparison.bundle_context(&source, difftool.as_ref());
        reviews.insert(key, start_review(context, next.clone())?);
    }
    Ok(view(&next, &path))
}

fn apply_change(
    next: &mut ReviewFeedback,
    path: &str,
    id: FeedbackId,
    revision: u32,
    change: FeedbackChange,
) -> Result<(), ApiError> {
    use glassbox_model::feedback::FeedbackError;
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
    next.apply(id, revision, change)
        .map_err(|error| match error {
            FeedbackError::Conflict { .. } => (StatusCode::CONFLICT, error.to_string()),
            _ => bad_request(error),
        })
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
