use std::collections::BTreeMap;
use std::fs::{self, File, FileTimes, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Instant, SystemTime};

use glassbox_model::analysis::{AnalysisMode, AnalysisResult};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use tokio::sync::{Mutex as Gate, OwnedMutexGuard};

use super::{input::Snapshot, provider::Provider};

const FORMAT: u32 = 1;
const ENTRY_BYTES: usize = 2 * 1024 * 1024;
const DISK_BYTES: u64 = 64 * 1024 * 1024;
const MEMORY_ENTRIES: usize = 16;

#[derive(Default)]
pub(super) struct Cache {
    gates: Mutex<BTreeMap<String, Weak<Gate<()>>>>,
    memory: Mutex<BTreeMap<String, (Instant, AnalysisResult)>>,
}

impl Cache {
    pub(super) async fn acquire(&self, key: &str) -> OwnedMutexGuard<()> {
        let gate = {
            let mut gates = self.gates.lock().unwrap_or_else(|error| error.into_inner());
            gates.retain(|_, gate| gate.strong_count() != 0);
            let entry = gates.entry(key.to_owned()).or_default();
            entry.upgrade().unwrap_or_else(|| {
                let gate = Arc::new(Gate::new(()));
                *entry = Arc::downgrade(&gate);
                gate
            })
        };
        gate.lock_owned().await
    }

    pub(super) fn key(
        provider: &Provider,
        mode: AnalysisMode,
        snapshot: &Snapshot,
    ) -> Option<String> {
        let files: Vec<_> = snapshot
            .files
            .iter()
            .map(|file| (&file.path, &file.revision))
            .collect();
        let value = serde_json::to_vec(&(
            FORMAT,
            provider.cache_identity()?,
            mode,
            files,
            &snapshot.skipped,
        ))
        .ok()?;
        Some(format!("{:x}", Sha256::digest(value)))
    }

    pub(super) fn load(&self, key: &str, persistent: bool) -> Option<AnalysisResult> {
        if let Some((access, result)) = self.memory.lock().ok()?.get_mut(key) {
            *access = Instant::now();
            return Some(result.clone());
        }
        if !persistent {
            return None;
        }
        let path = directory()?.join(format!("{key}.json"));
        if !fs::symlink_metadata(&path).ok()?.is_file() {
            return None;
        }
        let file = File::open(path).ok()?;
        let mut bytes = Vec::new();
        (&file)
            .take(ENTRY_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() > ENTRY_BYTES {
            return None;
        }
        let result: AnalysisResult = serde_json::from_slice(&bytes).ok()?;
        if !result.failures.is_empty() {
            return None;
        }
        let _ = file.set_times(FileTimes::new().set_modified(SystemTime::now()));
        self.remember(key, &result);
        Some(result)
    }

    pub(super) fn save(&self, key: &str, persistent: bool, result: &AnalysisResult) {
        if !result.failures.is_empty() {
            return;
        }
        let Ok(bytes) = serde_json::to_vec(result) else {
            return;
        };
        if bytes.len() > ENTRY_BYTES {
            return;
        }
        self.remember(key, result);
        if persistent {
            if let Some(directory) = directory() {
                let _ = write(&directory, key, &bytes);
            }
        }
    }

    fn remember(&self, key: &str, result: &AnalysisResult) {
        let Ok(mut memory) = self.memory.lock() else {
            return;
        };
        memory.insert(key.to_owned(), (Instant::now(), result.clone()));
        if memory.len() > MEMORY_ENTRIES {
            if let Some(oldest) = memory
                .iter()
                .min_by_key(|(_, (access, _))| access)
                .map(|(key, _)| key.clone())
            {
                memory.remove(&oldest);
            }
        }
    }
}

fn directory() -> Option<PathBuf> {
    std::env::var_os("GLASSBOX_ANALYSIS_CACHE_DIRECTORY")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::home_dir().map(|home| home.join(".glassbox2/analysis-cache")))
}

fn write(directory: &Path, key: &str, bytes: &[u8]) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(".cache-lock"))?;
    fs2::FileExt::lock_exclusive(&lock)?;
    let mut file = NamedTempFile::new_in(directory)?;
    file.write_all(bytes)?;
    file.persist(directory.join(format!("{key}.json")))?;
    trim(directory, DISK_BYTES)
}

fn trim(directory: &Path, limit: u64) -> io::Result<()> {
    let mut entries = Vec::new();
    let mut bytes = 0_u64;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(key) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
            continue;
        };
        if key.len() != 64
            || !key.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !entry.file_type()?.is_file()
        {
            continue;
        }
        let metadata = entry.metadata()?;
        bytes = bytes.saturating_add(metadata.len());
        entries.push((
            metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            metadata.len(),
            entry.path(),
        ));
    }
    entries.sort();
    for (_, size, path) in entries {
        if bytes <= limit {
            break;
        }
        fs::remove_file(path)?;
        bytes = bytes.saturating_sub(size);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trimming_counts_only_cache_entries() {
        let directory = tempfile::tempdir().unwrap();
        let extra = directory.path().join("keep.json");
        let cached = directory.path().join(format!("{}.json", "0".repeat(64)));
        fs::write(&extra, [0; 10]).unwrap();
        fs::write(&cached, [0; 20]).unwrap();
        trim(directory.path(), 10).unwrap();
        assert!(extra.exists());
        assert!(!cached.exists());
    }
}
