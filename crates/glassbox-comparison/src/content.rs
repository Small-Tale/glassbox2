use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::Path;

use glassbox_model::{
    ComparisonData, ComparisonEntry, DiffLine, DiffLineKind, LfsObject, MediaAsset, TextHunk,
    UnavailableLfsObject,
};

use crate::git::{GitReview, git, read_local_entry};
use crate::lfs::{parse_pointer, read_object};

struct FileSide<'a> {
    path: &'a Path,
    bytes: Vec<u8>,
    lfs_object: Option<LfsObject>,
}

impl<'a> FileSide<'a> {
    fn new((path, bytes): (&'a Path, Vec<u8>)) -> Self {
        Self {
            path,
            bytes,
            lfs_object: None,
        }
    }

    fn media_pointer(&self) -> Option<LfsObject> {
        asset_type(self.path)?;
        parse_pointer(&self.bytes)
    }

    fn materialize(
        &mut self,
        directory: &Path,
        object: LfsObject,
    ) -> io::Result<Option<UnavailableLfsObject>> {
        match read_object(directory, &object)? {
            Ok(bytes) => {
                self.bytes = bytes;
                self.lfs_object = Some(object);
                Ok(None)
            }
            Err(reason) => Ok(Some(UnavailableLfsObject { object, reason })),
        }
    }

    fn into_asset(self) -> MediaAsset {
        MediaAsset {
            content_type: asset_type(self.path).unwrap_or("application/octet-stream"),
            bytes: self.bytes,
            lfs_object: self.lfs_object,
        }
    }
}

pub fn compare_direct_content(entry: &ComparisonEntry) -> io::Result<ComparisonData> {
    compare_content(
        entry.before.as_ref().map(load_direct_side).transpose()?,
        entry.after.as_ref().map(load_direct_side).transpose()?,
    )
}

fn load_direct_side(side: &glassbox_model::EntrySide) -> io::Result<FileSide<'_>> {
    let bytes = read_local_entry(&side.source_path)?;
    Ok(FileSide::new((&side.display_path, bytes)))
}

pub fn compare_git_content(review: &GitReview, index: usize) -> io::Result<ComparisonData> {
    let contents = review.read_change_sides(index)?;
    let entry = &review.changes[index];
    let mut before = entry
        .before_path
        .as_deref()
        .zip(contents.before)
        .map(FileSide::new);
    let mut after = entry
        .after_path
        .as_deref()
        .zip(contents.after)
        .map(FileSide::new);
    let before_pointer = before
        .as_mut()
        .and_then(|side| side.media_pointer().map(|pointer| (side, pointer)));
    let after_pointer = after
        .as_mut()
        .and_then(|side| side.media_pointer().map(|pointer| (side, pointer)));
    if before_pointer.is_some() || after_pointer.is_some() {
        let directory = review.lfs_objects_directory()?;
        let materialize =
            |(side, pointer): (&mut FileSide<'_>, LfsObject)| side.materialize(&directory, pointer);
        let missing_before = before_pointer.map(materialize).transpose()?.flatten();
        let missing_after = after_pointer.map(materialize).transpose()?.flatten();
        if missing_before.is_some() || missing_after.is_some() {
            return Ok(ComparisonData::UnavailableLfs {
                before: missing_before,
                after: missing_after,
            });
        }
    }
    compare_content(before, after)
}

fn compare_content(
    before: Option<FileSide<'_>>,
    after: Option<FileSide<'_>>,
) -> io::Result<ComparisonData> {
    if [&before, &after]
        .into_iter()
        .flatten()
        .any(|side| side.lfs_object.is_none() && parse_pointer(&side.bytes).is_some())
    {
        return Ok(ComparisonData::Binary);
    }
    if [&before, &after]
        .into_iter()
        .flatten()
        .any(|side| asset_type(side.path).is_some())
    {
        return Ok(ComparisonData::Media {
            before: before.map(FileSide::into_asset),
            after: after.map(FileSide::into_asset),
        });
    }
    let before = before.map(|side| side.bytes);
    let after = after.map(|side| side.bytes);
    let before = before.as_deref().unwrap_or_default();
    let after = after.as_deref().unwrap_or_default();
    if [before, after]
        .into_iter()
        .any(|side| side.contains(&0) || std::str::from_utf8(side).is_err())
    {
        return Ok(ComparisonData::Binary);
    }
    compare_text_bytes(before, after).map(ComparisonData::Text)
}

/// Compare UTF-8 source bytes from an already resolved pair.
pub fn compare_text_bytes(before: &[u8], after: &[u8]) -> io::Result<Vec<TextHunk>> {
    if before == after {
        return Ok(Vec::new());
    }
    let staging = tempfile::tempdir()?;
    fs::write(staging.path().join("before"), before)?;
    fs::write(staging.path().join("after"), after)?;
    let output = git(
        staging.path(),
        [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "-U3",
            "--",
            "before",
            "after",
        ],
    )?;
    if !matches!(output.status.code(), Some(0 | 1)) {
        return Err(io::Error::other(
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ));
    }
    let patch = std::str::from_utf8(&output.stdout).map_err(io::Error::other)?;
    parse_hunks(patch)
}

fn asset_type(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(OsStr::to_str)?
        .to_ascii_lowercase();
    match extension.as_str() {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "tif" | "tiff" => Some("image/tiff"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "dot" | "gv" | "mmd" | "mermaid" | "puml" | "plantuml" => Some("text/plain"),
        _ => None,
    }
}

/// Parses the ordered hunks of one unified text diff.
pub fn parse_hunks(patch: &str) -> io::Result<Vec<TextHunk>> {
    let mut hunks = Vec::new();
    let mut active: Option<TextHunk> = None;
    let mut before_used = 0u32;
    let mut after_used = 0u32;
    for line in patch.split_terminator('\n') {
        if let Some(header) = line.strip_prefix("@@ ") {
            finish_hunk(&mut active, before_used, after_used, &mut hunks)?;
            let mut fields = header.split_whitespace();
            let (before_start, before_count) = parse_range(fields.next(), '-')?;
            let (after_start, after_count) = parse_range(fields.next(), '+')?;
            if fields.next() != Some("@@") {
                return Err(invalid_patch());
            }
            active = Some(TextHunk {
                before_start,
                before_count,
                after_start,
                after_count,
                lines: Vec::new(),
            });
            before_used = 0;
            after_used = 0;
            continue;
        }
        let Some(hunk) = &mut active else { continue };
        if line == "\\ No newline at end of file" {
            hunk.lines
                .last_mut()
                .ok_or_else(invalid_patch)?
                .ends_with_newline = false;
            continue;
        }
        let Some(prefix) = line.as_bytes().first() else {
            return Err(invalid_patch());
        };
        let (kind, before, after) = match prefix {
            b' ' => (DiffLineKind::Context, true, true),
            b'+' => (DiffLineKind::Added, false, true),
            b'-' => (DiffLineKind::Removed, true, false),
            _ => return Err(invalid_patch()),
        };
        let before_line = line_number(
            before,
            hunk.before_start,
            hunk.before_count,
            &mut before_used,
        )?;
        let after_line = line_number(after, hunk.after_start, hunk.after_count, &mut after_used)?;
        hunk.lines.push(DiffLine {
            kind,
            before_line,
            after_line,
            text: line[1..].into(),
            ends_with_newline: true,
        });
    }
    finish_hunk(&mut active, before_used, after_used, &mut hunks)?;
    Ok(hunks)
}

fn parse_range(field: Option<&str>, sign: char) -> io::Result<(u32, u32)> {
    let value = field
        .and_then(|field| field.strip_prefix(sign))
        .ok_or_else(invalid_patch)?;
    let (start, count) = value.split_once(',').unwrap_or((value, "1"));
    Ok((
        start.parse().map_err(|_| invalid_patch())?,
        count.parse().map_err(|_| invalid_patch())?,
    ))
}

fn line_number(included: bool, start: u32, count: u32, used: &mut u32) -> io::Result<Option<u32>> {
    if !included {
        return Ok(None);
    }
    if *used >= count || start == 0 {
        return Err(invalid_patch());
    }
    let number = start.checked_add(*used).ok_or_else(invalid_patch)?;
    *used += 1;
    Ok(Some(number))
}

fn finish_hunk(
    active: &mut Option<TextHunk>,
    before_used: u32,
    after_used: u32,
    hunks: &mut Vec<TextHunk>,
) -> io::Result<()> {
    if let Some(hunk) = active.take() {
        if (before_used, after_used) != (hunk.before_count, hunk.after_count) {
            return Err(invalid_patch());
        }
        hunks.push(hunk);
    }
    Ok(())
}

fn invalid_patch() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Malformed unified diff hunk")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_lines_on_each_side_and_preserves_missing_final_newlines() {
        let hunks =
            parse_hunks("@@ -7,2 +7,2 @@\n context\n-old\n\\ No newline at end of file\n+new\n")
                .unwrap();
        assert_eq!(hunks[0].lines[0].before_line, Some(7));
        assert_eq!(hunks[0].lines[0].after_line, Some(7));
        assert_eq!(hunks[0].lines[1].before_line, Some(8));
        assert_eq!(hunks[0].lines[1].after_line, None);
        assert!(!hunks[0].lines[1].ends_with_newline);
        assert_eq!(hunks[0].lines[2].before_line, None);
        assert_eq!(hunks[0].lines[2].after_line, Some(8));
    }

    #[test]
    fn supports_zero_length_sides_and_rejects_inconsistent_ranges() {
        let hunks = parse_hunks("@@ -0,0 +1 @@\n+new\n").unwrap();
        assert_eq!(hunks[0].lines[0].before_line, None);
        assert_eq!(hunks[0].lines[0].after_line, Some(1));
        for malformed in [
            "@@ -1,2 +1 @@\n unchanged\n",
            "@@ -1 +1 @@\n changed\n extra\n",
            "@@ -4294967295,2 +1,2 @@\n first\n second\n",
        ] {
            assert_eq!(
                parse_hunks(malformed).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
    }

    #[test]
    fn treats_lfs_pointer_bytes_as_unavailable_media() {
        let pointer = format!(
            "version https://git-lfs.github.com/spec/v1\noid sha256:{}\nsize 42\n",
            "a".repeat(64)
        );
        let result = compare_content(
            None,
            Some(FileSide::new((
                Path::new("preview.png"),
                pointer.into_bytes(),
            ))),
        )
        .unwrap();
        assert_eq!(result, ComparisonData::Binary);
    }
}
