use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::{fs, io};

use glassbox_model::feedback::AnchorSide;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitReviewMode<'a> {
    WorkingTree,
    Staged,
    Unstaged,
    Commit(&'a str),
    Range { before: &'a str, after: &'a str },
    Branch(&'a str),
    Paths(&'a [&'a Path]),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitChange {
    Added,
    Copied,
    Deleted,
    Modified,
    Renamed,
    TypeChanged,
    Unmerged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitFileChange {
    pub change: GitChange,
    pub before_path: Option<PathBuf>,
    pub after_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum GitSource {
    Tree(String),
    Index,
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitReview {
    pub root: PathBuf,
    pub changes: Vec<GitFileChange>,
    pub patch: Vec<u8>,
    before: GitSource,
    after: GitSource,
}

pub(crate) struct GitFileBytes {
    pub(crate) before: Option<Vec<u8>>,
    pub(crate) after: Option<Vec<u8>>,
}

impl GitReview {
    fn source(&self, side: AnchorSide) -> &GitSource {
        match side {
            AnchorSide::Before => &self.before,
            AnchorSide::After => &self.after,
        }
    }

    pub fn matching_text_paths(
        &self,
        side: AnchorSide,
        needle: &str,
        extensions: &[&str],
    ) -> io::Result<Vec<PathBuf>> {
        let mut arguments = vec![
            "grep",
            "--no-color",
            "--no-textconv",
            "--no-recurse-submodules",
            "--full-name",
            "--files-with-matches",
            "--null",
            "--fixed-strings",
            "-e",
            needle,
        ];
        let source = self.source(side);
        if matches!(source, GitSource::Index) {
            arguments.insert(1, "--cached");
        }
        if let GitSource::Tree(tree) = source {
            arguments.push(tree);
        }
        arguments.push("--");
        arguments.extend_from_slice(extensions);
        let (bytes, status) = bounded_git(&self.root, arguments, 64 * 1024)?;
        if status == Some(1) {
            return Ok(Vec::new());
        }
        if status != Some(0) {
            return Err(io::Error::other("Could not search the selected Git side"));
        }
        let prefix = match source {
            GitSource::Tree(tree) => format!("{tree}:"),
            _ => String::new(),
        };
        bytes
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|entry| {
                let path = entry
                    .strip_prefix(prefix.as_bytes())
                    .ok_or_else(|| io::Error::other("Unexpected Git search result"))?;
                git_path(path)
            })
            .collect()
    }

    pub fn read_text_source(
        &self,
        side: AnchorSide,
        path: &Path,
        limit: usize,
    ) -> io::Result<Option<String>> {
        if path.as_os_str().is_empty()
            || !path
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Expected a repository-relative path",
            ));
        }
        let bytes = match self.source(side) {
            GitSource::Worktree => {
                let root = self.root.canonicalize()?;
                let worktree = root.join(path);
                let Ok(metadata) = fs::symlink_metadata(&worktree) else {
                    return Ok(None);
                };
                if !metadata.is_file() || metadata.len() > limit as u64 {
                    return Ok(None);
                }
                let resolved = worktree.canonicalize()?;
                if resolved.strip_prefix(&root).ok() != Some(path) {
                    return Ok(None);
                }
                let mut bytes = Vec::new();
                fs::File::open(resolved)?
                    .take((limit as u64).saturating_add(1))
                    .read_to_end(&mut bytes)?;
                bytes
            }
            source => {
                let mut revision = match source {
                    GitSource::Tree(tree) => OsString::from(tree),
                    _ => OsString::new(),
                };
                revision.push(":");
                revision.push(path);
                let arguments = [OsStr::new("cat-file"), OsStr::new("blob"), &revision];
                match bounded_git(&self.root, arguments, limit) {
                    Ok((bytes, Some(0))) => bytes,
                    Ok(_) => return Ok(None),
                    Err(error) if error.kind() == io::ErrorKind::FileTooLarge => return Ok(None),
                    Err(error) => return Err(error),
                }
            }
        };
        if bytes.len() > limit || bytes.contains(&0) {
            return Ok(None);
        }
        Ok(String::from_utf8(bytes).ok())
    }

    pub fn read_tracked_text_source(
        &self,
        side: AnchorSide,
        path: &Path,
        limit: usize,
    ) -> io::Result<Option<String>> {
        if matches!(self.source(side), GitSource::Worktree) {
            let (paths, status) = bounded_git(
                &self.root,
                [
                    OsStr::new("--literal-pathspecs"),
                    OsStr::new("ls-files"),
                    OsStr::new("-z"),
                    OsStr::new("--"),
                    path.as_os_str(),
                ],
                64 * 1024,
            )?;
            if status != Some(0)
                || !paths.split(|byte| *byte == 0).any(|entry| {
                    !entry.is_empty() && git_path(entry).is_ok_and(|tracked| tracked == path)
                })
            {
                return Ok(None);
            }
        }
        self.read_text_source(side, path, limit)
    }

    pub fn branch_name(&self) -> io::Result<Option<String>> {
        let output = git(&self.root, ["symbolic-ref", "--quiet", "--short", "HEAD"])?;
        Ok(output
            .status
            .success()
            .then(|| String::from_utf8_lossy(strip_line_ending(&output.stdout)).into_owned()))
    }

    pub(crate) fn lfs_objects_directory(&self) -> io::Result<PathBuf> {
        let common = checked_git(
            &self.root,
            ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?;
        let git_directory = git_path(strip_line_ending(&common.stdout))?;
        let configured = git(&self.root, ["config", "--path", "--get", "lfs.storage"])?;
        let storage = match configured.status.code() {
            Some(0) if !strip_line_ending(&configured.stdout).is_empty() => {
                git_path(strip_line_ending(&configured.stdout))?
            }
            Some(0 | 1) => PathBuf::from("lfs"),
            _ => {
                return Err(io::Error::other(
                    String::from_utf8_lossy(&configured.stderr).into_owned(),
                ));
            }
        };
        Ok(git_directory.join(storage).join("objects"))
    }

    pub(crate) fn read_change_sides(&self, index: usize) -> io::Result<GitFileBytes> {
        let change = self
            .changes
            .get(index)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Unknown changed file"))?;
        let read = |path: Option<&Path>, source: &GitSource| {
            path.map(|path| source.read(&self.root, path)).transpose()
        };
        Ok(GitFileBytes {
            before: read(change.before_path.as_deref(), &self.before)?,
            after: read(change.after_path.as_deref(), &self.after)?,
        })
    }
}

impl GitSource {
    fn read(&self, root: &Path, path: &Path) -> io::Result<Vec<u8>> {
        let mut revision = match self {
            Self::Tree(tree) => OsString::from(tree),
            Self::Index => OsString::new(),
            Self::Worktree => return read_local_entry(&root.join(path)),
        };
        revision.push(":");
        revision.push(path.as_os_str());
        Ok(checked_git(
            root,
            [OsStr::new("cat-file"), OsStr::new("blob"), &revision],
        )?
        .stdout)
    }
}

pub(crate) fn read_local_entry(path: &Path) -> io::Result<Vec<u8>> {
    let kind = fs::symlink_metadata(path)?.file_type();
    if kind.is_symlink() {
        return Ok(fs::read_link(path)?.as_os_str().as_encoded_bytes().to_vec());
    }
    if !kind.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected a regular file or symbolic link",
        ));
    }
    fs::read(path)
}

pub fn review_git(directory: &Path, mode: GitReviewMode<'_>) -> io::Result<GitReview> {
    let root = git_path(strip_line_ending(
        &checked_git(directory, ["rev-parse", "--show-toplevel"])?.stdout,
    ))?;
    let (mut args, before, after) = diff_sources(&root, mode)?;
    args.extend(
        [
            "--raw",
            "-z",
            "--patch",
            "-U3",
            "--find-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-relative",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--",
        ]
        .map(OsString::from),
    );
    if let GitReviewMode::Paths(paths) = mode {
        args.extend(paths.iter().map(|path| path.as_os_str().to_owned()));
    }

    let output = checked_git(&root, &args)?;
    let (mut changes, mut patch) = parse_diff(output.stdout)?;
    if matches!(mode, GitReviewMode::WorkingTree | GitReviewMode::Paths(_)) {
        let filters = match mode {
            GitReviewMode::Paths(paths) => paths,
            _ => &[],
        };
        append_untracked(&root, filters, &mut changes, &mut patch)?;
    }
    Ok(GitReview {
        root,
        changes,
        patch,
        before,
        after,
    })
}

fn diff_sources(
    root: &Path,
    mode: GitReviewMode<'_>,
) -> io::Result<(Vec<OsString>, GitSource, GitSource)> {
    use GitSource::{Index, Tree, Worktree};
    let args = |values: Vec<String>| values.into_iter().map(OsString::from).collect();
    let (command, before, after) = match mode {
        GitReviewMode::WorkingTree | GitReviewMode::Paths(_) => {
            let head = head_or_empty_tree(root)?;
            (
                args(vec!["diff".into(), head.clone()]),
                Tree(head),
                Worktree,
            )
        }
        GitReviewMode::Staged => {
            let head = head_or_empty_tree(root)?;
            (
                args(vec!["diff".into(), "--cached".into(), head.clone()]),
                Tree(head),
                Index,
            )
        }
        GitReviewMode::Unstaged => (vec!["diff".into()], Index, Worktree),
        GitReviewMode::Commit(revision) => {
            let commit = resolve_commit(root, revision)?;
            let parents = checked_git(root, ["rev-list", "--parents", "-n", "1", &commit])?;
            let parents = String::from_utf8_lossy(&parents.stdout);
            let base = match parents.split_whitespace().nth(1) {
                Some(parent) => parent.to_owned(),
                None => empty_tree(root)?,
            };
            (
                args(vec!["diff".into(), base.clone(), commit.clone()]),
                Tree(base),
                Tree(commit),
            )
        }
        GitReviewMode::Range { before, after } => {
            let before = resolve_commit(root, before)?;
            let after = resolve_commit(root, after)?;
            (
                args(vec!["diff".into(), before.clone(), after.clone()]),
                Tree(before),
                Tree(after),
            )
        }
        GitReviewMode::Branch(branch) => {
            let branch = resolve_commit(root, branch)?;
            let head = resolve_commit(root, "HEAD")?;
            let base = object_name(&checked_git(root, ["merge-base", &branch, &head])?)?;
            (
                args(vec!["diff".into(), base.clone(), head.clone()]),
                Tree(base),
                Tree(head),
            )
        }
    };
    Ok((command, before, after))
}

pub(crate) fn git(
    directory: &Path,
    args: impl IntoIterator<Item = impl AsRef<OsStr>>,
) -> io::Result<Output> {
    git_command(directory, args).output()
}

fn git_command(directory: &Path, args: impl IntoIterator<Item = impl AsRef<OsStr>>) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(directory)
        .args(args)
        .stdin(Stdio::null());
    for (name, _) in std::env::vars_os() {
        let key = name.to_string_lossy();
        if key.starts_with("GIT_")
            && !matches!(key.as_ref(), "GIT_EXEC_PATH" | "GIT_CONFIG_NOSYSTEM")
        {
            command.env_remove(name);
        }
    }
    command
}

fn bounded_git(
    directory: &Path,
    args: impl IntoIterator<Item = impl AsRef<OsStr>>,
    limit: usize,
) -> io::Result<(Vec<u8>, Option<i32>)> {
    let mut child = git_command(directory, args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .expect("piped Git output")
        .take((limit as u64).saturating_add(1))
        .read_to_end(&mut bytes);
    if read.is_err() || bytes.len() > limit {
        let _ = child.kill();
    }
    let status = child.wait()?;
    read?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::FileTooLarge,
            "Git lookup exceeded its output limit",
        ));
    }
    Ok((bytes, status.code()))
}

fn checked_git(
    directory: &Path,
    args: impl IntoIterator<Item = impl AsRef<OsStr>>,
) -> io::Result<Output> {
    let output = git(directory, args)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(git_error(&output))
    }
}

fn git_error(output: &Output) -> io::Error {
    let stderr = String::from_utf8_lossy(&output.stderr);
    io::Error::other(format!(
        "Git exited with {}: {}",
        output.status,
        stderr.trim()
    ))
}

fn resolve_commit(root: &Path, revision: &str) -> io::Result<String> {
    let expression = format!("{revision}^{{commit}}");
    let output = checked_git(
        root,
        ["rev-parse", "--verify", "--end-of-options", &expression],
    )?;
    object_name(&output)
}

fn head_or_empty_tree(root: &Path) -> io::Result<String> {
    let output = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"])?;
    match output.status.code() {
        Some(0) => object_name(&output),
        Some(1) => object_name(&checked_git(
            root,
            ["hash-object", "-t", "tree", "--stdin"],
        )?),
        _ => Err(git_error(&output)),
    }
}

fn empty_tree(root: &Path) -> io::Result<String> {
    object_name(&checked_git(
        root,
        ["hash-object", "-t", "tree", "--stdin"],
    )?)
}

fn object_name(output: &Output) -> io::Result<String> {
    let name = strip_line_ending(&output.stdout);
    if matches!(name.len(), 40 | 64) && name.iter().all(u8::is_ascii_hexdigit) {
        Ok(String::from_utf8_lossy(name).into_owned())
    } else {
        Err(invalid_output("invalid Git object name"))
    }
}

fn strip_line_ending(bytes: &[u8]) -> &[u8] {
    bytes.strip_suffix(b"\n").unwrap_or(bytes)
}

fn parse_diff(mut output: Vec<u8>) -> io::Result<(Vec<GitFileChange>, Vec<u8>)> {
    if output.is_empty() {
        return Ok((Vec::new(), output));
    }
    let boundary = output
        .windows(2)
        .position(|pair| pair == b"\0\0")
        .ok_or_else(|| invalid_output("missing Git raw/patch separator"))?;
    let patch = output.split_off(boundary + 2);
    let raw = &output[..boundary];
    let mut fields = raw.split(|byte| *byte == 0);
    let mut changes = Vec::new();
    while let Some(header) = fields.next() {
        let status = header
            .strip_prefix(b":")
            .and_then(|header| header.rsplit(|byte| *byte == b' ').next())
            .and_then(|status| status.first())
            .ok_or_else(|| invalid_output("invalid Git raw status header"))?;
        let first = git_path(
            fields
                .next()
                .ok_or_else(|| invalid_output("missing Git path"))?,
        )?;
        let (change, before, after) = match status {
            b'A' => (GitChange::Added, None, Some(first)),
            b'D' => (GitChange::Deleted, Some(first), None),
            b'M' => (GitChange::Modified, Some(first.clone()), Some(first)),
            b'T' => (GitChange::TypeChanged, Some(first.clone()), Some(first)),
            b'U' => (GitChange::Unmerged, Some(first.clone()), Some(first)),
            b'R' | b'C' => {
                let second = git_path(
                    fields
                        .next()
                        .ok_or_else(|| invalid_output("missing Git renamed or copied path"))?,
                )?;
                let change = if *status == b'R' {
                    GitChange::Renamed
                } else {
                    GitChange::Copied
                };
                (change, Some(first), Some(second))
            }
            _ => return Err(invalid_output("unknown Git file status")),
        };
        changes.push(GitFileChange {
            change,
            before_path: before,
            after_path: after,
        });
    }
    Ok((changes, patch))
}

fn append_untracked(
    root: &Path,
    filters: &[&Path],
    changes: &mut Vec<GitFileChange>,
    patch: &mut Vec<u8>,
) -> io::Result<()> {
    let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"]
        .into_iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    args.extend(filters.iter().map(|path| path.as_os_str().to_owned()));
    let untracked = checked_git(root, &args)?;

    for path in untracked
        .stdout
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
    {
        let relative = git_path(path)?;
        if changes
            .iter()
            .any(|change| change.after_path.as_ref() == Some(&relative))
        {
            continue;
        }
        let args = [
            OsStr::new("diff"),
            OsStr::new("--no-index"),
            OsStr::new("--no-ext-diff"),
            OsStr::new("--no-textconv"),
            OsStr::new("--no-color"),
            OsStr::new("-U3"),
            OsStr::new("--"),
            OsStr::new("/dev/null"),
            relative.as_os_str(),
        ];
        let output = git(root, args)?;
        if !matches!(output.status.code(), Some(0 | 1)) {
            return Err(git_error(&output));
        }
        patch.extend_from_slice(&output.stdout);
        changes.push(GitFileChange {
            change: GitChange::Added,
            before_path: None,
            after_path: Some(relative),
        });
    }
    Ok(())
}

fn git_path(bytes: &[u8]) -> io::Result<PathBuf> {
    if bytes.is_empty() {
        return Err(invalid_output("empty Git path"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(OsString::from_vec(bytes.to_vec()).into())
    }
    #[cfg(not(unix))]
    {
        let path =
            std::str::from_utf8(bytes).map_err(|_| invalid_output("invalid Git path encoding"))?;
        Ok(path.into())
    }
}

fn invalid_output(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_parser_preserves_rename_sides_and_patch_bytes() {
        let source = b":100644 100644 abc def R100\0old name\0new name\0\0patch\xff";
        let (changes, patch) = parse_diff(source.to_vec()).unwrap();
        assert_eq!(patch, b"patch\xff");
        assert_eq!(changes[0].change, GitChange::Renamed);
        assert_eq!(
            changes[0].before_path.as_deref(),
            Some(Path::new("old name"))
        );
        assert_eq!(
            changes[0].after_path.as_deref(),
            Some(Path::new("new name"))
        );
    }

    #[test]
    fn raw_parser_rejects_an_incomplete_rename() {
        assert_eq!(
            parse_diff(b":100644 100644 abc def R100\0old name\0\0".to_vec())
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }
}
