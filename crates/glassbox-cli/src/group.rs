//! Group the per-file launches of one plain `git difftool` run into one review (GB2-FXJSSM).
//!
//! Git starts the registered tool once per changed file, waits for it, and deletes its temporary inputs when it
//! returns. Every launch of one run carries `GIT_DIFF_PATH_COUNTER` (1-based) and `GIT_DIFF_PATH_TOTAL`, and the
//! registered command passes the run's process id (`$PPID`, the same `git diff` for every file) and the
//! repository-relative path (`$MERGED`). The first launches copy their pair into a private staging directory and
//! return at once; the last one launches the client once on the two staged directories, which the client already
//! compares as a directory pair. A launch without that information, or with a total of one, is not grouped.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

const PREFIX: &str = "glassbox-difftool-";
/// A staging directory this old belongs to a run that was interrupted or whose process id has been reused.
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, PartialEq, Eq)]
pub struct Group {
    session: String,
    counter: u32,
    total: u32,
    path: PathBuf,
}

/// The staged review a group's last launch opens.
#[derive(Debug)]
pub struct Staged {
    pub before: PathBuf,
    pub after: PathBuf,
    directory: PathBuf,
}

impl Staged {
    /// Removes the staging directory; the client has exited, so nothing reads it any more.
    pub fn finish(self) {
        let _ = fs::remove_dir_all(self.directory);
    }
}

impl Group {
    pub fn from_environment() -> Option<Self> {
        let var = |name: &str| std::env::var_os(name);
        Self::parse(
            var("GLASSBOX_DIFFTOOL_SESSION").as_deref(),
            var("GIT_DIFF_PATH_COUNTER").as_deref(),
            var("GIT_DIFF_PATH_TOTAL").as_deref(),
            var("GLASSBOX_DIFFTOOL_PATH").as_deref(),
        )
    }

    pub fn parse(
        session: Option<&OsStr>,
        counter: Option<&OsStr>,
        total: Option<&OsStr>,
        path: Option<&OsStr>,
    ) -> Option<Self> {
        let number = |value: Option<&OsStr>| value?.to_str()?.parse::<u32>().ok();
        let (counter, total) = (number(counter)?, number(total)?);
        if total < 2 || !(1..=total).contains(&counter) {
            return None;
        }
        let session = session?.to_str()?;
        if session.is_empty()
            || session.len() > 20
            || !session.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        let path = PathBuf::from(path?);
        let relative = !path.as_os_str().is_empty()
            && path
                .components()
                .all(|part| matches!(part, Component::Normal(_)));
        relative.then(|| Self {
            session: session.to_owned(),
            counter,
            total,
            path,
        })
    }

    pub fn is_last(&self) -> bool {
        self.counter == self.total
    }

    /// Copies this launch's pair into the run's staging directory under `root`. The last launch of the run also
    /// gets the staged review to open.
    pub fn stage(&self, root: &Path, before: &Path, after: &Path) -> io::Result<Option<Staged>> {
        let directory = root.join(format!("{PREFIX}{}", self.session));
        if self.counter == 1 {
            // The first file of a run starts from nothing, whatever an earlier run with this id left behind.
            prune_stale(root, SystemTime::now());
            match fs::remove_dir_all(&directory) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        let (staged_before, staged_after) = (directory.join("before"), directory.join("after"));
        fs::create_dir_all(&staged_before)?;
        fs::create_dir_all(&staged_after)?;
        copy_side(before, &staged_before.join(&self.path))?;
        copy_side(after, &staged_after.join(&self.path))?;
        Ok(self.is_last().then_some(Staged {
            before: staged_before,
            after: staged_after,
            directory,
        }))
    }
}

/// Copies one side when it is a file; an added or deleted file has `/dev/null` (or `nul`) on its other side.
fn copy_side(source: &Path, target: &Path) -> io::Result<()> {
    if !source.is_file() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, target).map(|_| ())
}

/// Removes staging directories older than a day; best effort, since a failure only leaves a temporary folder.
pub fn prune_stale(root: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let stale = entry.file_name().to_string_lossy().starts_with(PREFIX)
            && entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age >= STALE_AFTER);
        if stale {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(session: &str, counter: &str, total: &str, path: &str) -> Option<Group> {
        Group::parse(
            Some(session.as_ref()),
            Some(counter.as_ref()),
            Some(total.as_ref()),
            Some(path.as_ref()),
        )
    }

    #[test]
    fn a_launch_is_grouped_only_with_a_consistent_counter_and_a_safe_path() {
        let grouped = group("4242", "2", "3", "sub folder/a & b.txt").unwrap();
        assert_eq!(grouped.counter, 2);
        assert!(!grouped.is_last());
        assert!(group("4242", "3", "3", "a.txt").unwrap().is_last());
        for (session, counter, total, path) in [
            ("4242", "1", "1", "a.txt"),
            ("4242", "0", "3", "a.txt"),
            ("4242", "4", "3", "a.txt"),
            ("4242", "x", "3", "a.txt"),
            ("4242", "1", "", "a.txt"),
            ("", "1", "3", "a.txt"),
            ("42x", "1", "3", "a.txt"),
            ("-1", "1", "3", "a.txt"),
            ("123456789012345678901", "1", "3", "a.txt"),
            ("4242", "1", "3", ""),
            ("4242", "1", "3", "/etc/passwd"),
            ("4242", "1", "3", "../outside.txt"),
            ("4242", "1", "3", "a/../../b.txt"),
            ("4242", "1", "3", "./a.txt"),
        ] {
            assert_eq!(
                group(session, counter, total, path),
                None,
                "{session} {counter}/{total} {path}"
            );
        }
        assert_eq!(
            Group::parse(
                None,
                Some("1".as_ref()),
                Some("3".as_ref()),
                Some("a".as_ref())
            ),
            None
        );
        assert_eq!(
            Group::parse(
                Some("1".as_ref()),
                None,
                Some("3".as_ref()),
                Some("a".as_ref())
            ),
            None
        );
        assert_eq!(
            Group::parse(
                Some("1".as_ref()),
                Some("1".as_ref()),
                Some("3".as_ref()),
                None
            ),
            None
        );
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn launches_stage_into_two_trees_and_the_last_one_returns_the_review() {
        let scratch = tempfile::tempdir().unwrap();
        let (root, inputs) = (scratch.path().join("temp"), scratch.path().join("git"));
        fs::create_dir_all(&root).unwrap();
        write(&inputs.join("1/a.txt"), "old a");
        write(&inputs.join("2/new.txt"), "added");
        write(&inputs.join("3/gone.txt"), "removed");
        let none = inputs.join("missing");
        let steps = [
            (
                "1",
                "sub folder/a.txt",
                inputs.join("1/a.txt"),
                inputs.join("1/a.txt"),
            ),
            ("2", "new.txt", none.clone(), inputs.join("2/new.txt")),
            ("3", "gone.txt", inputs.join("3/gone.txt"), none.clone()),
        ];
        let mut staged = None;
        for (counter, path, before, after) in steps {
            let launch = group("77", counter, "3", path).unwrap();
            staged = launch.stage(&root, &before, &after).unwrap();
            assert_eq!(staged.is_some(), counter == "3");
            // Git deletes its inputs when each launch returns.
            let _ = fs::remove_dir_all(inputs.join(counter));
        }
        let staged = staged.unwrap();
        let read = |directory: &Path, name: &str| fs::read_to_string(directory.join(name)).ok();
        assert_eq!(
            read(&staged.before, "sub folder/a.txt").as_deref(),
            Some("old a")
        );
        assert_eq!(
            read(&staged.after, "sub folder/a.txt").as_deref(),
            Some("old a")
        );
        assert_eq!(
            read(&staged.before, "new.txt"),
            None,
            "an added file has no before side"
        );
        assert_eq!(read(&staged.after, "new.txt").as_deref(), Some("added"));
        assert_eq!(read(&staged.before, "gone.txt").as_deref(), Some("removed"));
        assert_eq!(
            read(&staged.after, "gone.txt"),
            None,
            "a deleted file has no after side"
        );
        let directory = staged.before.parent().unwrap().to_owned();
        assert!(directory.starts_with(&root));
        staged.finish();
        assert!(
            !directory.exists(),
            "the staging directory is removed once the client exits"
        );
    }

    #[test]
    fn the_first_launch_starts_clean_and_other_runs_stay_apart() {
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path();
        let input = root.join("input.txt");
        fs::write(&input, "text").unwrap();
        let first = |session: &str, path: &str| group(session, "1", "2", path).unwrap();
        first("10", "left.txt").stage(root, &input, &input).unwrap();
        first("11", "right.txt")
            .stage(root, &input, &input)
            .unwrap();
        // A crashed run left a file under the same process id; the next run's first launch drops it.
        first("10", "fresh.txt")
            .stage(root, &input, &input)
            .unwrap();
        let staged = |session: &str, name: &str| {
            root.join(format!("{PREFIX}{session}/after/{name}"))
                .exists()
        };
        assert!(!staged("10", "left.txt"));
        assert!(staged("10", "fresh.txt"));
        assert!(staged("11", "right.txt"));
        assert!(!staged("11", "fresh.txt"));
        // The last launch of a run that lost its first still opens what it has.
        let last = group("12", "2", "2", "only.txt").unwrap();
        assert!(last.stage(root, &input, &input).unwrap().is_some());
    }

    #[test]
    fn only_old_staging_directories_are_pruned() {
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path();
        for name in ["glassbox-difftool-1", "glassbox-difftool-2", "unrelated"] {
            fs::create_dir(root.join(name)).unwrap();
        }
        prune_stale(root, SystemTime::now());
        assert!(
            root.join("glassbox-difftool-1").exists(),
            "a fresh directory stays"
        );
        prune_stale(
            root,
            SystemTime::now() + STALE_AFTER + Duration::from_secs(60),
        );
        assert!(!root.join("glassbox-difftool-1").exists());
        assert!(!root.join("glassbox-difftool-2").exists());
        assert!(
            root.join("unrelated").exists(),
            "only Glassbox staging directories are touched"
        );
        prune_stale(&root.join("absent"), SystemTime::now());
    }
}
