use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::prelude::*;
use glassbox_feedback::{BundleStore, FeedbackBundle};
use glassbox_model::DifftoolInput;
use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackChange, FeedbackId, FeedbackMessage, MessageTarget,
    ReviewAnchor, ReviewFeedback, ReviewerCategory, ThreadOrigin,
};
use serde::{Deserialize, Serialize};

use crate::review_files::{self, SelectedFile};

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
    let source_copy = serde_json::from_str(&key).map_err(bad_request)?;
    let comparison = review_files::load(source_copy, difftool.clone()).map_err(bad_request)?;
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
        let store = if let Some(directory) = std::env::var_os("GLASSBOX_FEEDBACK_DIRECTORY") {
            BundleStore::in_directory(PathBuf::from(directory))
        } else {
            BundleStore::for_current_user().map_err(storage_error)?
        };
        let bundle = store.create(context, &next).map_err(storage_error)?;
        reviews.insert(
            key,
            Review {
                saved: next.clone(),
                bundle,
            },
        );
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
