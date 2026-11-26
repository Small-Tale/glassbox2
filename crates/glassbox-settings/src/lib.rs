//! File-backed Glassbox application preferences shared by local clients.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

use fs2::FileExt;
use glassbox_model::ApplicationSettings;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tempfile::NamedTempFile;

const SETTINGS_VERSION: u32 = 1;
const ANALYSIS: &str = "analysis";
const PROGRESS: &str = "reviewProgress";

/// Reviewed files of one comparison: each path with the revision of the content that was reviewed (HS2-FTEQVQ).
pub type ReviewedFiles = BTreeMap<String, String>;

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnalysisPreferences {
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub guidance_topics: BTreeSet<GuidanceTopic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuidanceTopic {
    Architecture,
    Dependencies,
    ErrorHandling,
    Performance,
    Testing,
}

impl GuidanceTopic {
    pub fn label(self) -> &'static str {
        match self {
            Self::Architecture => "architecture",
            Self::Dependencies => "dependencies",
            Self::ErrorHandling => "error handling",
            Self::Performance => "performance",
            Self::Testing => "testing",
        }
    }
}

#[derive(Debug)]
pub enum SettingsError {
    MissingHome,
    Io(io::Error),
    Json(serde_json::Error),
    UnsupportedVersion(u32),
}

impl fmt::Display for SettingsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingHome => formatter.write_str("Could not determine the user home directory"),
            Self::Io(error) => write!(formatter, "Could not access Glassbox settings: {error}"),
            Self::Json(error) => write!(formatter, "Could not decode Glassbox settings: {error}"),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "Unsupported Glassbox settings version {version}")
            }
        }
    }
}

impl std::error::Error for SettingsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::MissingHome | Self::UnsupportedVersion(_) => None,
        }
    }
}

impl From<io::Error> for SettingsError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for SettingsError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Default, Serialize, Deserialize)]
struct SettingsFile {
    #[serde(default)]
    version: u32,
    #[serde(flatten)]
    settings: ApplicationSettings,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

pub struct SettingsStore {
    directory: PathBuf,
}

impl SettingsStore {
    pub fn for_current_user() -> Result<Self, SettingsError> {
        if let Some(directory) = std::env::var_os("GLASSBOX_SETTINGS_DIRECTORY")
            .filter(|directory| !directory.is_empty())
        {
            return Ok(Self::in_directory(directory));
        }
        let home = std::env::home_dir().ok_or(SettingsError::MissingHome)?;
        Ok(Self::in_directory(home.join(".glassbox2")))
    }

    pub fn in_directory(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub fn load(&self) -> Result<ApplicationSettings, SettingsError> {
        Ok(self.load_document()?.settings)
    }

    pub fn load_analysis(&self) -> Result<Option<AnalysisPreferences>, SettingsError> {
        self.load_document()?
            .extra
            .remove(ANALYSIS)
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }

    pub fn save_analysis(&self, preferences: AnalysisPreferences) -> Result<(), SettingsError> {
        let preferences = serde_json::to_value(preferences)?;
        self.update(|document| {
            document.extra.insert(ANALYSIS.into(), preferences);
            Ok(())
        })
    }

    /// The files marked reviewed for one comparison identity.
    pub fn load_reviewed(&self, comparison: &str) -> Result<ReviewedFiles, SettingsError> {
        let mut document = self.load_document()?;
        let Some(value) = document.extra.remove(PROGRESS) else {
            return Ok(ReviewedFiles::new());
        };
        let mut all: BTreeMap<String, ReviewedFiles> = serde_json::from_value(value)?;
        Ok(all.remove(comparison).unwrap_or_default())
    }

    /// Mark `path` reviewed at `revision`, or clear its mark with `None`, under one comparison identity.
    pub fn set_reviewed(
        &self,
        comparison: &str,
        path: &str,
        revision: Option<&str>,
    ) -> Result<(), SettingsError> {
        self.update(|document| {
            let mut all: BTreeMap<String, ReviewedFiles> = match document.extra.remove(PROGRESS) {
                Some(value) => serde_json::from_value(value)?,
                None => BTreeMap::new(),
            };
            let files = all.entry(comparison.to_owned()).or_default();
            match revision {
                Some(revision) => {
                    files.insert(path.to_owned(), revision.to_owned());
                }
                None => {
                    files.remove(path);
                }
            }
            if files.is_empty() {
                all.remove(comparison);
            }
            if !all.is_empty() {
                document
                    .extra
                    .insert(PROGRESS.into(), serde_json::to_value(all)?);
            }
            Ok(())
        })
    }

    fn load_document(&self) -> Result<SettingsFile, SettingsError> {
        let lock = match self.open_lock() {
            Ok(lock) => lock,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(SettingsFile::default());
            }
            Err(error) => return Err(error.into()),
        };
        FileExt::lock_shared(&lock)?;
        self.read_file()
    }

    pub fn save(&self, settings: ApplicationSettings) -> Result<(), SettingsError> {
        self.update(|document| {
            document.settings = settings;
            Ok(())
        })
    }

    fn update(
        &self,
        change: impl FnOnce(&mut SettingsFile) -> Result<(), SettingsError>,
    ) -> Result<(), SettingsError> {
        fs::create_dir_all(&self.directory)?;
        let lock = self.open_lock()?;
        FileExt::lock_exclusive(&lock)?;
        let mut document = self.read_file()?;
        document.version = SETTINGS_VERSION;
        change(&mut document)?;

        let mut temporary = NamedTempFile::new_in(&self.directory)?;
        serde_json::to_writer_pretty(&mut temporary, &document)?;
        temporary.write_all(b"\n")?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(self.settings_path())
            .map_err(|error| error.error)?;
        Ok(())
    }

    fn open_lock(&self) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.directory.join(".settings.lock"))
    }

    fn settings_path(&self) -> PathBuf {
        self.directory.join("settings.json")
    }

    fn read_file(&self) -> Result<SettingsFile, SettingsError> {
        let bytes = match fs::read(self.settings_path()) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(SettingsFile::default());
            }
            Err(error) => return Err(error.into()),
        };
        let document: SettingsFile = serde_json::from_slice(&bytes)?;
        if document.version > SETTINGS_VERSION {
            return Err(SettingsError::UnsupportedVersion(document.version));
        }
        Ok(document)
    }
}
