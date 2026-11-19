use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, FileType};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{self, Path, PathBuf};

use glassbox_model::{Change, ComparisonEntry, ContentKind, EntrySide};

const BINARY_SAMPLE_BYTES: usize = 8192;

pub fn compare_paths(before: &Path, after: &Path) -> io::Result<Vec<ComparisonEntry>> {
    let before = path::absolute(before)?;
    let after = path::absolute(after)?;
    let before_type = file_type(&before)?;
    let after_type = file_type(&after)?;

    match (before_type.is_dir(), after_type.is_dir()) {
        (true, true) => compare_directories(&before, &after),
        (false, false) => {
            let before = entry(&before, basename(&before)?, before_type)?;
            let after = entry(&after, basename(&after)?, after_type)?;
            Ok(compare_entry(Some(before), Some(after))?
                .into_iter()
                .collect())
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Compare two files or two directories",
        )),
    }
}

fn basename(path: &Path) -> io::Result<&Path> {
    path.file_name().map(Path::new).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Path has no file name: {}", path.display()),
        )
    })
}

fn file_type(path: &Path) -> io::Result<FileType> {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type())
        .map_err(|error| io::Error::new(error.kind(), format!("{}: {error}", path.display())))
}

fn compare_directories(before: &Path, after: &Path) -> io::Result<Vec<ComparisonEntry>> {
    let mut before = read_directory(before)?;
    let mut after = read_directory(after)?;
    let paths: BTreeSet<_> = before.keys().chain(after.keys()).cloned().collect();
    let mut changes = Vec::new();
    for path in paths {
        if let Some(change) = compare_entry(before.remove(&path), after.remove(&path))? {
            changes.push(change);
        }
    }
    Ok(changes)
}

fn read_directory(root: &Path) -> io::Result<BTreeMap<PathBuf, EntrySide>> {
    let mut entries = BTreeMap::new();
    let mut directories = vec![(root.to_path_buf(), PathBuf::new())];
    while let Some((directory, relative)) = directories.pop() {
        for child in fs::read_dir(directory)? {
            let child = child?;
            let path = child.path();
            let relative = relative.join(child.file_name());
            let kind = child.file_type()?;
            if kind.is_dir() {
                directories.push((path, relative));
            } else {
                let side = entry(&path, &relative, kind)?;
                entries.insert(relative, side);
            }
        }
    }
    Ok(entries)
}

fn entry(path: &Path, display_path: &Path, file_type: FileType) -> io::Result<EntrySide> {
    let kind = if file_type.is_symlink() {
        ContentKind::Symlink
    } else if file_type.is_file() {
        let mut sample = Vec::new();
        File::open(path)?
            .take(BINARY_SAMPLE_BYTES as u64)
            .read_to_end(&mut sample)?;
        classify_sample(&sample)
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Unsupported file type: {}", path.display()),
        ));
    };
    Ok(EntrySide {
        display_path: display_path.to_path_buf(),
        source_path: path.to_path_buf(),
        kind,
    })
}

fn classify_sample(sample: &[u8]) -> ContentKind {
    let invalid_utf8 = std::str::from_utf8(sample)
        .is_err_and(|error| error.error_len().is_some() || sample.len() < BINARY_SAMPLE_BYTES);
    if sample.contains(&0) || invalid_utf8 {
        ContentKind::Binary
    } else {
        ContentKind::Text
    }
}

fn compare_entry(
    before: Option<EntrySide>,
    after: Option<EntrySide>,
) -> io::Result<Option<ComparisonEntry>> {
    let change = match (&before, &after) {
        (None, None) => return Ok(None),
        (None, Some(_)) => Change::Added,
        (Some(_), None) => Change::Deleted,
        (Some(before), Some(after)) => {
            if same_contents(before, after)? {
                return Ok(None);
            }
            Change::Modified
        }
    };
    Ok(Some(ComparisonEntry {
        change,
        before,
        after,
    }))
}

fn same_contents(before: &EntrySide, after: &EntrySide) -> io::Result<bool> {
    if before.kind != after.kind {
        return Ok(false);
    }
    if before.kind == ContentKind::Symlink {
        return Ok(fs::read_link(&before.source_path)? == fs::read_link(&after.source_path)?);
    }
    let mut old = BufReader::new(File::open(&before.source_path)?);
    let mut new = BufReader::new(File::open(&after.source_path)?);
    loop {
        let old_bytes = old.fill_buf()?;
        let new_bytes = new.fill_buf()?;
        let count = old_bytes.len().min(new_bytes.len());
        if count == 0 {
            return Ok(old_bytes.is_empty() && new_bytes.is_empty());
        }
        if old_bytes[..count] != new_bytes[..count] {
            return Ok(false);
        }
        old.consume(count);
        new.consume(count);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_nulls_and_invalid_utf8_as_binary() {
        assert_eq!(classify_sample(b"review"), ContentKind::Text);
        assert_eq!(classify_sample(b"a\0b"), ContentKind::Binary);
        assert_eq!(classify_sample(&[0xff]), ContentKind::Binary);
        assert_eq!(classify_sample(&[0xe2]), ContentKind::Binary);
    }

    #[test]
    fn allows_an_incomplete_character_at_the_sample_boundary() {
        let mut sample = vec![b'a'; BINARY_SAMPLE_BYTES];
        sample[BINARY_SAMPLE_BYTES - 1] = 0xe2;
        assert_eq!(classify_sample(&sample), ContentKind::Text);
    }
}
