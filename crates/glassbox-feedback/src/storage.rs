use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use serde::Serialize;

use super::{BUNDLE_HEADER, BUNDLE_PREFIX, BundleContext, BundleStore, CONTEXT, HANDOFF};

const LEASE: &str = ".active.lock";
const CLEANUP_LOCK: &str = ".cleanup.lock";

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
pub struct StorageUsage {
    pub bytes: u64,
    pub bundles: usize,
    pub projects: Vec<ProjectStorage>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ProjectStorage {
    pub project: Option<PathBuf>,
    pub bytes: u64,
    pub bundles: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CleanupScope {
    All,
    Project(PathBuf),
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
pub struct CleanupReport {
    pub removed_bundles: usize,
    pub reclaimed_bytes: u64,
    pub active_bundles: usize,
    pub problems: Vec<CleanupProblem>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct CleanupProblem {
    pub bundle: String,
    pub message: String,
}

struct BundleDirectory {
    path: PathBuf,
    project: Option<PathBuf>,
}

impl BundleStore {
    pub fn usage(&self) -> io::Result<StorageUsage> {
        let mut report = StorageUsage::default();
        let mut projects = BTreeMap::new();
        for bundle in bundle_directories(&self.root)? {
            let bytes = directory_size(&bundle.path)?;
            report.bytes = report.bytes.saturating_add(bytes);
            report.bundles += 1;
            let project = projects
                .entry(bundle.project.clone())
                .or_insert(ProjectStorage {
                    project: bundle.project,
                    bytes: 0,
                    bundles: 0,
                });
            project.bytes = project.bytes.saturating_add(bytes);
            project.bundles += 1;
        }
        report.projects = projects.into_values().collect();
        Ok(report)
    }

    pub fn cleanup(&self, scope: CleanupScope) -> io::Result<CleanupReport> {
        let project = match scope {
            CleanupScope::All => None,
            CleanupScope::Project(path) => Some(project_identity(&path)?),
        };
        let mut report = CleanupReport::default();
        let cleanup_lock = match lock_file(&self.root.join(CLEANUP_LOCK)) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(report),
            Err(error) => return Err(error),
        };
        FileExt::lock_exclusive(&cleanup_lock)?;
        for bundle in bundle_directories(&self.root)? {
            if project.is_some() && project != bundle.project {
                continue;
            }
            match remove_idle_bundle(&bundle.path) {
                Ok(Some(bytes)) => {
                    report.removed_bundles += 1;
                    report.reclaimed_bytes = report.reclaimed_bytes.saturating_add(bytes);
                }
                Ok(None) => report.active_bundles += 1,
                Err(error) => report.problems.push(CleanupProblem {
                    bundle: bundle
                        .path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    message: error.to_string(),
                }),
            }
        }
        Ok(report)
    }
}

pub(super) fn open_bundle_lease(path: &Path) -> io::Result<File> {
    let file = lock_file(&path.join(LEASE))?;
    FileExt::lock_exclusive(&file)?;
    Ok(file)
}

fn lock_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
}

fn remove_idle_bundle(path: &Path) -> io::Result<Option<u64>> {
    let lease = lock_file(&path.join(LEASE))?;
    match FileExt::try_lock_exclusive(&lease) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    }
    let bytes = directory_size(path)?;
    // Only creation takes a writer lease. A published idle bundle cannot gain
    // another writer, and the store's cleanup lock excludes other removals.
    drop(lease);
    fs::remove_dir_all(path)?;
    Ok(Some(bytes))
}

fn bundle_directories(root: &Path) -> io::Result<Vec<BundleDirectory>> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut bundles = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir()
            || !entry
                .file_name()
                .to_string_lossy()
                .starts_with(BUNDLE_PREFIX)
        {
            continue;
        }
        let path = entry.path();
        if !has_header(&path.join(HANDOFF))? {
            continue;
        }
        let context = path.join(CONTEXT);
        let project = match fs::symlink_metadata(&context) {
            Ok(meta) if meta.is_file() => fs::read(context)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<BundleContext>(&bytes).ok())
                .and_then(|context| context.project)
                .map(|project| project_identity(&project))
                .transpose()?,
            _ => None,
        };
        bundles.push(BundleDirectory { path, project });
    }
    Ok(bundles)
}

fn has_header(path: &Path) -> io::Result<bool> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if !metadata.is_file() {
        return Ok(false);
    }
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let mut prefix = vec![0; BUNDLE_HEADER.len()];
    match file.read_exact(&mut prefix) {
        Ok(()) => Ok(prefix == BUNDLE_HEADER.as_bytes()),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error),
    }
}

fn project_identity(project: &Path) -> io::Result<PathBuf> {
    fs::canonicalize(project).or_else(|_| std::path::absolute(project))
}

fn directory_size(path: &Path) -> io::Result<u64> {
    let mut directories = vec![path.to_owned()];
    let mut bytes = 0u64;
    while let Some(directory) = directories.pop() {
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        for entry in entries {
            let entry = entry?;
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if metadata.is_dir() {
                directories.push(entry.path());
            } else if metadata.is_file() {
                bytes = bytes.saturating_add(metadata.len());
            }
        }
    }
    Ok(bytes)
}
