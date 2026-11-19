use std::fs;
use std::io;

use glassbox_comparison::{compare_direct_content, compare_paths, parse_hunks};
use glassbox_model::{ComparisonData, NoteAnchor, NoteKind};
use glassbox_notes::{anchor_note, load_review_notes, parse_review_notes};
use tempfile::tempdir;

const FIXTURE: &[u8] = include_bytes!("fixtures/v1-note.sarif");

#[test]
fn read_v1_rationale_and_proof_with_stable_guids_and_provenance() {
    let notes = parse_review_notes(FIXTURE, "src/save.rs").unwrap();
    assert_eq!(notes.len(), 2);
    let rationale = &notes[0];
    assert_eq!(rationale.kind, NoteKind::Rationale);
    assert_eq!(rationale.id, "v1-fix-rationale");
    assert_eq!(rationale.markdown, "Publish **atomically**.");
    assert_eq!(rationale.end_line, 5);
    assert_eq!(rationale.origin.producer, "Hot Sheet");
    assert_eq!(rationale.origin.revision.as_deref(), Some("abc123"));
    assert_eq!(rationale.artifacts[0].path, ".pr-notes/proof/trace.txt");
    assert_eq!(rationale.related[0].line, 8);
    assert_eq!(rationale.confidence, Some(0.8));
    assert_eq!(rationale.tickets, ["HS2-EXAMPLE"]);
    assert_eq!(notes[1].kind, NoteKind::Proof);
    assert_eq!(notes[1].start_line, notes[1].end_line);
    assert!(notes[1].markdown.starts_with("The old file"));
    assert!(
        parse_review_notes(FIXTURE, "src/other.rs")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn loads_only_the_requested_shards_and_skips_corrupt_documents() {
    let root = tempdir().unwrap();
    let dir = root.path().join(".pr-notes/notes/src");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("save.rs.000000.sarif"), "{ invalid json").unwrap();
    fs::write(dir.join("save.rs.000002.sarif"), FIXTURE).unwrap();
    fs::write(dir.join("save.rs.000003.sarif"), FIXTURE).unwrap();
    fs::write(dir.join("other.rs.000000.sarif"), FIXTURE).unwrap();

    let notes = load_review_notes(root.path(), "src/save.rs").unwrap();
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[0].id, "v1-fix-rationale");
    assert!(
        load_review_notes(root.path(), "src/other.rs")
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        load_review_notes(root.path(), "../save.rs")
            .unwrap_err()
            .kind(),
        io::ErrorKind::InvalidData
    );
}

#[test]
fn maps_an_existing_note_after_a_line_inserted_in_the_real_comparison() {
    let directory = tempdir().unwrap();
    let old = directory.path().join("old.rs");
    let new = directory.path().join("new.rs");
    fs::write(
        &old,
        "line one\nline two\nprepare();\npersist();\nreturn Ok(());\n",
    )
    .unwrap();
    fs::write(
        &new,
        "line one\nline two\nprepare();\nvalidate();\npersist();\nreturn Ok(());\n",
    )
    .unwrap();
    let entry = compare_paths(&old, &new).unwrap().remove(0);
    let ComparisonData::Text(hunks) = compare_direct_content(&entry).unwrap() else {
        panic!("expected real text hunks");
    };
    let note = parse_review_notes(FIXTURE, "src/save.rs")
        .unwrap()
        .remove(0);
    assert_eq!(anchor_note(&note, &hunks), NoteAnchor::Moved { line: 5 });
}

#[test]
fn anchor_handles_crlf_ambiguity_staleness_and_hidden_lines() {
    let note = parse_review_notes(FIXTURE, "src/save.rs")
        .unwrap()
        .remove(0);
    let cases = [
        (
            "@@ -4 +4 @@\n-old\r\n+persist();\r\n",
            NoteAnchor::Original { line: 4 },
        ),
        (
            "@@ -3,3 +3,3 @@\n persist();\n changed\n persist();\n",
            NoteAnchor::Stale { line: 4 },
        ),
        (
            "@@ -4 +4 @@\n-old\n+replaced\n",
            NoteAnchor::Stale { line: 4 },
        ),
        (
            "@@ -90 +90 @@\n-old\n+persist();\n",
            NoteAnchor::OutsideDiff,
        ),
    ];
    for (diff, expected) in cases {
        assert_eq!(anchor_note(&note, &parse_hunks(diff).unwrap()), expected);
    }
}
