//! Client-neutral contracts shared by the local service and native clients.

use serde::{Deserialize, Serialize};

pub const API_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub api_version: u16,
    pub status: ServiceStatus,
}

impl ServiceHealth {
    pub const fn ready() -> Self {
        Self {
            api_version: API_VERSION,
            status: ServiceStatus::Ready,
        }
    }
}

mod comparison;
mod content;
mod difftool;
pub mod feedback;
mod settings;

pub use comparison::{Change, ComparisonEntry, ContentKind, EntrySide};
pub use content::{
    ComparisonData, DiffLine, DiffLineKind, LfsObject, LfsUnavailableReason, MediaAsset, TextHunk,
    UnavailableLfsObject,
};
pub use difftool::DifftoolInput;
pub use settings::{Appearance, ApplicationSettings};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ready_health_uses_the_public_wire_shape() {
        let response = ServiceHealth::ready();
        let wire = serde_json::to_value(response).unwrap();
        assert_eq!(wire, json!({ "api_version": 1, "status": "ready" }));
        assert_eq!(
            serde_json::from_value::<ServiceHealth>(wire).unwrap(),
            response
        );
    }
}
