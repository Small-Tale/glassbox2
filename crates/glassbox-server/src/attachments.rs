//! HS2-3G613V: safe previews and an explicit operating-system open for verified attachments.
//!
//! An attachment is only previewed or opened when it is *verified*: its filename extension and its leading
//! bytes name the same kind from a short allowlist, and it is within the size cap. Neither the extension nor a
//! client-supplied type decides alone, and nothing outside the allowlist (SVG, HTML, text, archives,
//! executables) is ever previewed or handed to another program.

use std::io;
use std::path::{Path, PathBuf};

use axum::Json;
use axum::body::Body;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use glassbox_model::feedback::FeedbackId;
use serde::{Deserialize, Serialize};

use crate::discussion::{Discussion, DiscussionSelection};

/// The largest attachment that is previewed or opened.
pub(crate) const MAX_BYTES: usize = 25 * 1024 * 1024;

/// A verified attachment kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Png,
    Jpeg,
    Gif,
    Webp,
    Pdf,
}

impl Kind {
    pub(crate) fn media_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Pdf => "application/pdf",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
            Self::Pdf => "pdf",
        }
    }

    /// How the client shows it: an image element or an embedded document.
    pub(crate) fn preview(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            _ => "image",
        }
    }
}

fn sniff(bytes: &[u8]) -> Option<Kind> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(Kind::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(Kind::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(Kind::Gif)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(Kind::Webp)
    } else if bytes.starts_with(b"%PDF-") {
        Some(Kind::Pdf)
    } else {
        None
    }
}

fn extension_kind(filename: &str) -> Option<Kind> {
    let extension = Path::new(filename)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some(Kind::Png),
        "jpg" | "jpeg" => Some(Kind::Jpeg),
        "gif" => Some(Kind::Gif),
        "webp" => Some(Kind::Webp),
        "pdf" => Some(Kind::Pdf),
        _ => None,
    }
}

/// The kind of a verified attachment, or `None` when it must not be previewed or opened.
pub(crate) fn verified(filename: &str, bytes: &[u8]) -> Option<Kind> {
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let sniffed = sniff(bytes)?;
    (extension_kind(filename)? == sniffed).then_some(sniffed)
}

#[derive(Deserialize)]
pub(crate) struct AttachmentInput {
    selection: DiscussionSelection,
    thread: FeedbackId,
    attachment: FeedbackId,
}

#[derive(Serialize)]
struct Opened {
    opened: bool,
}

/// Finds the attachment and checks it, answering the status and message to return when it cannot be used.
async fn verified_attachment(
    discussion: Discussion,
    input: AttachmentInput,
) -> Result<(Kind, FeedbackId, Vec<u8>), (StatusCode, String)> {
    let id = input.attachment;
    let found = tokio::task::spawn_blocking(move || {
        discussion.attachment(&input.selection, input.thread, input.attachment)
    })
    .await;
    let (filename, bytes) = match found {
        Ok(Ok(Some(item))) => item,
        Ok(Ok(None)) => return Err((StatusCode::NOT_FOUND, String::new())),
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err((StatusCode::INTERNAL_SERVER_ERROR, String::new())),
    };
    match verified(&filename, &bytes) {
        Some(kind) => Ok((kind, id, bytes)),
        None => Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "This attachment cannot be previewed or opened.".into(),
        )),
    }
}

/// Serves a verified attachment's bytes for inline preview, with headers that keep the browser from
/// interpreting them as anything else.
pub(crate) async fn preview(discussion: Discussion, input: AttachmentInput) -> Response {
    let (kind, _, bytes) = match verified_attachment(discussion, input).await {
        Ok(found) => found,
        Err(refusal) => return refusal.into_response(),
    };
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, kind.media_type().parse().unwrap());
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::CONTENT_SECURITY_POLICY, "sandbox".parse().unwrap());
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

/// Opens a verified attachment with the platform's default program, from a private copy under a generated
/// name, so the person's filename never reaches the launcher.
pub(crate) async fn open(discussion: Discussion, input: AttachmentInput) -> Response {
    let (kind, id, bytes) = match verified_attachment(discussion, input).await {
        Ok(found) => found,
        Err(refusal) => return refusal.into_response(),
    };
    let launched = tokio::task::spawn_blocking(move || {
        let path = write_private_copy(id, kind, &bytes)?;
        launch(&path)
    })
    .await;
    match launched {
        Ok(Ok(())) => Json(Opened { opened: true }).into_response(),
        Ok(Err(error)) => (
            StatusCode::BAD_GATEWAY,
            format!("Could not open the attachment: {error}"),
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn private_directory() -> PathBuf {
    std::env::temp_dir().join(format!("glassbox-attachments-{}", std::process::id()))
}

fn write_private_copy(id: FeedbackId, kind: Kind, bytes: &[u8]) -> io::Result<PathBuf> {
    use std::io::Write;

    let directory = private_directory();
    std::fs::create_dir_all(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    let path = directory.join(format!("attachment-{id}.{}", kind.extension()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(&path)?.write_all(bytes)?;
    Ok(path)
}

/// `GLASSBOX_ATTACHMENT_OPENER` names a program that receives the path instead of the platform opener, so
/// tests can record a launch without opening a real application.
fn launch(path: &Path) -> io::Result<()> {
    match std::env::var_os("GLASSBOX_ATTACHMENT_OPENER") {
        Some(program) => {
            let mut child = std::process::Command::new(program)
                .arg(path)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        None => crate::review_files::launch_desktop(path, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    #[test]
    fn extension_and_bytes_must_agree() {
        assert_eq!(verified("shot.png", PNG), Some(Kind::Png));
        assert_eq!(verified("SHOT.PNG", PNG), Some(Kind::Png));
        assert_eq!(verified("shot.jpg", PNG), None, "a PNG renamed .jpg");
        assert_eq!(verified("shot", PNG), None, "no extension");
        assert_eq!(verified("shot.png", b"not an image"), None);
    }

    #[test]
    fn every_allowed_kind_is_recognised() {
        assert_eq!(
            verified("a.jpeg", &[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(Kind::Jpeg)
        );
        assert_eq!(
            verified("a.jpg", &[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(Kind::Jpeg)
        );
        assert_eq!(verified("a.gif", b"GIF89a.."), Some(Kind::Gif));
        assert_eq!(verified("a.gif", b"GIF87a.."), Some(Kind::Gif));
        assert_eq!(
            verified("a.webp", b"RIFF\0\0\0\0WEBPVP8 "),
            Some(Kind::Webp)
        );
        assert_eq!(verified("a.pdf", b"%PDF-1.7\n"), Some(Kind::Pdf));
        assert_eq!(Kind::Pdf.preview(), "pdf");
        assert_eq!(Kind::Png.preview(), "image");
        assert_eq!(Kind::Pdf.media_type(), "application/pdf");
    }

    #[test]
    fn dangerous_or_unlisted_types_are_never_verified() {
        assert_eq!(
            verified("a.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
            None
        );
        assert_eq!(verified("a.html", b"<html><script>1</script>"), None);
        assert_eq!(verified("a.txt", b"hello"), None);
        assert_eq!(verified("a.exe", b"MZ\x90\0"), None);
        assert_eq!(verified("a.pdf.exe", b"%PDF-1.7\n"), None);
        assert_eq!(verified("a.png", b"RIFF\0\0\0\0WAVEfmt "), None);
    }

    #[test]
    fn oversized_attachments_are_not_verified() {
        let mut big = PNG.to_vec();
        big.resize(MAX_BYTES + 1, 0);
        assert_eq!(verified("big.png", &big), None);
        big.truncate(MAX_BYTES);
        assert_eq!(verified("big.png", &big), Some(Kind::Png));
    }

    #[test]
    fn private_copies_use_generated_names_and_owner_only_permissions() {
        let path = write_private_copy(7, Kind::Png, PNG).unwrap();
        assert_eq!(path.file_name().unwrap(), "attachment-7.png");
        assert_eq!(std::fs::read(&path).unwrap(), PNG);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(path.parent().unwrap()), 0o700);
        }
        std::fs::remove_file(path).unwrap();
    }
}
