use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Barrier;

use glassbox_feedback::{BundleContext, BundleStore, CleanupScope};
use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackChange, MessageTarget, ReviewAnchor, ReviewFeedback,
    ReviewerCategory, ThreadOrigin,
};
use sha2::{Digest, Sha256};

fn context(root: &Path) -> BundleContext {
    BundleContext {
        project: Some(root.to_path_buf()),
        comparison: "Working tree".into(),
        before: Some("HEAD".into()),
        after: Some("working tree".into()),
    }
}

fn feedback(text: &str) -> (ReviewFeedback, u32) {
    let mut state = ReviewFeedback::default();
    let id = state
        .add(
            ReviewAnchor {
                path: "src/bundle.ts".into(),
                side: AnchorSide::After,
                revision: "file revision".into(),
                target: AnchorTarget::Line { start: 11, end: 14 },
            },
            ThreadOrigin::Reviewer {
                category: ReviewerCategory::Style,
            },
            "Reviewer Name".into(),
            text.into(),
        )
        .unwrap();
    (state, id)
}

fn with_attachment(bytes: &[u8]) -> FeedbackChange {
    FeedbackChange::Attach {
        message: MessageTarget::Opening,
        filename: "evidence with spaces.bin".into(),
        bytes: bytes.to_vec(),
    }
}

fn attachment_path(handoff: &Path, document: &str) -> PathBuf {
    let reference = document
        .lines()
        .find_map(|line| line.split_once("`attachments/").map(|(_, rest)| rest))
        .and_then(|value| value.split_once('`').map(|(file, _)| file))
        .unwrap();
    handoff
        .parent()
        .unwrap()
        .join("attachments")
        .join(reference)
}

#[test]
fn copied_instruction_is_valid_immediately_and_after_app_exit() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("feedback & author's folder");
    let bundle = BundleStore::in_directory(&root)
        .create(context(directory.path()), &ReviewFeedback::default())
        .unwrap();
    let instruction = bundle.instruction().unwrap();
    let quoted = instruction
        .strip_prefix("Read the Glassbox review feedback in ")
        .unwrap()
        .strip_suffix(". Resolve its attachment paths relative to that file.")
        .unwrap();
    let path: PathBuf = serde_json::from_str(quoted).unwrap();
    assert_eq!(path, bundle.path());
    assert!(path.is_absolute());

    drop(bundle);
    let document = fs::read_to_string(&path).unwrap();
    assert!(document.contains("No feedback has been recorded."));
    assert!(document.contains("- Before: \"HEAD\""));
    let saved_context: BundleContext =
        serde_json::from_slice(&fs::read(path.parent().unwrap().join("context.json")).unwrap())
            .unwrap();
    assert_eq!(saved_context, context(directory.path()));
}

#[test]
fn reopening_recovers_the_same_bundle_and_excludes_competing_writers_and_cleanup() {
    let directory = tempfile::tempdir().unwrap();
    let store = BundleStore::in_directory(directory.path());
    let (mut state, thread) = feedback("Before exit");
    state.apply(thread, 1, with_attachment(&[0, 255])).unwrap();
    let bundle = store.create(context(directory.path()), &state).unwrap();
    let id = bundle.id().to_owned();
    let path = bundle.path();
    assert!(
        matches!(store.reopen(&id), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
    );
    drop(bundle);

    let (bundle, mut restored) = store.reopen(&id).unwrap().unwrap();
    assert_eq!(restored, state);
    assert_eq!(bundle.path(), path);
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().active_bundles, 1);
    restored
        .apply(thread, 2, FeedbackChange::RemoveThread)
        .unwrap();
    bundle.publish(&restored).unwrap();
    assert!(fs::read_to_string(&path).unwrap().contains("No feedback"));
    drop(bundle);

    let (bundle, latest) = store.reopen(&id).unwrap().unwrap();
    assert_eq!(latest, restored);
    drop(bundle);
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().removed_bundles, 1);
    assert!(
        matches!(store.reopen(&id), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    );
}

#[test]
fn legacy_handoffs_remain_readable_and_malformed_snapshot_references_fail() {
    let directory = tempfile::tempdir().unwrap();
    let store = BundleStore::in_directory(directory.path());
    let bundle = store
        .create(context(directory.path()), &ReviewFeedback::default())
        .unwrap();
    let id = bundle.id().to_owned();
    let path = bundle.path();
    drop(bundle);

    let document = fs::read_to_string(&path).unwrap();
    let mut old_document = String::new();
    for line in document.split_inclusive('\n') {
        if !line.starts_with("<!-- Glassbox editable snapshot ") {
            old_document.push_str(line);
        }
    }
    fs::write(&path, &old_document).unwrap();
    assert!(store.reopen(&id).unwrap().is_none());
    assert!(fs::read_to_string(&path).unwrap().contains("No feedback"));
    assert!(
        matches!(store.reopen("../outside"), Err(error) if error.kind() == std::io::ErrorKind::InvalidInput)
    );

    let invalid = document.replacen(
        "<!-- Glassbox editable snapshot ",
        "<!-- Glassbox editable snapshot ../",
        1,
    );
    fs::write(&path, invalid).unwrap();
    assert!(
        matches!(store.reopen(&id), Err(error) if error.kind() == std::io::ErrorKind::InvalidData)
    );
}

#[test]
fn saved_review_lookup_and_restore_require_the_comparison_identity() {
    let directory = tempfile::tempdir().unwrap();
    let store = BundleStore::in_directory(directory.path());
    let (state, _) = feedback("Saved for the unstaged comparison");
    let bundle = store
        .create_for_source(context(directory.path()), &state, "unstaged")
        .unwrap();
    let id = bundle.id().to_owned();
    drop(bundle);
    assert!(store.saved_for_source("staged").unwrap().is_empty());
    assert_eq!(store.saved_for_source("unstaged").unwrap().len(), 1);
    assert!(store.reopen_for_source(&id, "staged").unwrap().is_none());
    let (bundle, restored) = store.reopen_for_source(&id, "unstaged").unwrap().unwrap();
    assert_eq!(bundle.id(), id);
    assert_eq!(restored, state);
}

#[test]
fn edits_after_handoff_update_the_same_document_and_keep_original_evidence() {
    let directory = tempfile::tempdir().unwrap();
    let (mut state, thread) = feedback("Initial text");
    let bytes = [0, 128, 255, 10];
    state.apply(thread, 1, with_attachment(&bytes)).unwrap();
    let bundle = BundleStore::in_directory(directory.path())
        .create(context(directory.path()), &state)
        .unwrap();
    let hint = bundle.instruction().unwrap();
    let path = bundle.path();
    let first = fs::read_to_string(&path).unwrap();
    let saved_bytes = attachment_path(&path, &first);
    assert_eq!(fs::read(&saved_bytes).unwrap(), bytes);
    assert!(first.contains("- Category: Style"));
    assert!(first.contains("- Lines: 11–14"));

    state
        .apply(
            thread,
            2,
            FeedbackChange::Edit {
                message: MessageTarget::Opening,
                markdown: "Revised text\n\nSecond paragraph".into(),
            },
        )
        .unwrap();
    state
        .apply(
            thread,
            3,
            FeedbackChange::Reply {
                author: "Second Reviewer".into(),
                markdown: "Reply text".into(),
            },
        )
        .unwrap();
    bundle.publish(&state).unwrap();
    assert_eq!(bundle.instruction().unwrap(), hint);
    drop(bundle);
    let revised = fs::read_to_string(&path).unwrap();
    assert!(revised.contains("> Revised text"));
    assert!(revised.contains("> Second paragraph"));
    assert!(revised.contains("> Reply text"));
    assert!(!revised.contains("Initial text"));
    assert_eq!(attachment_path(&path, &revised), saved_bytes);
    assert_eq!(fs::read(saved_bytes).unwrap(), bytes);
    assert_eq!(
        fs::read_dir(path.parent().unwrap().join("attachments"))
            .unwrap()
            .count(),
        1,
    );
}

#[test]
fn failed_evidence_publication_preserves_the_previous_bundle_and_can_retry() {
    let directory = tempfile::tempdir().unwrap();
    let (mut state, thread) = feedback("Initial text");
    state.apply(thread, 1, with_attachment(b"old")).unwrap();
    let bundle = BundleStore::in_directory(directory.path())
        .create(context(directory.path()), &state)
        .unwrap();
    let path = bundle.path();
    let initial = fs::read_to_string(&path).unwrap();
    let original = attachment_path(&path, &initial);
    let new_bytes = b"new evidence";
    state.apply(thread, 2, with_attachment(new_bytes)).unwrap();
    let attachment_dir = original.parent().unwrap();
    let collision = attachment_dir.join(format!("{:x}.bin", Sha256::digest(new_bytes)));
    fs::create_dir(&collision).unwrap();

    assert_eq!(
        bundle.publish(&state).unwrap_err().kind(),
        std::io::ErrorKind::InvalidData,
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), initial);
    assert_eq!(fs::read(original).unwrap(), b"old");

    fs::remove_dir(&collision).unwrap();
    bundle.publish(&state).unwrap();
    assert_ne!(fs::read_to_string(&path).unwrap(), initial);
    assert_eq!(fs::read(collision).unwrap(), new_bytes);
}

#[test]
fn concurrent_readers_only_see_complete_publications() {
    let directory = tempfile::tempdir().unwrap();
    let first_text = "alpha ".repeat(2_000);
    let second_text = "beta ".repeat(2_000);
    let (first, _) = feedback(&first_text);
    let (second, _) = feedback(&second_text);
    let bundle = BundleStore::in_directory(directory.path())
        .create(context(directory.path()), &first)
        .unwrap();
    let barrier = Barrier::new(3);
    let path = bundle.path();
    std::thread::scope(|group| {
        for state in [&first, &second] {
            let bundle = &bundle;
            let barrier = &barrier;
            group.spawn(move || {
                barrier.wait();
                for _ in 0..10 {
                    bundle.publish(state).unwrap();
                }
            });
        }
        barrier.wait();
        for _ in 0..40 {
            let document = fs::read_to_string(&path).unwrap();
            let text = document
                .lines()
                .find_map(|line| line.strip_prefix("> "))
                .unwrap();
            assert!(text == first_text || text == second_text);
        }
    });
}

#[cfg(windows)]
#[test]
fn publication_retries_while_an_external_reader_holds_the_document() {
    use std::os::windows::fs::OpenOptionsExt;
    use std::time::{Duration, Instant};

    let directory = tempfile::tempdir().unwrap();
    let (first, _) = feedback("the original snapshot");
    let (second, _) = feedback("the next snapshot");
    let bundle = BundleStore::in_directory(directory.path())
        .create(context(directory.path()), &first)
        .unwrap();
    let path = bundle.path();
    let reader = fs::OpenOptions::new()
        .read(true)
        .share_mode(1) // FILE_SHARE_READ only. Opening the destination for deletion must wait.
        .open(&path)
        .unwrap();

    let started = Instant::now();
    let error = bundle.publish(&second).unwrap_err();
    assert!(matches!(error.raw_os_error(), Some(5 | 32 | 33)));
    assert!(started.elapsed() >= Duration::from_millis(500));
    assert!(
        fs::read_to_string(&path)
            .unwrap()
            .contains("the original snapshot")
    );

    drop(reader);
    bundle.publish(&second).unwrap();
    assert!(
        fs::read_to_string(&path)
            .unwrap()
            .contains("the next snapshot")
    );
}
