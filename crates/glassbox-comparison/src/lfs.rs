use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;

use glassbox_model::{LfsObject, LfsUnavailableReason};
use sha2::{Digest, Sha256};

pub(crate) fn parse_pointer(bytes: &[u8]) -> Option<LfsObject> {
    if bytes.len() > 1024 {
        return None;
    }
    let mut lines = std::str::from_utf8(bytes).ok()?.lines();
    if lines.next()? != "version https://git-lfs.github.com/spec/v1" {
        return None;
    }
    let oid = lines.next()?.strip_prefix("oid sha256:")?;
    let size = lines.next()?.strip_prefix("size ")?.parse().ok()?;
    if oid.len() != 64
        || !oid.bytes().all(|byte| byte.is_ascii_hexdigit())
        || lines.next().is_some()
    {
        return None;
    }
    Some(LfsObject {
        oid: oid.to_ascii_lowercase(),
        size,
    })
}

pub(crate) fn read_object(
    directory: &Path,
    object: &LfsObject,
) -> io::Result<Result<Vec<u8>, LfsUnavailableReason>> {
    let oid = &object.oid;
    let path = directory.join(&oid[0..2]).join(&oid[2..4]).join(oid);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(LfsUnavailableReason::Missing));
        }
        Err(error) => return Err(error),
    };
    if !metadata.is_file() || metadata.len() != object.size {
        return Ok(Err(LfsUnavailableReason::Mismatched));
    }
    let mut bytes = Vec::new();
    match File::open(&path) {
        Ok(file) => file
            .take(object.size.saturating_add(1))
            .read_to_end(&mut bytes)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(LfsUnavailableReason::Missing));
        }
        Err(error) => return Err(error),
    };
    if bytes.len() as u64 != object.size || format!("{:x}", Sha256::digest(&bytes)) != *oid {
        return Ok(Err(LfsUnavailableReason::Mismatched));
    }
    Ok(Ok(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pointer_requires_a_sha256_object_and_exact_size_field() {
        let header = "version https://git-lfs.github.com/spec/v1";
        let hash = "A".repeat(64);
        let record = format!("{header}\r\noid sha256:{hash}\r\nsize 0\r\n");
        let pointer = parse_pointer(record.as_bytes()).unwrap();
        assert_eq!(pointer.oid, hash.to_ascii_lowercase());
        assert_eq!(pointer.size, 0);
        for malformed in [
            format!("{header}\noid sha256:../asset\nsize 0\n"),
            format!("{header}\noid sha256:{hash}\nsize -1\n"),
            format!("{header}\noid sha256:{hash}\nsize 0\ntrailing\n"),
        ] {
            assert!(parse_pointer(malformed.as_bytes()).is_none());
        }
    }
}
