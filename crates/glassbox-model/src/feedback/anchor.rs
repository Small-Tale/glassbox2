use serde::{Deserialize, Serialize};

use super::FeedbackError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnchorSide {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AnchorTarget {
    Line {
        start: u32,
        end: u32,
    },
    ImageRegion {
        left: f64,
        top: f64,
        width: f64,
        height: f64,
    },
}

impl AnchorTarget {
    fn valid(self) -> bool {
        match self {
            Self::Line { start, end } => start > 0 && start <= end,
            Self::ImageRegion {
                left,
                top,
                width,
                height,
            } => {
                left >= 0.0
                    && top >= 0.0
                    && width > 0.0
                    && height > 0.0
                    && left + width <= 1.0
                    && top + height <= 1.0
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewAnchor {
    pub path: String,
    pub side: AnchorSide,
    pub revision: String,
    pub target: AnchorTarget,
}

impl ReviewAnchor {
    pub fn is_stale(&self, current_revision: Option<&str>) -> bool {
        current_revision != Some(&self.revision)
    }

    pub(super) fn validate(&self) -> Result<(), FeedbackError> {
        let valid_path = !self.path.contains(['\\', '\0'])
            && self
                .path
                .split('/')
                .all(|part| !matches!(part, "" | "." | ".."))
            && self.path.as_bytes().get(1) != Some(&b':');
        if !valid_path || self.revision.trim().is_empty() || !self.target.valid() {
            return Err(FeedbackError::InvalidAnchor);
        }
        Ok(())
    }
}
