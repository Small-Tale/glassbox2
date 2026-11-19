//! Reads Glassbox v1 SARIF notes and maps their anchors onto new-side diff lines.
mod anchor;
mod sarif;

pub use anchor::anchor_note;
pub use sarif::{load_review_notes, parse_review_notes};
