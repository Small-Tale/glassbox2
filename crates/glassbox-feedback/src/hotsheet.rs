use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use glassbox_model::feedback::FeedbackThread;
use serde::{Deserialize, Serialize};
use tempfile::{Builder, TempDir};

use super::{ATTACHMENTS, FeedbackBundle};

const MARKER: &str = "hotsheet-store.json";
const ACTOR: &str = "glassbox";
const BATCH_LABEL: &str = "Glassbox feedback";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExportTarget {
    #[default]
    New,
    Existing {
        reference: String,
    },
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportRequest {
    #[serde(default)]
    pub target: ExportTarget,
    #[serde(default)]
    pub title: String,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportReceipt {
    pub ticket: String,
    pub batch_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecentTicket {
    pub slug: String,
    pub title: String,
    pub status: String,
}

pub struct HotSheetClient {
    cli: PathBuf,
    store: PathBuf,
}

impl HotSheetClient {
    pub fn for_project(project: &Path) -> io::Result<Self> {
        let project = std::path::absolute(project)?;
        let configured = std::env::var_os("HOTSHEET_STORE").map(PathBuf::from);
        let store = locate_store(&project, configured.as_deref()).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "No Hot Sheet 2 store found for this project",
            )
        })?;
        Self::for_store(discover_cli(), store)
    }

    pub fn for_destination(path: &Path) -> io::Result<Self> {
        let path = std::path::absolute(path)?;
        let store = locate_store(&path, None).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "No Hot Sheet 2 store found at this destination",
            )
        })?;
        Self::for_store(discover_cli(), store)
    }

    pub fn store_path(&self) -> &Path {
        &self.store
    }

    pub fn recent_tickets(&self) -> io::Result<Vec<RecentTicket>> {
        let list = self.run("ls", ["--sort", "created"])?;
        recent_rows(&list)
    }

    pub fn for_store(cli: impl Into<PathBuf>, store: impl Into<PathBuf>) -> io::Result<Self> {
        let store = std::path::absolute(store.into())?;
        if !store.join(MARKER).is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "The selected Hot Sheet 2 store does not exist",
            ));
        }
        Ok(Self {
            cli: cli.into(),
            store,
        })
    }

    fn run(
        &self,
        operation: &'static str,
        args: impl IntoIterator<Item = impl AsRef<OsStr>>,
    ) -> io::Result<String> {
        let output = Command::new(&self.cli)
            .arg("-C")
            .arg(&self.store)
            .arg(operation)
            .args(["--actor-role=human", "--actor-id", ACTOR])
            .args(args)
            .env_remove("HOTSHEET_STORE")
            .env_remove("HOTSHEET_ACTOR_ROLE")
            .env_remove("HOTSHEET_ACTOR_ID")
            .output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let message = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(io::Error::other(format!(
                "Hot Sheet {operation} failed: {message}"
            )));
        }
        String::from_utf8(output.stdout).map_err(io::Error::other)
    }

    fn ticket(&self, id: &str) -> io::Result<Ticket> {
        Ticket::read(self.run("show", ["--", id])?)
    }
}

fn locate_store(project: &Path, configured: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = configured.filter(|path| path.join(MARKER).is_file()) {
        return Some(path.to_path_buf());
    }
    for path in project.ancestors() {
        if path.join(MARKER).is_file() {
            return Some(path.to_path_buf());
        }
        if let Ok(link) = fs::read_to_string(path.join(".hotsheet2/store")) {
            let target = path.join(link.trim());
            if target.join(MARKER).is_file() {
                return Some(target);
            }
        }
    }
    for path in project.ancestors() {
        let mut sibling = path.as_os_str().to_owned();
        sibling.push(".hs2");
        let sibling = PathBuf::from(sibling);
        if sibling.join(MARKER).is_file() {
            return Some(sibling);
        }
    }
    None
}

fn discover_cli() -> PathBuf {
    if let Some(configured) = std::env::var_os("HOTSHEET_CLI") {
        return PathBuf::from(configured);
    }
    let executable = format!("hotsheet-cli{}", std::env::consts::EXE_SUFFIX);
    let search_path = std::env::var_os("PATH").unwrap_or_default();
    let path = std::env::split_paths(&search_path);
    let install_paths = [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    let user_paths = std::env::home_dir()
        .into_iter()
        .flat_map(|home| [home.join(".cargo/bin"), home.join(".local/bin")]);

    path.chain(install_paths)
        .chain(user_paths)
        .map(|directory| directory.join(&executable))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| executable.into())
}

impl FeedbackBundle {
    pub fn prepare_export(
        &self,
        client: HotSheetClient,
        request: ExportRequest,
    ) -> io::Result<PreparedExport> {
        let evidence = self
            .publication
            .lock()
            .map_err(|_| io::Error::other("The feedback writer lost its publication lock"))?;
        let document = fs::read_to_string(self.path())?;
        self.stage_export(client, request, document, &evidence)
    }

    pub fn prepare_selected_export(
        &self,
        client: HotSheetClient,
        request: ExportRequest,
        threads: &[&FeedbackThread],
    ) -> io::Result<PreparedExport> {
        let _publication = self
            .publication
            .lock()
            .map_err(|_| io::Error::other("The feedback writer lost its publication lock"))?;
        let (document, evidence) = self.render_document(threads.iter().copied())?;
        let document = String::from_utf8(document).map_err(io::Error::other)?;
        self.stage_export(client, request, document, &evidence)
    }

    fn stage_export(
        &self,
        client: HotSheetClient,
        request: ExportRequest,
        mut document: String,
        evidence: &std::collections::BTreeSet<String>,
    ) -> io::Result<PreparedExport> {
        let staging = Builder::new().prefix("gb-delivery-").tempdir()?;
        let batch_id = staging
            .path()
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| io::Error::other("Could not create a feedback delivery ID"))?
            .to_owned();
        let mut files = Vec::with_capacity(evidence.len() + 1);
        for filename in evidence.iter() {
            let exported = format!("{batch_id}-{filename}");
            let target = staging.path().join(&exported);
            fs::copy(self.directory.join(ATTACHMENTS).join(filename), &target)?;
            document = document.replace(
                &format!("`{ATTACHMENTS}/{filename}`"),
                &format!("attachment:{exported}"),
            );
            files.push(target);
        }
        let document_name = format!("{batch_id}-review.md");
        let document_path = staging.path().join(&document_name);
        fs::write(&document_path, document)?;
        files.push(document_path);
        Ok(PreparedExport {
            client,
            request,
            batch_id,
            document_name,
            files,
            staging,
        })
    }
}

/// A frozen snapshot for one user-initiated delivery. Call `send` again on the
/// same value after a failure to reconcile its ticket, attachment batch and note.
pub struct PreparedExport {
    client: HotSheetClient,
    request: ExportRequest,
    batch_id: String,
    document_name: String,
    files: Vec<PathBuf>,
    staging: TempDir,
}

impl PreparedExport {
    pub fn send(&mut self) -> io::Result<ExportReceipt> {
        let ticket = match &self.request.target {
            ExportTarget::New => self.find_or_create_ticket()?,
            ExportTarget::Existing { reference } => self.client.ticket(reference.trim())?,
        };
        if matches!(ticket.fields.status.as_str(), "deleted" | "moved") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "This Hot Sheet ticket cannot receive feedback",
            ));
        }
        let slug = ticket.fields.slug.clone();
        let missing = self.missing_files(&ticket)?;
        if !missing.is_empty() {
            let args: Vec<OsString> = [
                slug.as_str(),
                "--batch-id",
                self.batch_id.as_str(),
                "--batch-label",
                BATCH_LABEL,
                "--purpose",
                "other",
                "--",
            ]
            .into_iter()
            .map(OsString::from)
            .chain(missing.into_iter().map(|file| file.as_os_str().to_owned()))
            .collect();
            self.client.run("attach", args)?;
        }

        let confirmed = self.client.ticket(&slug)?;
        if !self.missing_files(&confirmed)?.is_empty() {
            return Err(io::Error::other(
                "Hot Sheet has not confirmed the complete feedback batch",
            ));
        }
        let marker = format!("<!-- glassbox-delivery:{} -->", self.batch_id);
        if !confirmed.document.lines().any(|line| line == marker) {
            let mut note = format!(
                "## Glassbox review feedback\n\nRead attachment:{} and its evidence in the attached batch.\n",
                self.document_name,
            );
            if let Some(summary) = self
                .request
                .summary
                .as_deref()
                .filter(|summary| !summary.trim().is_empty())
            {
                note.push_str("\n### Summary\n\n");
                note.push_str(summary);
                note.push('\n');
            }
            note.push('\n');
            note.push_str(&marker);
            note.push('\n');
            let note_path = self.staging.path().join("note.md");
            fs::write(&note_path, note)?;
            self.client.run(
                "edit",
                [
                    OsStr::new(&slug),
                    OsStr::new("--note-file"),
                    note_path.as_os_str(),
                ],
            )?;
        }
        Ok(ExportReceipt {
            ticket: slug,
            batch_id: self.batch_id.clone(),
        })
    }

    fn find_or_create_ticket(&self) -> io::Result<Ticket> {
        let existing = self
            .client
            .run("ls", [format!("--tag={}", self.batch_id)])?;
        if let Some(slug) = tagged_ticket(&existing)? {
            return self.client.ticket(slug);
        }
        let title = self.request.title.trim();
        let title = if title.is_empty() {
            "Glassbox review feedback"
        } else {
            title
        };
        let output = self.client.run(
            "new",
            [
                format!("--title={title}"),
                "--category=task".into(),
                "--tag=glassbox-feedback".into(),
                format!("--tag={}", self.batch_id),
                "--details=Review the attached Glassbox feedback and its evidence.".into(),
            ],
        )?;
        let slug = output
            .lines()
            .find_map(|line| line.strip_prefix("Created "))
            .and_then(|line| line.split_whitespace().next())
            .filter(|slug| valid_slug(slug))
            .ok_or_else(|| io::Error::other("Hot Sheet did not report the created ticket"))?;
        self.client.ticket(slug)
    }

    fn missing_files<'a>(&'a self, ticket: &Ticket) -> io::Result<Vec<&'a Path>> {
        let mut missing = Vec::new();
        for path in &self.files {
            let name = path
                .file_name()
                .and_then(OsStr::to_str)
                .ok_or_else(|| io::Error::other("An export file needs a filename"))?;
            match ticket
                .fields
                .attachments
                .iter()
                .find(|attachment| attachment.filename == name)
            {
                Some(attachment) if attachment.batch_id.as_deref() == Some(&self.batch_id) => {}
                Some(_) => {
                    return Err(io::Error::other(
                        "An attachment with this delivery filename already exists",
                    ));
                }
                None => missing.push(path.as_path()),
            }
        }
        Ok(missing)
    }
}

#[derive(Deserialize)]
struct Attachment {
    filename: String,
    batch_id: Option<String>,
}

#[derive(Deserialize)]
struct TicketFields {
    slug: String,
    status: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
}

struct Ticket {
    fields: TicketFields,
    document: String,
}

impl Ticket {
    fn read(document: String) -> io::Result<Self> {
        let frontmatter = document
            .strip_prefix("---\n")
            .and_then(|body| body.split_once("\n---\n"))
            .map(|(frontmatter, _)| frontmatter)
            .ok_or_else(|| io::Error::other("Hot Sheet returned an invalid ticket document"))?;
        let fields: TicketFields = serde_yaml::from_str(frontmatter).map_err(io::Error::other)?;
        if !valid_slug(&fields.slug) {
            return Err(io::Error::other(
                "Hot Sheet returned an invalid ticket slug",
            ));
        }
        Ok(Self { fields, document })
    }
}

fn recent_rows(output: &str) -> io::Result<Vec<RecentTicket>> {
    if output.trim() == "(no tickets)" {
        return Ok(Vec::new());
    }
    let mut tickets = Vec::new();
    for row in output.lines().filter(|line| !line.trim().is_empty()).rev() {
        let mut fields = row.split_whitespace().skip(1);
        let slug = fields.next().filter(|value| valid_slug(value));
        let status = fields.next();
        let title = fields.collect::<Vec<_>>().join(" ");
        match (slug, status) {
            (Some(_), Some("deleted" | "moved")) => continue,
            (Some(slug), Some(status)) if !title.is_empty() => tickets.push(RecentTicket {
                slug: slug.into(),
                status: status.into(),
                title,
            }),
            _ => {
                return Err(io::Error::other(
                    "Hot Sheet returned an invalid recent ticket list",
                ));
            }
        }
        if tickets.len() == 10 {
            break;
        }
    }
    Ok(tickets)
}

fn tagged_ticket(output: &str) -> io::Result<Option<&str>> {
    let mut rows = output.lines().filter(|line| !line.trim().is_empty());
    let first = rows.next();
    if first.is_none_or(|row| row.trim() == "(no tickets)") {
        return Ok(None);
    }
    let slug = first
        .and_then(|row| row.split_whitespace().nth(1))
        .filter(|id| valid_slug(id));
    if slug.is_none() || rows.next().is_some() {
        return Err(io::Error::other(
            "Hot Sheet did not return a unique ticket for this delivery",
        ));
    }
    Ok(slug)
}

fn valid_slug(slug: &str) -> bool {
    slug.contains('-')
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use glassbox_model::feedback::{
        AnchorSide, AnchorTarget, FeedbackChange, MessageTarget, ReviewAnchor, ReviewFeedback,
        ReviewerCategory, ThreadOrigin,
    };

    use super::*;
    use crate::{BundleContext, BundleStore};

    #[test]
    fn recent_tickets_are_newest_first_and_omit_tombstones() {
        let input = " ● HS2-000001   started      First ticket\n ● HS2-000002   deleted      Deleted\n*● HS2-000003   completed    Third ticket\n";
        let tickets = super::recent_rows(input).unwrap();
        assert_eq!(
            tickets
                .iter()
                .map(|ticket| ticket.slug.as_str())
                .collect::<Vec<_>>(),
            ["HS2-000003", "HS2-000001"]
        );
        assert!(super::recent_rows("(no tickets)").unwrap().is_empty());
        assert!(super::recent_rows("invalid output").is_err());
    }

    #[test]
    fn new_is_default_and_ticket_lookup_rejects_ambiguous_deliveries() {
        let request: ExportRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(request.target, ExportTarget::New);
        assert_eq!(tagged_ticket("(no tickets)\n").unwrap(), None);
        assert_eq!(
            tagged_ticket("*● SAMPLE-123ABC started  Delivery\n").unwrap(),
            Some("SAMPLE-123ABC")
        );
        assert!(
            tagged_ticket(
                "● SAMPLE-123ABC started  Delivery\n● SAMPLE-456DEF started  Duplicate\n"
            )
            .is_err()
        );
    }

    #[test]
    fn project_routing_prefers_an_explicit_store_and_reads_local_links() {
        let fixture = tempfile::tempdir().unwrap();
        let project = fixture.path().join("project");
        let location = project.join("source");
        let override_store = fixture.path().join("override");
        let linked_store = fixture.path().join("linked");
        let sibling = fixture.path().join("project.hs2");
        fs::create_dir_all(&location).unwrap();
        for store in [&override_store, &linked_store, &sibling] {
            fs::create_dir_all(store).unwrap();
            fs::write(store.join(MARKER), "{}").unwrap();
        }
        assert_eq!(locate_store(&location, None), Some(sibling));
        fs::create_dir(project.join(".hotsheet2")).unwrap();
        fs::write(
            project.join(".hotsheet2/store"),
            linked_store.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(locate_store(&location, None), Some(linked_store));
        assert_eq!(
            locate_store(&location, Some(&override_store)),
            Some(override_store)
        );
    }

    #[test]
    #[ignore = "Requires a locally installed Hot Sheet 2 CLI. Uses a disposable store."]
    fn real_hotsheet_reconciles_partial_attach_and_supports_both_destinations() {
        let fixture = tempfile::tempdir().unwrap();
        let store = fixture.path().join("store");
        fs::create_dir(&store).unwrap();
        let cli = discover_cli();
        let status = Command::new(&cli)
            .args(["-C"])
            .arg(&store)
            .args([
                "init",
                "--prefix=GBTEST",
                "--actor-role=human",
                "--actor-id=glassbox-test",
            ])
            .env_remove("HOTSHEET_STORE")
            .env_remove("HOTSHEET_ACTOR_ROLE")
            .env_remove("HOTSHEET_ACTOR_ID")
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );

        let mut feedback = ReviewFeedback::default();
        let id = feedback
            .add(
                ReviewAnchor {
                    path: "src/example.rs".into(),
                    side: AnchorSide::After,
                    revision: "one".into(),
                    target: AnchorTarget::Line { start: 5, end: 5 },
                },
                ThreadOrigin::Reviewer {
                    category: ReviewerCategory::Fix,
                },
                "Reviewer".into(),
                "Initial feedback.".into(),
            )
            .unwrap();
        feedback
            .apply(
                id,
                1,
                FeedbackChange::Attach {
                    message: MessageTarget::Opening,
                    filename: "example.bin".into(),
                    bytes: vec![0, 255, 10],
                },
            )
            .unwrap();
        let bundle = BundleStore::in_directory(fixture.path().join("feedback"))
            .create(
                BundleContext {
                    project: Some(fixture.path().to_path_buf()),
                    comparison: "Working tree".into(),
                    before: None,
                    after: None,
                },
                &feedback,
            )
            .unwrap();
        let open_client = || HotSheetClient::for_store(&cli, &store).unwrap();
        let mut new = bundle
            .prepare_export(
                open_client(),
                ExportRequest {
                    title: "- Review title".into(),
                    ..ExportRequest::default()
                },
            )
            .unwrap();

        let handoff = new.files.last().unwrap().clone();
        let snapshot = fs::read_to_string(&handoff).unwrap();
        assert!(snapshot.contains("> Initial feedback."));
        assert!(snapshot.contains("attachment:gb-delivery-"));
        fs::remove_file(&handoff).unwrap();
        assert!(new.send().is_err());
        let first = new.find_or_create_ticket().unwrap();
        assert_eq!(first.fields.attachments.len(), 1);
        assert!(first.document.contains("- Review title"));

        fs::write(&handoff, &snapshot).unwrap();
        let receipt = new.send().unwrap();
        assert_eq!(new.send().unwrap(), receipt);
        assert_eq!(receipt.ticket, first.fields.slug);
        let ticket = new.client.ticket(&receipt.ticket).unwrap();
        assert_eq!(ticket.fields.attachments.len(), 2);
        assert_eq!(
            ticket.document.matches("<!-- glassbox-delivery:").count(),
            1
        );

        feedback
            .apply(
                id,
                2,
                FeedbackChange::Edit {
                    message: MessageTarget::Opening,
                    markdown: "Updated feedback.".into(),
                },
            )
            .unwrap();
        bundle.publish(&feedback).unwrap();
        let mut existing = bundle
            .prepare_export(
                open_client(),
                ExportRequest {
                    target: ExportTarget::Existing {
                        reference: receipt.ticket.clone(),
                    },
                    title: String::new(),
                    summary: Some("Reviewer summary".into()),
                },
            )
            .unwrap();
        let export_document = fs::read_to_string(existing.files.last().unwrap()).unwrap();
        assert!(export_document.contains("> Updated feedback."));
        assert!(!export_document.contains("> Initial feedback."));
        let appended = existing.send().unwrap();
        assert_eq!(appended.ticket, receipt.ticket);
        assert_ne!(appended.batch_id, receipt.batch_id);
        let ticket = existing.client.ticket(&receipt.ticket).unwrap();
        assert_eq!(ticket.fields.attachments.len(), 4);
        let batches: BTreeSet<_> = ticket
            .fields
            .attachments
            .iter()
            .filter_map(|attachment| attachment.batch_id.as_deref())
            .collect();
        assert_eq!(
            batches,
            BTreeSet::from([receipt.batch_id.as_str(), appended.batch_id.as_str()])
        );
        assert_eq!(
            ticket.document.matches("<!-- glassbox-delivery:").count(),
            2
        );
        assert!(ticket.document.contains("Reviewer summary"));
        assert_eq!(
            existing
                .client
                .run("ls", ["--tag=glassbox-feedback"])
                .unwrap()
                .lines()
                .count(),
            1
        );
    }
}
