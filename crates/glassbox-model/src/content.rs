use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub before_line: Option<u32>,
    pub after_line: Option<u32>,
    pub text: String,
    pub ends_with_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextHunk {
    pub before_start: u32,
    pub before_count: u32,
    pub after_start: u32,
    pub after_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LfsObject {
    pub oid: String,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LfsUnavailableReason {
    Missing,
    Mismatched,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnavailableLfsObject {
    pub object: LfsObject,
    pub reason: LfsUnavailableReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaAsset {
    pub content_type: &'static str,
    pub bytes: Vec<u8>,
    pub lfs_object: Option<LfsObject>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComparisonData {
    Text(Vec<TextHunk>),
    Media {
        before: Option<MediaAsset>,
        after: Option<MediaAsset>,
    },
    UnavailableLfs {
        before: Option<UnavailableLfsObject>,
        after: Option<UnavailableLfsObject>,
    },
    Binary,
}
