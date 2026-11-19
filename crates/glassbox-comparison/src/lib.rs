//! Comparison sources for Glassbox review.
mod git;
mod paths;

pub use git::{GitChange, GitFileChange, GitReview, GitReviewMode, review_git};
pub use paths::compare_paths;
