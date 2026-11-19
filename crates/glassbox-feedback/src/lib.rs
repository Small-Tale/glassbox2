//! Durable, database-free handoff bundles for Glassbox reviews.

mod hotsheet;

use std::collections::BTreeSet;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use glassbox_model::feedback::{
    AnchorSide, AnchorTarget, FeedbackAttachment, FeedbackMessage, ReviewFeedback,
    ReviewerCategory, ThreadOrigin,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::{Builder, NamedTempFile};

pub use hotsheet::{ExportReceipt, ExportRequest, ExportTarget, HotSheetClient, PreparedExport};

const HANDOFF: &str = "review.md";
const ATTACHMENTS: &str = "attachments";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundleContext {
    pub project: Option<PathBuf>,
    pub comparison: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

pub struct BundleStore {
    root: PathBuf,
}

impl BundleStore {
    pub fn for_current_user() -> io::Result<Self> {
        let home = std::env::home_dir()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "No Glassbox user directory"))?;
        Ok(Self::in_directory(home.join(".glassbox2/feedback")))
    }

    pub fn in_directory(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn create(
        &self,
        mut context: BundleContext,
        feedback: &ReviewFeedback,
    ) -> io::Result<FeedbackBundle> {
        let root = std::path::absolute(&self.root)?;
        context.project = context.project.map(std::path::absolute).transpose()?;
        fs::create_dir_all(&root)?;
        let directory = Builder::new().prefix("review-").tempdir_in(root)?;
        let bundle = FeedbackBundle {
            directory: directory.path().to_owned(),
            context,
            publication: Mutex::new(BTreeSet::new()),
        };
        let context_json = serde_json::to_vec_pretty(&bundle.context)?;
        write_replace(&bundle.directory, "context.json", &context_json)?;
        bundle.publish(feedback)?;
        let _ = directory.keep();
        Ok(bundle)
    }
}

pub struct FeedbackBundle {
    directory: PathBuf,
    context: BundleContext,
    publication: Mutex<BTreeSet<String>>,
}

impl FeedbackBundle {
    pub fn path(&self) -> PathBuf {
        self.directory.join(HANDOFF)
    }

    pub fn instruction(&self) -> io::Result<String> {
        let path = self.path();
        Ok(format!(
            "Read the Glassbox review feedback in {}. Resolve its attachment paths relative to that file.",
            quoted(path_text(&path)?),
        ))
    }

    pub fn publish(&self, feedback: &ReviewFeedback) -> io::Result<()> {
        let mut publication = self
            .publication
            .lock()
            .map_err(|_| io::Error::other("The feedback writer lost its publication lock"))?;
        let attachment_directory = self.directory.join(ATTACHMENTS);
        fs::create_dir_all(&attachment_directory)?;

        let mut output = Vec::new();
        let mut evidence = BTreeSet::new();
        writeln!(
            output,
            "# Glassbox review feedback\n\n<!-- Glassbox feedback bundle v1 -->\n"
        )?;
        write_context(&mut output, &self.context)?;
        if feedback.threads().is_empty() {
            writeln!(output, "\nNo feedback has been recorded.\n")?;
        }
        for thread in feedback.threads() {
            let side = match thread.anchor.side {
                AnchorSide::Before => "before",
                AnchorSide::After => "after",
            };
            writeln!(output, "\n## Thread {}\n", thread.id)?;
            writeln!(output, "- File: {}", quoted(&thread.anchor.path))?;
            writeln!(output, "- Side: {side}")?;
            writeln!(
                output,
                "- Anchor revision: {}",
                quoted(&thread.anchor.revision)
            )?;
            match thread.anchor.target {
                AnchorTarget::Line { start, end } if start == end => {
                    writeln!(output, "- Line: {start}")?;
                }
                AnchorTarget::Line { start, end } => {
                    writeln!(output, "- Lines: {start}–{end}")?;
                }
                AnchorTarget::ImageRegion {
                    left,
                    top,
                    width,
                    height,
                } => {
                    writeln!(
                        output,
                        "- Image region (fractions): left {left}, top {top}, width {width}, height {height}"
                    )?;
                }
            }
            write_origin(&mut output, &thread.origin)?;
            write_message(
                &mut output,
                &attachment_directory,
                "Opening",
                &thread.opening,
                &mut evidence,
            )?;
            for reply in &thread.replies {
                write_message(
                    &mut output,
                    &attachment_directory,
                    &format!("Reply {}", reply.id),
                    &reply.message,
                    &mut evidence,
                )?;
            }
        }

        write_replace(&self.directory, HANDOFF, &output)?;
        *publication = evidence;
        Ok(())
    }
}

fn write_context(output: &mut impl Write, context: &BundleContext) -> io::Result<()> {
    writeln!(output, "## Review context\n")?;
    if let Some(project) = &context.project {
        writeln!(output, "- Project: {}", quoted(path_text(project)?))?;
    }
    writeln!(output, "- Comparison: {}", quoted(&context.comparison))?;
    if let Some(before) = &context.before {
        writeln!(output, "- Before: {}", quoted(before))?;
    }
    if let Some(after) = &context.after {
        writeln!(output, "- After: {}", quoted(after))?;
    }
    Ok(())
}

fn write_origin(output: &mut impl Write, origin: &ThreadOrigin) -> io::Result<()> {
    match origin {
        ThreadOrigin::Reviewer { category } => {
            let name = match category {
                ReviewerCategory::Bug => "Bug",
                ReviewerCategory::Fix => "Fix",
                ReviewerCategory::Style => "Style",
                ReviewerCategory::PatternFollow => "Pattern Follow",
                ReviewerCategory::PatternAvoid => "Pattern Avoid",
                ReviewerCategory::Note => "Note",
                ReviewerCategory::Remember => "Remember",
            };
            writeln!(output, "- Category: {name}")
        }
        ThreadOrigin::Ai { tags, risk } => {
            writeln!(output, "- Origin: AI")?;
            if !tags.is_empty() {
                let tags: Vec<_> = tags.iter().map(|tag| quoted(tag)).collect();
                writeln!(output, "- Tags: {}", tags.join(", "))?;
            }
            if let Some(risk) = risk {
                writeln!(output, "- Risk: {risk:?}")?;
            }
            Ok(())
        }
    }
}

fn write_message(
    output: &mut impl Write,
    directory: &Path,
    heading: &str,
    message: &FeedbackMessage,
    evidence: &mut BTreeSet<String>,
) -> io::Result<()> {
    writeln!(output, "\n### {heading} · {}\n", quoted(&message.author))?;
    for line in message.markdown.split('\n') {
        writeln!(output, "> {line}")?;
    }
    if !message.attachments.is_empty() {
        writeln!(output, "\nAttachments:")?;
        for attachment in &message.attachments {
            let filename = store_attachment(directory, attachment)?;
            writeln!(
                output,
                "- {} · `{ATTACHMENTS}/{filename}` · {} bytes",
                quoted(&attachment.filename),
                attachment.bytes.len(),
            )?;
            evidence.insert(filename);
        }
    }
    Ok(())
}

fn store_attachment(directory: &Path, attachment: &FeedbackAttachment) -> io::Result<String> {
    let hash = Sha256::digest(&attachment.bytes);
    let mut filename = format!("{hash:x}");
    if let Some((_, extension)) = attachment.filename.rsplit_once('.') {
        if !extension.is_empty()
            && extension.len() <= 12
            && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            filename.push('.');
            filename.push_str(&extension.to_ascii_lowercase());
        }
    }
    let path = directory.join(&filename);
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if !metadata.is_file()
                || metadata.len() != attachment.bytes.len() as u64
                || fs::read(&path)? != attachment.bytes
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Evidence file no longer matches its content",
                ));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let temporary = write_temporary(directory, &attachment.bytes)?;
            temporary
                .persist_noclobber(path)
                .map_err(|error| error.error)?;
        }
        Err(error) => return Err(error),
    }
    Ok(filename)
}

fn write_temporary(directory: &Path, bytes: &[u8]) -> io::Result<NamedTempFile> {
    let mut temporary = NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    Ok(temporary)
}

fn write_replace(directory: &Path, filename: &str, bytes: &[u8]) -> io::Result<()> {
    let temporary = write_temporary(directory, bytes)?;
    temporary
        .persist(directory.join(filename))
        .map_err(|error| error.error)?;
    Ok(())
}

fn path_text(path: &Path) -> io::Result<&str> {
    path.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "A Glassbox handoff path must be Unicode",
        )
    })
}

fn quoted(value: &str) -> String {
    serde_json::Value::String(value.into()).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handoff_quoting_round_trips_shell_characters_and_windows_paths() {
        for path in [
            r#"/data/test "quoted" & name/review.md"#,
            r#"C:\Users\Sample Name\review.md"#,
            "/data/with\nnewline/review.md",
        ] {
            assert_eq!(serde_json::from_str::<String>(&quoted(path)).unwrap(), path);
            assert!(!quoted(path).contains('\n'));
        }
    }
}
