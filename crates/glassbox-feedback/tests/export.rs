//! HS2-A07MHD: the documented JSON export, its golden fixture and a consumer that reads it.

use std::fs;
use std::path::Path;

use glassbox_feedback::{BundleContext, BundleStore, EXPORT_FILENAME, EXPORT_SCHEMA_VERSION};
use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackChange, MessageTarget, ReviewAnchor, ReviewFeedback,
    ReviewerCategory, RiskLevel, ThreadOrigin,
};
use serde::Deserialize;
use serde_json::Value;

const GOLDEN: &str = include_str!("fixtures/feedback-export-v1.json");
const DOCUMENT: &str = include_str!("../../../docs/feedback-export.md");

/// A consumer written only from `docs/feedback-export.md`. Unknown fields fail it, so the document and the
/// export cannot drift apart without this test noticing.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Export {
    schema_version: u32,
    context: Context,
    threads: Vec<Thread>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Context {
    project: Option<String>,
    comparison: String,
    before: Option<String>,
    after: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Thread {
    id: u32,
    file: String,
    side: String,
    revision: String,
    target: Target,
    line_text: Option<String>,
    origin: Origin,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Target {
    Line {
        start: u32,
        end: u32,
    },
    ImageRegion {
        left: f64,
        top: f64,
        width: f64,
        height: f64,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Origin {
    Reviewer {
        category: String,
    },
    Ai {
        tags: Vec<String>,
        risk: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    kind: String,
    id: Option<u32>,
    author: String,
    markdown: String,
    attachments: Vec<Attachment>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Attachment {
    filename: String,
    path: String,
    bytes: u64,
}

fn anchor(path: &str, side: AnchorSide, target: AnchorTarget, quote: Option<&str>) -> ReviewAnchor {
    ReviewAnchor {
        path: path.into(),
        side,
        revision: "r1".into(),
        target,
        quote: quote.map(Into::into),
    }
}

/// One thread of every supported kind: a reviewer line with a reply and an attachment, a reviewer range,
/// an image region, and an AI note with a risk.
fn every_kind() -> ReviewFeedback {
    let mut state = ReviewFeedback::default();
    let line = state
        .add(
            anchor(
                "src/bundle.ts",
                AnchorSide::After,
                AnchorTarget::Line { start: 12, end: 12 },
                Some("export const revision = 2;"),
            ),
            ThreadOrigin::Reviewer {
                category: ReviewerCategory::PatternFollow,
            },
            "Reviewer".into(),
            "Keep this naming.\nIt matches the module.".into(),
        )
        .unwrap();
    state
        .apply(
            line,
            1,
            FeedbackChange::Attach {
                message: MessageTarget::Opening,
                filename: "evidence.PNG".into(),
                bytes: vec![1, 2, 3, 4],
            },
        )
        .unwrap();
    state
        .apply(
            line,
            2,
            FeedbackChange::Reply {
                author: "Author".into(),
                markdown: "Agreed.".into(),
            },
        )
        .unwrap();
    state
        .add(
            anchor(
                "src/bundle.ts",
                AnchorSide::Before,
                AnchorTarget::Line { start: 3, end: 5 },
                None,
            ),
            ThreadOrigin::Reviewer {
                category: ReviewerCategory::Bug,
            },
            "Reviewer".into(),
            "This range loses the early return.".into(),
        )
        .unwrap();
    state
        .add(
            anchor(
                "assets/mark.svg",
                AnchorSide::After,
                AnchorTarget::ImageRegion {
                    left: 0.25,
                    top: 0.5,
                    width: 0.5,
                    height: 0.25,
                },
                None,
            ),
            ThreadOrigin::Reviewer {
                category: ReviewerCategory::Note,
            },
            "Reviewer".into(),
            "The circle is off centre.".into(),
        )
        .unwrap();
    state
        .add(
            anchor(
                "src/settings.rs",
                AnchorSide::After,
                AnchorTarget::Line { start: 40, end: 40 },
                None,
            ),
            ThreadOrigin::Ai {
                tags: vec!["Risk Analysis".into(), "Concurrency".into()],
                risk: Some(RiskLevel::Medium),
                related_locations: Vec::new(),
            },
            "AI note".into(),
            "Simultaneous saves can share a filename.".into(),
        )
        .unwrap();
    state
}

fn context(root: &Path) -> BundleContext {
    BundleContext {
        project: Some(root.join("Fieldnotes")),
        comparison: "Working tree".into(),
        before: Some("HEAD".into()),
        after: None,
    }
}

fn publish(root: &Path, feedback: &ReviewFeedback) -> std::path::PathBuf {
    let bundle = BundleStore::in_directory(root.join("feedback"))
        .create(context(root), feedback)
        .unwrap();
    bundle.path().parent().unwrap().to_owned()
}

#[test]
fn the_export_matches_the_documented_example_exactly() {
    let scratch = tempfile::tempdir().unwrap();
    let directory = publish(scratch.path(), &every_kind());
    let actual: Value =
        serde_json::from_slice(&fs::read(directory.join(EXPORT_FILENAME)).unwrap()).unwrap();
    let mut expected: Value = serde_json::from_str(GOLDEN).unwrap();
    // The project is an absolute, machine-specific path; the fixture shows it as a placeholder.
    expected["context"]["project"] = actual["context"]["project"].clone();
    assert_eq!(actual, expected);
}

#[test]
fn a_consumer_reads_every_feedback_type_and_resolves_attachments() {
    let scratch = tempfile::tempdir().unwrap();
    let directory = publish(scratch.path(), &every_kind());
    let export: Export =
        serde_json::from_slice(&fs::read(directory.join(EXPORT_FILENAME)).unwrap()).unwrap();
    assert_eq!(export.schema_version, EXPORT_SCHEMA_VERSION);
    assert_eq!(export.context.comparison, "Working tree");
    assert_eq!(export.context.before.as_deref(), Some("HEAD"));
    assert_eq!(export.context.after, None);
    assert!(
        export
            .context
            .project
            .is_some_and(|project| project.ends_with("Fieldnotes"))
    );
    assert_eq!(
        export
            .threads
            .iter()
            .map(|thread| thread.id)
            .collect::<Vec<_>>(),
        [1, 4, 5, 6],
        "IDs are shared by threads, replies and attachments"
    );

    let [line, range, region, ai] = export.threads.as_slice() else {
        panic!("four threads")
    };
    assert_eq!(
        (
            line.file.as_str(),
            line.side.as_str(),
            line.revision.as_str()
        ),
        ("src/bundle.ts", "after", "r1")
    );
    assert!(matches!(line.target, Target::Line { start: 12, end: 12 }));
    assert_eq!(
        line.line_text.as_deref(),
        Some("export const revision = 2;")
    );
    assert!(matches!(&line.origin, Origin::Reviewer { category } if category == "pattern-follow"));
    assert_eq!(line.messages.len(), 2);
    assert_eq!(
        (line.messages[0].kind.as_str(), line.messages[0].id),
        ("opening", None)
    );
    assert_eq!(
        line.messages[0].markdown,
        "Keep this naming.\nIt matches the module."
    );
    assert_eq!(
        (line.messages[1].kind.as_str(), line.messages[1].id),
        ("reply", Some(3))
    );
    assert_eq!(line.messages[1].author, "Author");

    // The attachment resolves beside the export and holds the attached bytes under its original name.
    let attachment = &line.messages[0].attachments[0];
    assert_eq!(
        (attachment.filename.as_str(), attachment.bytes),
        ("evidence.PNG", 4)
    );
    assert!(attachment.path.starts_with("attachments/") && attachment.path.ends_with(".png"));
    assert_eq!(
        fs::read(directory.join(&attachment.path)).unwrap(),
        [1, 2, 3, 4]
    );
    assert!(line.messages[1].attachments.is_empty());

    assert!(matches!(range.target, Target::Line { start: 3, end: 5 }));
    assert_eq!(
        (range.side.as_str(), range.line_text.as_deref()),
        ("before", None)
    );
    assert!(matches!(&range.origin, Origin::Reviewer { category } if category == "bug"));
    let Target::ImageRegion {
        left,
        top,
        width,
        height,
    } = region.target
    else {
        panic!("an image region")
    };
    assert_eq!((left, top, width, height), (0.25, 0.5, 0.5, 0.25));
    let Origin::Ai { tags, risk } = &ai.origin else {
        panic!("an AI note")
    };
    assert_eq!(tags, &["Risk Analysis", "Concurrency"]);
    assert_eq!(risk.as_deref(), Some("medium"));
    assert_eq!(ai.messages[0].author, "AI note");
}

#[test]
fn an_empty_review_exports_no_threads_and_every_publish_replaces_the_file() {
    let scratch = tempfile::tempdir().unwrap();
    let bundle = BundleStore::in_directory(scratch.path().join("feedback"))
        .create(context(scratch.path()), &ReviewFeedback::default())
        .unwrap();
    let path = bundle.path().parent().unwrap().join(EXPORT_FILENAME);
    let empty: Export = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(empty.schema_version, 1);
    assert!(empty.threads.is_empty());

    bundle.publish(&every_kind()).unwrap();
    let full: Export = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(full.threads.len(), 4);
    bundle.publish(&ReviewFeedback::default()).unwrap();
    let cleared: Export = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert!(
        cleared.threads.is_empty(),
        "a removed thread leaves the export"
    );
}

#[test]
fn an_attachment_shared_by_content_resolves_to_one_file() {
    let scratch = tempfile::tempdir().unwrap();
    let mut state = every_kind();
    state
        .apply(
            4,
            1,
            FeedbackChange::Attach {
                message: MessageTarget::Opening,
                filename: "renamed copy.png".into(),
                bytes: vec![1, 2, 3, 4],
            },
        )
        .unwrap();
    let directory = publish(scratch.path(), &state);
    let export: Export =
        serde_json::from_slice(&fs::read(directory.join(EXPORT_FILENAME)).unwrap()).unwrap();
    let first = &export.threads[0].messages[0].attachments[0];
    let second = &export.threads[1].messages[0].attachments[0];
    assert_eq!(first.path, second.path);
    assert_eq!(
        (first.filename.as_str(), second.filename.as_str()),
        ("evidence.PNG", "renamed copy.png")
    );
    assert_eq!(
        fs::read_dir(directory.join("attachments")).unwrap().count(),
        1
    );
}

#[test]
fn the_documented_example_is_the_golden_fixture() {
    // A Windows checkout may hold the document with CRLF line endings.
    let document = DOCUMENT.replace("\r\n", "\n");
    let example = document
        .split("```json\n")
        .nth(1)
        .and_then(|rest| rest.split("\n```").next())
        .expect("a json example in docs/feedback-export.md");
    let documented: Value = serde_json::from_str(example).unwrap();
    assert_eq!(documented, serde_json::from_str::<Value>(GOLDEN).unwrap());
    assert_eq!(documented["schema_version"], EXPORT_SCHEMA_VERSION);
    // Every field the document lists is one a consumer is told about.
    for field in [
        "schema_version",
        "context.project",
        "line_text",
        "pattern-follow",
        "image_region",
    ] {
        assert!(document.contains(field), "{field} is documented");
    }
}
