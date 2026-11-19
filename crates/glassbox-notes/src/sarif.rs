use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use glassbox_model::{NoteArtifact, NoteKind, NoteOrigin, NoteRelatedLocation, ReviewNote};
use serde_json::Value;

pub fn load_review_notes(root: &Path, source: &str) -> io::Result<Vec<ReviewNote>> {
    let source_path =
        relative_path(source).ok_or_else(|| invalid("invalid review note source path"))?;
    let stem = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid("review note source has no file name"))?;
    let directory = root
        .join(".pr-notes/notes")
        .join(source_path.parent().unwrap_or(Path::new("")));
    let directory = match directory.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    if !directory.starts_with(root.canonicalize()?) {
        return Err(invalid("review note directory is outside the repository"));
    }

    let prefix = format!("{stem}.");
    let mut shards = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        if entry.file_type()?.is_file()
            && name
                .to_str()
                .and_then(|name| name.strip_prefix(&prefix))
                .and_then(|index| index.strip_suffix(".sarif"))
                .is_some_and(|index| {
                    index.len() == 6 && index.as_bytes().iter().all(u8::is_ascii_digit)
                })
        {
            shards.push(entry.path());
        }
    }
    shards.sort();
    let mut seen = BTreeSet::new();
    let mut notes = Vec::new();
    for shard in shards {
        let bytes = fs::read(shard)?;
        if let Ok(parsed) = parse_review_notes(&bytes, source) {
            notes.extend(
                parsed
                    .into_iter()
                    .filter(|note| seen.insert(note.id.clone())),
            );
        }
    }
    Ok(notes)
}

pub fn parse_review_notes(bytes: &[u8], source: &str) -> io::Result<Vec<ReviewNote>> {
    let source_path =
        relative_path(source).ok_or_else(|| invalid("invalid review note source path"))?;
    let log: Value = serde_json::from_slice(bytes).map_err(io::Error::other)?;
    if log["version"].as_str() != Some("2.1.0") {
        return Err(invalid("unsupported review note SARIF version"));
    }
    let runs = log["runs"]
        .as_array()
        .ok_or_else(|| invalid("review note SARIF requires runs"))?;
    Ok(runs
        .iter()
        .flat_map(|run| {
            values(&run["results"])
                .iter()
                .filter_map(|result| parse_result(result, run, source, &source_path))
        })
        .collect())
}

fn parse_result(
    result: &Value,
    run: &Value,
    source: &str,
    source_path: &Path,
) -> Option<ReviewNote> {
    if result["ruleId"].as_str() != Some("review-note") {
        return None;
    }
    let location = values(&result["locations"])
        .iter()
        .map(|location| &location["physicalLocation"])
        .find(|location| {
            location["artifactLocation"]["uri"]
                .as_str()
                .and_then(relative_path)
                .as_deref()
                == Some(source_path)
        })?;
    let region = &location["region"];
    let start_line = line(&region["startLine"])?;
    let end_line = line(&region["endLine"]).unwrap_or(start_line);
    if end_line < start_line {
        return None;
    }
    let driver = &run["tool"]["driver"];
    let provenance = values(&run["versionControlProvenance"])
        .first()
        .unwrap_or(&Value::Null);
    let message = &result["message"];
    let properties = &result["properties"];
    let rank = bounded_number(&result["rank"], 100.0);
    Some(ReviewNote {
        id: read_string(&result["guid"])?,
        source: source.to_owned(),
        kind: note_kind(values(&properties["tags"]).first()?.as_str()?)?,
        markdown: read_string(&message["markdown"]).or_else(|| read_string(&message["text"]))?,
        start_line,
        end_line,
        snippet: read_string(&region["snippet"]["text"]),
        fingerprint: read_string(&result["partialFingerprints"]["prNoteAnchor/v1"]),
        confidence: bounded_number(&properties["ext-ai-tool-confidence"], 1.0),
        rank,
        origin: NoteOrigin {
            producer: read_string(&driver["name"]).unwrap_or_default(),
            producer_version: read_string(&driver["version"]),
            repository_uri: read_string(&provenance["repositoryUri"]),
            revision: read_string(&provenance["revisionId"]),
            branch: read_string(&provenance["branch"]),
        },
        tickets: values(&result["workItemUris"])
            .iter()
            .filter_map(read_string)
            .collect(),
        related: values(&result["relatedLocations"])
            .iter()
            .filter_map(|related| {
                let location = &related["physicalLocation"];
                let path = read_string(&location["artifactLocation"]["uri"])?;
                relative_path(&path)?;
                Some(NoteRelatedLocation {
                    id: u32::try_from(related["id"].as_u64()?).ok()?,
                    path,
                    line: line(&location["region"]["startLine"])?,
                })
            })
            .collect(),
        artifacts: values(&result["attachments"])
            .iter()
            .filter_map(|attachment| {
                let location = &attachment["artifactLocation"];
                let path = read_string(&location["uri"])?;
                relative_path(&path)?;
                Some(NoteArtifact {
                    path,
                    sha256: read_string(&location["properties"]["ext-sha256"]),
                })
            })
            .collect(),
    })
}

fn note_kind(tag: &str) -> Option<NoteKind> {
    Some(match tag {
        "rationale" => NoteKind::Rationale,
        "proof" => NoteKind::Proof,
        "assumption" => NoteKind::Assumption,
        "alternative-considered" => NoteKind::AlternativeConsidered,
        "risk" => NoteKind::Risk,
        "test-evidence" => NoteKind::TestEvidence,
        _ => return None,
    })
}

fn relative_path(value: &str) -> Option<PathBuf> {
    let portable = value.replace('\\', "/");
    if portable
        .split('/')
        .any(|part| part.is_empty() || matches!(part, "." | "..") || part.contains([':', '\0']))
    {
        return None;
    }
    Some(PathBuf::from(portable))
}

fn line(value: &Value) -> Option<u32> {
    u32::try_from(value.as_u64()?)
        .ok()
        .filter(|value| *value > 0)
}

fn bounded_number(value: &Value, max: f64) -> Option<f64> {
    value.as_f64().filter(|number| (0.0..=max).contains(number))
}

fn values(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}

fn read_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
