use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NoteKind {
    Rationale,
    Proof,
    Assumption,
    AlternativeConsidered,
    Risk,
    TestEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteOrigin {
    pub producer: String,
    pub producer_version: Option<String>,
    pub repository_uri: Option<String>,
    pub revision: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteArtifact {
    pub path: String,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteRelatedLocation {
    pub id: u32,
    pub path: String,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewNote {
    pub id: String,
    pub source: String,
    pub kind: NoteKind,
    pub markdown: String,
    pub start_line: u32,
    pub end_line: u32,
    pub snippet: Option<String>,
    pub fingerprint: Option<String>,
    pub confidence: Option<f64>,
    pub rank: Option<f64>,
    pub origin: NoteOrigin,
    pub tickets: Vec<String>,
    pub related: Vec<NoteRelatedLocation>,
    pub artifacts: Vec<NoteArtifact>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteAnchor {
    Original { line: u32 },
    Moved { line: u32 },
    Stale { line: u32 },
    OutsideDiff,
}
