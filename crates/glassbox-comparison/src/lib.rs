//! Comparison sources for Glassbox review.
mod content;
mod git;
mod lfs;
mod paths;

pub use content::{compare_direct_content, compare_git_content, compare_text_bytes, parse_hunks};
pub use git::{GitChange, GitFileChange, GitReview, GitReviewMode, review_git};
pub use paths::{compare_difftool_paths, compare_paths};
