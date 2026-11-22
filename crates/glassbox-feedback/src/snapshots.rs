use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use glassbox_model::feedback::ReviewFeedback;
use serde::Serialize;
use tempfile::Builder;

use super::{
    BUNDLE_HEADER, BUNDLE_PREFIX, BundleStore, CONTEXT, FeedbackBundle, HANDOFF, Publication,
    attachment_filename, storage, write_replace,
};

const SNAPSHOT_PREFIX: &str = "threads-v1-";
const MARKER: &str = "<!-- Glassbox editable snapshot ";
const SOURCE: &str = "source-v1.txt";

#[derive(Serialize)]
pub struct SavedReview {
    id: String,
    updated_at: u64,
}

impl BundleStore {
    pub fn saved_for_source(&self, source: &str) -> io::Result<Vec<SavedReview>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut saved = Vec::new();
        for entry in entries {
            let entry = entry?;
            let Ok(id) = entry.file_name().into_string() else {
                continue;
            };
            if !valid_name(&id, BUNDLE_PREFIX) || !entry.file_type()?.is_dir() {
                continue;
            }
            let directory = entry.path();
            if !source_matches(&directory, source) {
                continue;
            }
            let Ok(updated) = directory
                .join(HANDOFF)
                .metadata()
                .and_then(|file| file.modified())
            else {
                continue;
            };
            if matches!(committed_snapshot(&directory), Ok(Some(_))) {
                saved.push(SavedReview {
                    id,
                    updated_at: updated
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                });
            }
        }
        saved.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then(left.id.cmp(&right.id))
        });
        Ok(saved)
    }

    pub fn reopen_for_source(
        &self,
        id: &str,
        source: &str,
    ) -> io::Result<Option<(FeedbackBundle, ReviewFeedback)>> {
        self.reopen_bundle(id, Some(source))
    }

    /// Reopen a bundle by its store-local ID. A legacy handoff has no editable document.
    pub fn reopen(&self, id: &str) -> io::Result<Option<(FeedbackBundle, ReviewFeedback)>> {
        self.reopen_bundle(id, None)
    }

    fn reopen_bundle(
        &self,
        id: &str,
        source: Option<&str>,
    ) -> io::Result<Option<(FeedbackBundle, ReviewFeedback)>> {
        if !valid_name(id, BUNDLE_PREFIX) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid review ID",
            ));
        }
        let root = std::path::absolute(&self.root)?;
        let cleanup_lock = storage::lock_cleanup(&root)?;
        let directory = root.join(id);
        if !fs::symlink_metadata(&directory)?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid review directory",
            ));
        }
        let lease = storage::try_open_bundle_lease(&directory)?;
        drop(cleanup_lock);
        if source.is_some_and(|source| !source_matches(&directory, source)) {
            return Ok(None);
        }
        let Some(snapshot) = committed_snapshot(&directory)? else {
            return Ok(None);
        };
        let feedback: ReviewFeedback =
            serde_json::from_reader(BufReader::new(open_regular(&directory.join(&snapshot))?))?;
        let context =
            serde_json::from_reader(BufReader::new(open_regular(&directory.join(CONTEXT))?))?;
        let evidence = feedback
            .threads()
            .iter()
            .flat_map(|thread| {
                std::iter::once(&thread.opening)
                    .chain(thread.replies.iter().map(|reply| &reply.message))
            })
            .flat_map(|message| &message.attachments)
            .map(attachment_filename)
            .collect();
        let bundle = FeedbackBundle {
            directory,
            context,
            publication: Mutex::new(Publication {
                evidence,
                snapshot: Some(snapshot),
            }),
            _lease: lease,
        };
        Ok(Some((bundle, feedback)))
    }
}

fn source_matches(directory: &Path, source: &str) -> bool {
    matches!(fs::read_to_string(directory.join(SOURCE)), Ok(saved) if saved == source)
}

pub(super) fn write_source(directory: &Path, source: &str) -> io::Result<()> {
    write_replace(directory, SOURCE, source.as_bytes())
}

fn valid_name(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix).is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix.len() <= 32
            && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}

fn open_regular(path: &Path) -> io::Result<File> {
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid review file",
        ));
    }
    File::open(path)
}

fn committed_snapshot(directory: &Path) -> io::Result<Option<String>> {
    let mut document = BufReader::new(open_regular(&directory.join(HANDOFF))?);
    let mut line = String::new();
    for expected in BUNDLE_HEADER.lines() {
        line.clear();
        document.read_line(&mut line)?;
        if line.trim_end_matches('\n') != expected {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid review header",
            ));
        }
    }
    line.clear();
    document.read_line(&mut line)?;
    let Some(snapshot) = line.strip_prefix(MARKER) else {
        return Ok(None);
    };
    let name = snapshot
        .strip_suffix(" -->\n")
        .filter(|name| valid_name(name, SNAPSHOT_PREFIX));
    name.map(|name| Some(name.to_owned())).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid editable review snapshot",
        )
    })
}

pub(super) fn publish(
    directory: &Path,
    mut document: Vec<u8>,
    feedback: &ReviewFeedback,
) -> io::Result<String> {
    let mut snapshot = Builder::new()
        .prefix(SNAPSHOT_PREFIX)
        .tempfile_in(directory)?;
    let name = snapshot
        .path()
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let mut writer = BufWriter::new(snapshot.as_file_mut());
    serde_json::to_writer(&mut writer, feedback)?;
    writer.flush()?;
    drop(writer);
    snapshot.as_file().sync_all()?;

    let marker = format!("{MARKER}{name} -->\n");
    document.splice(BUNDLE_HEADER.len()..BUNDLE_HEADER.len(), marker.bytes());
    write_replace(directory, HANDOFF, &document)?;
    snapshot.disable_cleanup(true);
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_markdown_replacement_discards_uncommitted_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join(HANDOFF)).unwrap();
        assert!(
            publish(
                directory.path(),
                BUNDLE_HEADER.as_bytes().to_vec(),
                &ReviewFeedback::default(),
            )
            .is_err()
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
