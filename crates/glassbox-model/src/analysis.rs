use crate::feedback::{AnchorSide, SourceLocation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisMode {
    Risk,
    Narrative,
    Guidance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiskScores {
    pub security: f32,
    pub correctness: f32,
    pub error_handling: f32,
    pub maintainability: f32,
    pub architecture: f32,
    pub performance: f32,
}

impl RiskScores {
    pub fn aggregate(&self) -> Option<f32> {
        let scores = [
            self.security,
            self.correctness,
            self.error_handling,
            self.maintainability,
            self.architecture,
            self.performance,
        ];
        scores
            .into_iter()
            .all(|score| (0.0..=1.0).contains(&score))
            .then(|| scores.into_iter().fold(0.0, f32::max))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub side: AnchorSide,
    pub line: u32,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_locations: Vec<Option<SourceLocation>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FileAnalysis {
    Risk {
        scores: RiskScores,
        aggregate: f32,
        rationale: String,
        observations: Vec<Observation>,
    },
    Guidance {
        overview: String,
        steps: Vec<Observation>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzedFile {
    pub path: String,
    pub revision: String,
    pub analysis: FileAnalysis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NarrativeStep {
    pub path: String,
    pub revision: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileAnalysisFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub mode: AnalysisMode,
    pub files: Vec<AnalyzedFile>,
    pub narrative: Vec<NarrativeStep>,
    pub skipped: Vec<String>,
    #[serde(default)]
    pub failures: Vec<FileAnalysisFailure>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AnalysisStatus {
    Running { completed: usize, total: usize },
    Complete { result: AnalysisResult },
    Partial { result: AnalysisResult },
    Cancelled,
    Stale,
    Unavailable { message: String },
    Failed { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisJob {
    pub id: u64,
    #[serde(flatten)]
    pub state: AnalysisStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_uses_the_highest_dimension_and_rejects_out_of_range_scores() {
        let mut scores = RiskScores {
            security: 0.2,
            correctness: 0.8,
            error_handling: 0.2,
            maintainability: 0.3,
            architecture: 0.1,
            performance: 0.0,
        };
        assert_eq!(scores.aggregate(), Some(0.8));
        scores.security = 1.01;
        assert_eq!(scores.aggregate(), None);
        scores.security = -0.01;
        assert_eq!(scores.aggregate(), None);
    }
}
