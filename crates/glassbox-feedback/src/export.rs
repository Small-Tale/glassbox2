//! The documented, versioned JSON export of a review (HS2-A07MHD).
//!
//! These types are the public contract in `docs/feedback-export.md`. They are deliberately separate from the
//! feedback model and the editable snapshot: renaming a model field must never change what a consumer reads,
//! and the snapshot format can evolve without a schema version bump here.

use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackMessage, FeedbackThread, ReviewerCategory, RiskLevel,
    ThreadOrigin,
};
use serde::{Deserialize, Serialize};

use crate::{ATTACHMENTS, BundleContext, attachment_filename};

/// The file beside `review.md` that holds the export.
pub const EXPORT_FILENAME: &str = "feedback.json";
/// Additive changes keep the version; removing or reinterpreting a field bumps it.
pub const EXPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeedbackExport {
    pub schema_version: u32,
    pub context: ExportContext,
    pub threads: Vec<ExportThread>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    pub comparison: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportThread {
    pub id: u32,
    pub file: String,
    pub side: ExportSide,
    pub revision: String,
    pub target: ExportAnchorTarget,
    /// The anchored line's text when it was recorded; absent for older comments, ranges and AI notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_text: Option<String>,
    pub origin: ExportOrigin,
    /// The opening message first, then the replies in order.
    pub messages: Vec<ExportMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportSide {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExportAnchorTarget {
    /// One-based, inclusive.
    Line { start: u32, end: u32 },
    /// Fractions from 0 to 1 of the untransformed image.
    ImageRegion {
        left: f64,
        top: f64,
        width: f64,
        height: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExportOrigin {
    Reviewer {
        category: ExportCategory,
    },
    Ai {
        tags: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        risk: Option<ExportRisk>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExportCategory {
    Bug,
    Fix,
    Style,
    PatternFollow,
    PatternAvoid,
    Note,
    Remember,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportMessage {
    pub kind: ExportMessageKind,
    /// The reply's ID; absent on the opening message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<u32>,
    pub author: String,
    pub markdown: String,
    pub attachments: Vec<ExportAttachment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportMessageKind {
    Opening,
    Reply,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportAttachment {
    /// The name the file had when it was attached.
    pub filename: String,
    /// Relative to the directory that holds `feedback.json`.
    pub path: String,
    pub bytes: u64,
}

impl FeedbackExport {
    pub(crate) fn new(context: &BundleContext, threads: &[FeedbackThread]) -> Self {
        Self {
            schema_version: EXPORT_SCHEMA_VERSION,
            context: ExportContext {
                project: context
                    .project
                    .as_ref()
                    .map(|project| project.to_string_lossy().into_owned()),
                comparison: context.comparison.clone(),
                before: context.before.clone(),
                after: context.after.clone(),
            },
            threads: threads.iter().map(ExportThread::from).collect(),
        }
    }
}

impl From<&FeedbackThread> for ExportThread {
    fn from(thread: &FeedbackThread) -> Self {
        let opening = ExportMessage::new(ExportMessageKind::Opening, None, &thread.opening);
        let replies = thread.replies.iter().map(|reply| {
            ExportMessage::new(ExportMessageKind::Reply, Some(reply.id), &reply.message)
        });
        Self {
            id: thread.id,
            file: thread.anchor.path.clone(),
            side: match thread.anchor.side {
                AnchorSide::Before => ExportSide::Before,
                AnchorSide::After => ExportSide::After,
            },
            revision: thread.anchor.revision.clone(),
            target: match thread.anchor.target {
                AnchorTarget::Line { start, end } => ExportAnchorTarget::Line { start, end },
                AnchorTarget::ImageRegion {
                    left,
                    top,
                    width,
                    height,
                } => ExportAnchorTarget::ImageRegion {
                    left,
                    top,
                    width,
                    height,
                },
            },
            line_text: thread.anchor.quote.clone(),
            origin: match &thread.origin {
                ThreadOrigin::Reviewer { category } => ExportOrigin::Reviewer {
                    category: match category {
                        ReviewerCategory::Bug => ExportCategory::Bug,
                        ReviewerCategory::Fix => ExportCategory::Fix,
                        ReviewerCategory::Style => ExportCategory::Style,
                        ReviewerCategory::PatternFollow => ExportCategory::PatternFollow,
                        ReviewerCategory::PatternAvoid => ExportCategory::PatternAvoid,
                        ReviewerCategory::Note => ExportCategory::Note,
                        ReviewerCategory::Remember => ExportCategory::Remember,
                    },
                },
                ThreadOrigin::Ai { tags, risk, .. } => ExportOrigin::Ai {
                    tags: tags.clone(),
                    risk: risk.map(|risk| match risk {
                        RiskLevel::Low => ExportRisk::Low,
                        RiskLevel::Medium => ExportRisk::Medium,
                        RiskLevel::High => ExportRisk::High,
                    }),
                },
            },
            messages: std::iter::once(opening).chain(replies).collect(),
        }
    }
}

impl ExportMessage {
    fn new(kind: ExportMessageKind, id: Option<u32>, message: &FeedbackMessage) -> Self {
        Self {
            kind,
            id,
            author: message.author.clone(),
            markdown: message.markdown.clone(),
            attachments: message
                .attachments
                .iter()
                .map(|attachment| ExportAttachment {
                    filename: attachment.filename.clone(),
                    path: format!("{ATTACHMENTS}/{}", attachment_filename(attachment)),
                    bytes: attachment.bytes.len() as u64,
                })
                .collect(),
        }
    }
}
