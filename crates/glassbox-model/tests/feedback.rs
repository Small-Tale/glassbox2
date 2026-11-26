use std::sync::{Arc, Barrier, Mutex};

use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackChange, FeedbackError, MessageTarget, ReviewAnchor,
    ReviewFeedback, ReviewerCategory, RiskLevel, ThreadOrigin,
};
use serde_json::{Value, json};

fn line() -> ReviewAnchor {
    ReviewAnchor {
        path: "src/bundle.ts".into(),
        side: AnchorSide::After,
        revision: "file-rev-1".into(),
        target: AnchorTarget::Line { start: 23, end: 23 },
        quote: None,
    }
}

fn reviewer() -> ThreadOrigin {
    ThreadOrigin::Reviewer {
        category: ReviewerCategory::Style,
    }
}

fn reply(markdown: &str) -> FeedbackChange {
    FeedbackChange::Reply {
        author: "Reviewer".into(),
        markdown: markdown.into(),
    }
}

#[test]
fn one_line_supports_independent_reviewer_threads_and_ai_threads_through_round_trip() {
    let mut review = ReviewFeedback::default();
    let anchor = line();
    let first = review
        .add(
            anchor.clone(),
            reviewer(),
            "Reviewer".into(),
            "Name this clearly.".into(),
        )
        .unwrap();
    let second = review
        .add(
            anchor.clone(),
            reviewer(),
            "Reviewer".into(),
            "Add a test.".into(),
        )
        .unwrap();
    let ai = review
        .add(
            anchor.clone(),
            ThreadOrigin::Ai {
                tags: vec!["Risk".into(), "Concurrency".into()],
                risk: Some(RiskLevel::Medium),
                related_locations: vec![],
            },
            "Analyzer".into(),
            "Two writes can race.".into(),
        )
        .unwrap();

    review
        .apply(first, 1, reply("Let's expand the name."))
        .unwrap();
    review.apply(ai, 1, reply("Do unique paths help?")).unwrap();
    review.apply(first, 2, reply("Updated.")).unwrap();
    review
        .apply(
            second,
            1,
            FeedbackChange::Categorize {
                category: ReviewerCategory::Fix,
            },
        )
        .unwrap();
    let document = serde_json::to_vec(&review).unwrap();
    let mut restored: ReviewFeedback = serde_json::from_slice(&document).unwrap();
    assert_eq!(restored, review);
    assert_eq!(
        restored
            .threads()
            .iter()
            .map(|thread| thread.id)
            .collect::<Vec<_>>(),
        [first, second, ai]
    );
    assert!(
        restored
            .threads()
            .iter()
            .all(|thread| thread.anchor == anchor)
    );
    assert_eq!(
        restored.threads()[0]
            .replies
            .iter()
            .map(|reply| reply.message.markdown.as_str())
            .collect::<Vec<_>>(),
        ["Let's expand the name.", "Updated."]
    );
    assert_eq!(restored.threads()[1].replies.len(), 0);
    assert_eq!(
        restored.threads()[2].replies[0].message.markdown,
        "Do unique paths help?"
    );
    assert_eq!(
        restored.apply(
            ai,
            2,
            FeedbackChange::Categorize {
                category: ReviewerCategory::Bug
            }
        ),
        Err(FeedbackError::InvalidCategory)
    );

    let reply_id = restored.threads()[0].replies[0].id;
    restored
        .apply(
            first,
            3,
            FeedbackChange::Edit {
                message: MessageTarget::Reply { id: reply_id },
                markdown: "Clarified.".into(),
            },
        )
        .unwrap();
    assert_eq!(
        restored.threads()[0].replies[0].message.markdown,
        "Clarified."
    );
    restored
        .apply(first, 4, FeedbackChange::RemoveReply { id: reply_id })
        .unwrap();
    assert_eq!(
        restored.threads()[0].replies[0].message.markdown,
        "Updated."
    );
    restored
        .apply(first, 5, FeedbackChange::RemoveThread)
        .unwrap();
    assert_eq!(restored.threads().len(), 2);
    let added = restored
        .add(anchor, reviewer(), "Reviewer".into(), "Follow-up.".into())
        .unwrap();
    assert!(added > reply_id);
    assert!(added > ai);
}

#[test]
fn attaches_arbitrary_bytes_to_one_message_and_scope_checks_removal() {
    let mut review = ReviewFeedback::default();
    let id = review
        .add(
            line(),
            reviewer(),
            "Reviewer".into(),
            "See evidence.".into(),
        )
        .unwrap();
    review.apply(id, 1, reply("Added evidence.")).unwrap();
    let reply = MessageTarget::Reply {
        id: review.threads()[0].replies[0].id,
    };
    for unsafe_name in [
        "../escape",
        "nested/leaf",
        "nested\\leaf",
        "C:drive",
        ".",
        "bad\0name",
    ] {
        assert_eq!(
            review.apply(
                id,
                2,
                FeedbackChange::Attach {
                    message: reply,
                    filename: unsafe_name.into(),
                    bytes: vec![0, 255]
                }
            ),
            Err(FeedbackError::InvalidFilename),
        );
    }
    let bytes = vec![0, 255, 10, 128];
    review
        .apply(
            id,
            2,
            FeedbackChange::Attach {
                message: reply,
                filename: "report evidence.bin".into(),
                bytes: bytes.clone(),
            },
        )
        .unwrap();
    let item = &review.threads()[0].replies[0].message.attachments[0];
    let attachment_id = item.id;
    assert_eq!(item.bytes, bytes);
    assert!(review.threads()[0].opening.attachments.is_empty());
    assert_eq!(
        review.apply(
            id,
            3,
            FeedbackChange::Detach {
                message: MessageTarget::Opening,
                id: attachment_id
            }
        ),
        Err(FeedbackError::NotFound)
    );
    review
        .apply(
            id,
            3,
            FeedbackChange::Detach {
                message: reply,
                id: attachment_id,
            },
        )
        .unwrap();
    assert!(
        review.threads()[0].replies[0]
            .message
            .attachments
            .is_empty()
    );
}

#[test]
fn stale_revisions_and_invalid_regions_cannot_silently_move_an_anchor() {
    let mut review = ReviewFeedback::default();
    let mut anchor = line();
    anchor.path = "img/figure.png".into();
    anchor.target = AnchorTarget::ImageRegion {
        left: 0.25,
        top: 0.25,
        width: 0.75,
        height: 0.5,
    };
    let id = review
        .add(
            anchor.clone(),
            reviewer(),
            "Reviewer".into(),
            "Crop here.".into(),
        )
        .unwrap();
    assert!(!anchor.is_stale(Some("file-rev-1")));
    assert!(anchor.is_stale(None));
    assert!(anchor.is_stale(Some("file-rev-2")));
    let mut changed = anchor.clone();
    changed.revision = "file-rev-2".into();
    changed.target = AnchorTarget::ImageRegion {
        left: -0.1,
        top: 0.5,
        width: 0.25,
        height: 0.5,
    };
    assert_eq!(
        review.apply(id, 1, FeedbackChange::Move { anchor: changed }),
        Err(FeedbackError::InvalidAnchor)
    );
    assert_eq!(review.threads()[0].anchor, anchor);
    anchor.revision = "file-rev-2".into();
    review
        .apply(id, 1, FeedbackChange::Move { anchor })
        .unwrap();
    assert!(!review.threads()[0].anchor.is_stale(Some("file-rev-2")));
    assert_eq!(
        review.apply(id, 1, FeedbackChange::RemoveThread),
        Err(FeedbackError::Conflict { actual: 2 })
    );
}

#[test]
fn concurrent_edits_with_the_same_revision_have_one_winner() {
    let mut review = ReviewFeedback::default();
    let id = review
        .add(
            line(),
            reviewer(),
            "Reviewer".into(),
            "Initial review.".into(),
        )
        .unwrap();
    let review = Arc::new(Mutex::new(review));
    let gate = Arc::new(Barrier::new(2));
    let results = std::thread::scope(|scope| {
        let attempt = |markdown: &'static str| {
            let review = Arc::clone(&review);
            let gate = Arc::clone(&gate);
            scope.spawn(move || {
                gate.wait();
                review.lock().unwrap().apply(
                    id,
                    1,
                    FeedbackChange::Edit {
                        message: MessageTarget::Opening,
                        markdown: markdown.into(),
                    },
                )
            })
        };
        let first = attempt("First client");
        let second = attempt("Second client");
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert!(results.contains(&Ok(())));
    assert!(results.contains(&Err(FeedbackError::Conflict { actual: 2 })));
    assert_eq!(review.lock().unwrap().threads()[0].revision, 2);
}

#[test]
fn deserialization_rejects_escaped_paths_duplicate_ids_and_nonexistent_versions() {
    let mut review = ReviewFeedback::default();
    let id = review
        .add(
            line(),
            reviewer(),
            "Reviewer".into(),
            "Initial review.".into(),
        )
        .unwrap();
    review.apply(id, 1, reply("Response.")).unwrap();
    let data = serde_json::to_value(&review).unwrap();
    let assert_rejected = |key: &str, bad: Value| {
        let mut broken = data.clone();
        *broken.pointer_mut(key).unwrap() = bad;
        assert!(serde_json::from_value::<ReviewFeedback>(broken).is_err());
    };
    assert_rejected("/threads/0/anchor/path", json!("../secret"));
    assert_rejected("/threads/0/anchor/path", json!("/root.txt"));
    assert_rejected("/threads/0/replies/0/id", json!(id));
    assert_rejected("/threads/0/revision", json!(0));
    assert_rejected("/next_id", json!(0));
}

#[test]
fn an_anchor_quote_is_optional_and_survives_a_round_trip() {
    // HS2-RV5BD8: anchors stored before the quote existed still load, and a quote is kept when present.
    let stored = r#"{"path":"src/bundle.ts","side":"after","revision":"r1","target":{"kind":"line","start":2,"end":2}}"#;
    let old: ReviewAnchor = serde_json::from_str(stored).unwrap();
    assert_eq!(old.quote, None);
    assert!(
        !serde_json::to_string(&old).unwrap().contains("quote"),
        "an absent quote is not written"
    );

    let quoted = ReviewAnchor {
        quote: Some("  const value = 1;".into()),
        ..old
    };
    let text = serde_json::to_string(&quoted).unwrap();
    assert!(text.contains(r#""quote":"  const value = 1;""#));
    assert_eq!(serde_json::from_str::<ReviewAnchor>(&text).unwrap(), quoted);
}
