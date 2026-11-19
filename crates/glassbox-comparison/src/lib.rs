//! Comparison sources for Glassbox review.
mod content;
mod git;
mod paths;

pub use content::{compare_direct_content, compare_git_content, parse_hunks};
pub use git::{GitChange, GitFileChange, GitReview, GitReviewMode, review_git};
pub use paths::compare_paths;
