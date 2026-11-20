mod input;
mod provider;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use glassbox_model::DifftoolInput;
use glassbox_model::analysis::{
    AnalysisJob, AnalysisMode, AnalysisResult, AnalysisStatus, FileAnalysisFailure,
};
use serde::Deserialize;
use tokio::task::AbortHandle;

use self::{input::capture, provider::Provider};
use crate::discussion::Discussion;
use crate::review_files::ReviewSource;

const MAX_JOBS: usize = 64;
const MAX_ACTIVE: usize = 4;

#[derive(Clone)]
pub(crate) struct Analysis {
    jobs: Arc<Mutex<Jobs>>,
    difftool: Option<DifftoolInput>,
    discussion: Discussion,
}

#[derive(Default)]
struct Jobs {
    next: u64,
    closed: bool,
    entries: BTreeMap<u64, Job>,
}

struct Job {
    state: AnalysisStatus,
    abort: AbortHandle,
}

#[derive(Deserialize)]
pub(crate) struct Start {
    source: ReviewSource,
    mode: AnalysisMode,
}

impl Analysis {
    pub(crate) fn new(discussion: Discussion, difftool: Option<DifftoolInput>) -> Self {
        Self {
            jobs: Arc::default(),
            difftool,
            discussion,
        }
    }

    pub(crate) fn start(&self, request: Start) -> Response {
        let Ok(mut jobs) = self.jobs.lock() else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        if jobs.closed {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        if jobs
            .entries
            .values()
            .filter(|job| running(&job.state))
            .count()
            >= MAX_ACTIVE
        {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                "Cancel an active analysis before starting another.",
            )
                .into_response();
        }
        if jobs.entries.len() >= MAX_JOBS {
            let oldest = jobs
                .entries
                .iter()
                .find_map(|(id, job)| (!running(&job.state)).then_some(*id));
            if let Some(id) = oldest {
                jobs.entries.remove(&id);
            }
        }
        jobs.next += 1;
        let id = jobs.next;
        let state = AnalysisStatus::Running {
            completed: 0,
            total: 0,
        };
        let analysis = self.clone();
        let task = tokio::spawn(async move {
            let outcome = analysis.run(id, request).await;
            analysis.update(id, outcome);
        });
        jobs.entries.insert(
            id,
            Job {
                state: state.clone(),
                abort: task.abort_handle(),
            },
        );
        Json(AnalysisJob { id, state }).into_response()
    }

    pub(crate) fn shutdown(&self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.closed = true;
            for job in jobs.entries.values_mut() {
                if running(&job.state) {
                    job.state = AnalysisStatus::Cancelled;
                    job.abort.abort();
                }
            }
        }
    }

    pub(crate) fn status(&self, id: u64, cancel: bool) -> Response {
        let Ok(mut jobs) = self.jobs.lock() else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let Some(job) = jobs.entries.get_mut(&id) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        if cancel && running(&job.state) {
            job.state = AnalysisStatus::Cancelled;
            job.abort.abort();
        }
        Json(AnalysisJob {
            id,
            state: job.state.clone(),
        })
        .into_response()
    }

    fn update(&self, id: u64, state: AnalysisStatus) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(job) = jobs.entries.get_mut(&id) {
                if running(&job.state) {
                    job.state = state;
                }
            }
        }
    }

    async fn run(&self, id: u64, request: Start) -> AnalysisStatus {
        let provider = match Provider::configured().await {
            Ok(provider) => provider,
            Err(message) => return AnalysisStatus::Unavailable { message },
        };
        let snapshot = match capture(request.source.clone(), self.difftool.clone()).await {
            Ok(snapshot) => snapshot,
            Err(error) => return failed(error),
        };
        let total = match request.mode {
            AnalysisMode::Narrative => usize::from(!snapshot.files.is_empty()),
            AnalysisMode::Risk | AnalysisMode::Guidance => snapshot.files.len(),
        };
        self.update(
            id,
            AnalysisStatus::Running {
                completed: 0,
                total,
            },
        );
        let mut result = AnalysisResult {
            mode: request.mode,
            files: Vec::new(),
            narrative: Vec::new(),
            skipped: snapshot.skipped.clone(),
            failures: Vec::new(),
        };
        if request.mode == AnalysisMode::Narrative && total > 0 {
            match provider.narrative(&snapshot.files).await {
                Ok(narrative) => result.narrative = narrative,
                Err(error) => return failed(error),
            }
        } else {
            for (index, file) in snapshot.files.iter().enumerate() {
                match provider.analyze_file(request.mode, file).await {
                    Ok(file) => result.files.push(file),
                    Err(message) => result.failures.push(FileAnalysisFailure {
                        path: file.path.clone(),
                        message,
                    }),
                }
                self.update(
                    id,
                    AnalysisStatus::Running {
                        completed: index + 1,
                        total,
                    },
                );
            }
        }
        if result.files.is_empty() {
            if let Some(first) = result.failures.first() {
                return failed(format!("{}: {}", first.path, first.message));
            }
        }
        match capture(request.source.clone(), self.difftool.clone()).await {
            Ok(current) if current == snapshot => (),
            Ok(_) => return AnalysisStatus::Stale,
            Err(error) => return failed(error),
        }
        let analysis = self.clone();
        match tokio::task::spawn_blocking(move || analysis.publish(id, request.source, result))
            .await
        {
            Ok(state) => state,
            Err(error) => failed(error),
        }
    }

    fn publish(&self, id: u64, source: ReviewSource, result: AnalysisResult) -> AnalysisStatus {
        let Ok(mut jobs) = self.jobs.lock() else {
            return failed("Could not complete the analysis.");
        };
        let Some(job) = jobs.entries.get_mut(&id) else {
            return AnalysisStatus::Cancelled;
        };
        if !running(&job.state) {
            return job.state.clone();
        }
        let state = match self
            .discussion
            .publish_analysis(&source, self.difftool.clone(), &result)
        {
            Ok(()) if result.failures.is_empty() => AnalysisStatus::Complete { result },
            Ok(()) => AnalysisStatus::Partial { result },
            Err((_, message)) => failed(message),
        };
        job.state = state.clone();
        state
    }
}

fn running(state: &AnalysisStatus) -> bool {
    matches!(state, AnalysisStatus::Running { .. })
}

fn failed(error: impl std::fmt::Display) -> AnalysisStatus {
    AnalysisStatus::Failed {
        message: error.to_string(),
    }
}
