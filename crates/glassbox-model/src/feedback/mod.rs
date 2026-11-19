mod anchor;

use std::collections::HashSet;
use std::fmt;

pub use anchor::{AnchorSide, AnchorTarget, ReviewAnchor};
use serde::{Deserialize, Serialize};

pub const MAX_ATTACHMENT_BYTES: usize = 50_000_000;

pub type FeedbackId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewerCategory {
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
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ThreadOrigin {
    Reviewer {
        category: ReviewerCategory,
    },
    Ai {
        tags: Vec<String>,
        risk: Option<RiskLevel>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedbackAttachment {
    pub id: FeedbackId,
    pub filename: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedbackMessage {
    pub author: String,
    pub markdown: String,
    pub attachments: Vec<FeedbackAttachment>,
}

impl FeedbackMessage {
    fn new(author: String, markdown: String) -> Result<Self, FeedbackError> {
        valid_text(&author)?;
        valid_text(&markdown)?;
        Ok(Self {
            author,
            markdown,
            attachments: Vec::new(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedbackReply {
    pub id: FeedbackId,
    pub message: FeedbackMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeedbackThread {
    pub id: FeedbackId,
    pub revision: u32,
    pub anchor: ReviewAnchor,
    pub origin: ThreadOrigin,
    pub opening: FeedbackMessage,
    pub replies: Vec<FeedbackReply>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MessageTarget {
    Opening,
    Reply { id: FeedbackId },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FeedbackChange {
    Edit {
        message: MessageTarget,
        markdown: String,
    },
    Categorize {
        category: ReviewerCategory,
    },
    Move {
        anchor: ReviewAnchor,
    },
    Reply {
        author: String,
        markdown: String,
    },
    RemoveReply {
        id: FeedbackId,
    },
    Attach {
        message: MessageTarget,
        filename: String,
        bytes: Vec<u8>,
    },
    Detach {
        message: MessageTarget,
        id: FeedbackId,
    },
    RemoveThread,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "StoredFeedback")]
pub struct ReviewFeedback {
    next_id: FeedbackId,
    threads: Vec<FeedbackThread>,
}

#[derive(Deserialize)]
struct StoredFeedback {
    next_id: FeedbackId,
    threads: Vec<FeedbackThread>,
}

impl Default for ReviewFeedback {
    fn default() -> Self {
        Self {
            next_id: 1,
            threads: Vec::new(),
        }
    }
}

impl ReviewFeedback {
    pub fn threads(&self) -> &[FeedbackThread] {
        &self.threads
    }

    pub fn add(
        &mut self,
        anchor: ReviewAnchor,
        origin: ThreadOrigin,
        author: String,
        markdown: String,
    ) -> Result<FeedbackId, FeedbackError> {
        anchor.validate()?;
        validate_origin(&origin)?;
        let opening = FeedbackMessage::new(author, markdown)?;
        let id = allocate(&mut self.next_id)?;
        self.threads.push(FeedbackThread {
            id,
            revision: 1,
            anchor,
            origin,
            opening,
            replies: Vec::new(),
        });
        Ok(id)
    }

    pub fn apply(
        &mut self,
        id: FeedbackId,
        expected_revision: u32,
        change: FeedbackChange,
    ) -> Result<(), FeedbackError> {
        let index = position(&self.threads, |thread| thread.id == id)?;
        let thread = &mut self.threads[index];
        if thread.revision != expected_revision {
            return Err(FeedbackError::Conflict {
                actual: thread.revision,
            });
        }
        if change == FeedbackChange::RemoveThread {
            self.threads.remove(index);
            return Ok(());
        }
        let revision = thread.revision.checked_add(1).ok_or(FeedbackError::Limit)?;
        match change {
            FeedbackChange::Edit { message, markdown } => {
                valid_text(&markdown)?;
                thread.message_mut(message)?.markdown = markdown;
            }
            FeedbackChange::Categorize { category } => {
                let ThreadOrigin::Reviewer { category: current } = &mut thread.origin else {
                    return Err(FeedbackError::InvalidCategory);
                };
                *current = category;
            }
            FeedbackChange::Move { anchor } => {
                anchor.validate()?;
                thread.anchor = anchor;
            }
            FeedbackChange::Reply { author, markdown } => {
                let message = FeedbackMessage::new(author, markdown)?;
                let id = allocate(&mut self.next_id)?;
                thread.replies.push(FeedbackReply { id, message });
            }
            FeedbackChange::RemoveReply { id } => {
                let index = position(&thread.replies, |reply| reply.id == id)?;
                thread.replies.remove(index);
            }
            FeedbackChange::Attach {
                message,
                filename,
                bytes,
            } => {
                validate_attachment(&filename, bytes.len())?;
                let target = thread.message_mut(message)?;
                let id = allocate(&mut self.next_id)?;
                target.attachments.push(FeedbackAttachment {
                    id,
                    filename,
                    bytes,
                });
            }
            FeedbackChange::Detach { message, id } => {
                let attachments = &mut thread.message_mut(message)?.attachments;
                let index = position(attachments, |attachment| attachment.id == id)?;
                attachments.remove(index);
            }
            FeedbackChange::RemoveThread => unreachable!("handled before mutation"),
        }
        thread.revision = revision;
        Ok(())
    }
}

impl FeedbackThread {
    fn message_mut(
        &mut self,
        target: MessageTarget,
    ) -> Result<&mut FeedbackMessage, FeedbackError> {
        match target {
            MessageTarget::Opening => Ok(&mut self.opening),
            MessageTarget::Reply { id } => self
                .replies
                .iter_mut()
                .find(|reply| reply.id == id)
                .map(|reply| &mut reply.message)
                .ok_or(FeedbackError::NotFound),
        }
    }
}

impl TryFrom<StoredFeedback> for ReviewFeedback {
    type Error = FeedbackError;

    fn try_from(stored: StoredFeedback) -> Result<Self, Self::Error> {
        if stored.next_id == 0 {
            return Err(FeedbackError::InvalidState);
        }
        let mut ids = HashSet::new();
        let mut check_id = |id| {
            if id == 0 || id >= stored.next_id || !ids.insert(id) {
                return Err(FeedbackError::InvalidState);
            }
            Ok(())
        };
        for thread in &stored.threads {
            check_id(thread.id)?;
            if thread.revision == 0 {
                return Err(FeedbackError::InvalidState);
            }
            thread.anchor.validate()?;
            validate_origin(&thread.origin)?;
            for reply in &thread.replies {
                check_id(reply.id)?;
            }
            for message in std::iter::once(&thread.opening)
                .chain(thread.replies.iter().map(|reply| &reply.message))
            {
                valid_text(&message.author)?;
                valid_text(&message.markdown)?;
                for attachment in &message.attachments {
                    check_id(attachment.id)?;
                    validate_attachment(&attachment.filename, attachment.bytes.len())?;
                }
            }
        }
        Ok(Self {
            next_id: stored.next_id,
            threads: stored.threads,
        })
    }
}

fn validate_origin(origin: &ThreadOrigin) -> Result<(), FeedbackError> {
    if let ThreadOrigin::Ai { tags, .. } = origin {
        for tag in tags {
            valid_text(tag)?;
        }
    }
    Ok(())
}

fn valid_text(text: &str) -> Result<(), FeedbackError> {
    if text.trim().is_empty() {
        return Err(FeedbackError::EmptyText);
    }
    Ok(())
}

fn validate_attachment(filename: &str, size: usize) -> Result<(), FeedbackError> {
    if matches!(filename.trim(), "" | "." | "..")
        || filename.contains(['/', '\\', ':'])
        || filename.chars().any(char::is_control)
    {
        return Err(FeedbackError::InvalidFilename);
    }
    if size > MAX_ATTACHMENT_BYTES {
        return Err(FeedbackError::AttachmentTooLarge);
    }
    Ok(())
}

fn position<T>(values: &[T], matches: impl FnMut(&T) -> bool) -> Result<usize, FeedbackError> {
    values
        .iter()
        .position(matches)
        .ok_or(FeedbackError::NotFound)
}

fn allocate(next: &mut FeedbackId) -> Result<FeedbackId, FeedbackError> {
    let id = *next;
    *next = id.checked_add(1).ok_or(FeedbackError::Limit)?;
    Ok(id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedbackError {
    NotFound,
    Conflict { actual: u32 },
    InvalidAnchor,
    InvalidCategory,
    EmptyText,
    InvalidFilename,
    AttachmentTooLarge,
    InvalidState,
    Limit,
}

impl fmt::Display for FeedbackError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict { actual } => {
                write!(formatter, "The thread is now at revision {actual}")
            }
            error => formatter.write_str(match error {
                Self::NotFound => "The feedback item does not exist",
                Self::InvalidAnchor => "The review anchor is invalid",
                Self::InvalidCategory => "This thread has no reviewer category",
                Self::EmptyText => "Feedback text must not be empty",
                Self::InvalidFilename => "An attachment needs a plain filename",
                Self::AttachmentTooLarge => "The attachment exceeds 50 MB",
                Self::InvalidState => "The saved feedback state is invalid",
                Self::Limit => "The feedback identifier or revision limit was reached",
                Self::Conflict { .. } => unreachable!(),
            }),
        }
    }
}

impl std::error::Error for FeedbackError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_attachments_by_bytes_and_keeps_the_exact_boundary() {
        assert_eq!(validate_attachment("raw.data", 0), Ok(()));
        assert_eq!(
            validate_attachment("raw.data", MAX_ATTACHMENT_BYTES),
            Ok(())
        );
        assert_eq!(
            validate_attachment("raw.data", MAX_ATTACHMENT_BYTES + 1),
            Err(FeedbackError::AttachmentTooLarge)
        );
    }
}
