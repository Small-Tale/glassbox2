use std::ffi::OsString;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DifftoolInput {
    pub before: PathBuf,
    pub after: PathBuf,
}

impl DifftoolInput {
    pub fn from_arguments(args: &[OsString]) -> io::Result<Self> {
        match args {
            [flag, before, after] if flag == "--difftool" => Ok(Self {
                before: std::path::absolute(before)?,
                after: std::path::absolute(after)?,
            }),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Expected --difftool <before> <after>",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_requires_exactly_two_paths_after_the_difftool_flag() {
        let args = ["--difftool", "file with spaces", "-file"].map(OsString::from);
        let input = DifftoolInput::from_arguments(&args).unwrap();
        assert!(input.before.is_absolute());
        assert!(input.before.ends_with("file with spaces"));
        assert!(input.after.ends_with("-file"));
        assert!(DifftoolInput::from_arguments(&args[..2]).is_err());
        assert!(DifftoolInput::from_arguments(&args[1..]).is_err());
    }
}
