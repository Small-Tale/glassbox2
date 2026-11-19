use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use glassbox_comparison::{GitChange, GitReviewMode, review_git};
use tempfile::{TempDir, tempdir};

struct Repository(TempDir);

impl Repository {
    fn new() -> Self {
        let repository = Self(tempdir().unwrap());
        repository.git(["init", "-q", "-b", "main"]);
        repository.git(["config", "user.name", "Glassbox Test"]);
        repository.git(["config", "user.email", "glassbox@example.test"]);
        repository.git(["config", "core.autocrlf", "false"]);
        repository
    }

    fn path(&self) -> &Path {
        self.0.path()
    }

    fn write(&self, path: &str, contents: &str) {
        fs::write(self.path().join(path), contents).unwrap();
    }

    fn git(&self, args: impl IntoIterator<Item = impl AsRef<OsStr>>) -> String {
        let output = Command::new("git")
            .current_dir(self.path())
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    fn commit(&self, message: &str) -> String {
        self.git(["add", "-A"]);
        self.git(["commit", "-q", "-m", message]);
        self.git(["rev-parse", "HEAD"]).trim().to_owned()
    }
}

#[test]
fn separates_index_worktree_and_untracked_changes() {
    let repo = Repository::new();
    repo.write(".gitignore", "*.ignored\n");
    repo.write("tracked.txt", "base\n");
    repo.commit("Initial");
    repo.write("tracked.txt", "staged\n");
    repo.git(["add", "tracked.txt"]);
    repo.write("tracked.txt", "unstaged\n");
    repo.write("new file.txt", "untracked\n");
    repo.write("local.ignored", "ignore\n");

    let staged = review_git(repo.path(), GitReviewMode::Staged).unwrap();
    assert_eq!(staged.changes.len(), 1);
    assert!(staged.patch.windows(7).any(|part| part == b"+staged"));

    let unstaged = review_git(repo.path(), GitReviewMode::Unstaged).unwrap();
    assert_eq!(unstaged.changes.len(), 1);
    assert!(unstaged.patch.windows(9).any(|part| part == b"+unstaged"));

    let working = review_git(repo.path(), GitReviewMode::WorkingTree).unwrap();
    assert_eq!(working.changes.len(), 2);
    assert_eq!(working.changes[1].change, GitChange::Added);
    assert_eq!(
        working.changes[1].after_path,
        Some(PathBuf::from("new file.txt"))
    );
    assert!(working.patch.windows(10).any(|part| part == b"+untracked"));

    let filtered = review_git(
        repo.path(),
        GitReviewMode::Paths(&[Path::new("new file.txt")]),
    )
    .unwrap();
    assert_eq!(filtered.changes, [working.changes[1].clone()]);
}

#[test]
fn root_commit_range_and_branch_reviews_preserve_rename_sides() {
    let repo = Repository::new();
    repo.write("old name.txt", "rename unchanged content\n");
    let before = repo.commit("Initial");
    repo.git(["branch", "review-base"]);
    repo.git(["mv", "old name.txt", "new name.txt"]);
    let after = repo.commit("Rename");

    let initial = review_git(repo.path(), GitReviewMode::Commit(&before)).unwrap();
    assert_eq!(initial.changes[0].change, GitChange::Added);

    let tip = review_git(repo.path(), GitReviewMode::Commit(&after)).unwrap();
    assert_eq!(tip.changes[0].change, GitChange::Renamed);
    assert_eq!(
        tip.changes[0].before_path.as_deref(),
        Some(Path::new("old name.txt"))
    );
    assert_eq!(
        tip.changes[0].after_path.as_deref(),
        Some(Path::new("new name.txt"))
    );

    let range = review_git(
        repo.path(),
        GitReviewMode::Range {
            before: &before,
            after: &after,
        },
    )
    .unwrap();
    let branch = review_git(repo.path(), GitReviewMode::Branch("review-base")).unwrap();
    assert_eq!(tip.changes, range.changes);
    assert_eq!(range, branch);
    assert!(review_git(repo.path(), GitReviewMode::Commit("--help")).is_err());
}

#[test]
fn an_unborn_repository_reports_staged_and_untracked_files() {
    let repo = Repository::new();
    repo.write("first.txt", "index\n");
    repo.git(["add", "first.txt"]);
    repo.write("second.txt", "worktree\n");
    let staged = review_git(repo.path(), GitReviewMode::Staged).unwrap();
    assert_eq!(staged.changes.len(), 1);
    let working = review_git(repo.path(), GitReviewMode::WorkingTree).unwrap();
    assert_eq!(working.changes.len(), 2);
    assert!(
        working
            .changes
            .iter()
            .all(|change| change.change == GitChange::Added)
    );
}

#[test]
fn nested_launch_discovers_the_root_and_keeps_relative_paths() {
    let repo = Repository::new();
    fs::create_dir(repo.path().join("sub folder")).unwrap();
    repo.write("sub folder/file.txt", "base\n");
    repo.commit("Initial");
    repo.write("sub folder/file.txt", "updated\n");

    let review = review_git(&repo.path().join("sub folder"), GitReviewMode::WorkingTree).unwrap();
    assert_eq!(
        review.root.canonicalize().unwrap(),
        repo.path().canonicalize().unwrap()
    );
    assert_eq!(
        review.changes[0].after_path,
        Some(Path::new("sub folder").join("file.txt"))
    );
}
