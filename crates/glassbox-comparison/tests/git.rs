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

#[test]
fn historical_media_reads_original_blob_and_ignores_working_tree_changes() {
    use glassbox_comparison::compare_git_content;
    use glassbox_model::ComparisonData;

    let repo = Repository::new();
    let before = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\"/>";
    let after = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\"/>";
    repo.write("illustration.svg", before);
    repo.commit("Initial");
    repo.write("illustration.svg", after);
    let revision = repo.commit("Resize");
    let review = review_git(repo.path(), GitReviewMode::Commit(&revision)).unwrap();
    repo.write("illustration.svg", "working copy");

    let ComparisonData::Media {
        before: old,
        after: new,
    } = compare_git_content(&review, 0).unwrap()
    else {
        panic!("expected original media");
    };
    let old = old.unwrap();
    let new = new.unwrap();
    assert_eq!(old.content_type, "image/svg+xml");
    assert_eq!(new.content_type, "image/svg+xml");
    assert_eq!(old.bytes, before.as_bytes());
    assert_eq!(new.bytes, after.as_bytes());
}

#[test]
fn selected_text_comparison_reads_the_correct_index_and_worktree_sides() {
    use glassbox_comparison::compare_git_content;
    use glassbox_model::ComparisonData;

    let repo = Repository::new();
    repo.write("source.txt", "initial\n");
    repo.commit("Initial");
    repo.write("source.txt", "staged\n");
    repo.git(["add", "source.txt"]);
    repo.write("source.txt", "worktree\n");

    for (mode, old, new) in [
        (GitReviewMode::Staged, "initial", "staged"),
        (GitReviewMode::Unstaged, "staged", "worktree"),
    ] {
        let review = review_git(repo.path(), mode).unwrap();
        let ComparisonData::Text(hunks) = compare_git_content(&review, 0).unwrap() else {
            panic!("expected text hunks");
        };
        assert_eq!(hunks[0].lines[0].text, old);
        assert_eq!(hunks[0].lines[1].text, new);
    }
}

fn lfs_pointer(bytes: &[u8]) -> (String, String) {
    use sha2::{Digest, Sha256};

    let oid = format!("{:x}", Sha256::digest(bytes));
    let pointer = format!(
        "version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {}\n",
        bytes.len(),
    );
    (oid, pointer)
}

fn lfs_cache(cache: &Path, oid: &str, bytes: &[u8]) -> PathBuf {
    let directory = cache.join("objects").join(&oid[0..2]).join(&oid[2..4]);
    fs::create_dir_all(&directory).unwrap();
    let object = directory.join(oid);
    fs::write(&object, bytes).unwrap();
    object
}

#[test]
fn original_git_lfs_bytes_and_ids_are_available_for_historical_and_index_sides() {
    use glassbox_comparison::compare_git_content;
    use glassbox_model::{ComparisonData, LfsObject};

    let repo = Repository::new();
    let first = b"<svg><circle r=\"1\"/></svg>";
    let second = b"<svg><circle r=\"2\"/></svg>";
    let (first_oid, first_pointer) = lfs_pointer(first);
    let (second_oid, second_pointer) = lfs_pointer(second);
    let cache = repo.path().join(".git/lfs");
    lfs_cache(&cache, &first_oid, first);
    lfs_cache(&cache, &second_oid, second);
    repo.write("preview.svg", &first_pointer);
    repo.commit("Initial image");
    repo.write("preview.svg", &second_pointer);
    repo.git(["add", "preview.svg"]);

    let verify = |review: &glassbox_comparison::GitReview| {
        let ComparisonData::Media {
            before: Some(before),
            after: Some(after),
        } = compare_git_content(review, 0).unwrap()
        else {
            panic!("expected original media on both sides");
        };
        assert_eq!(before.bytes, first);
        assert_eq!(before.content_type, "image/svg+xml");
        assert_eq!(
            before.lfs_object,
            Some(LfsObject {
                oid: first_oid.clone(),
                size: first.len() as u64
            })
        );
        assert_eq!(after.bytes, second);
        assert_eq!(
            after.lfs_object,
            Some(LfsObject {
                oid: second_oid.clone(),
                size: second.len() as u64
            })
        );
    };
    verify(&review_git(repo.path(), GitReviewMode::Staged).unwrap());
    let revision = repo.commit("Updated image");
    verify(&review_git(repo.path(), GitReviewMode::Commit(&revision)).unwrap());
    assert_eq!(
        fs::read_to_string(repo.path().join("preview.svg")).unwrap(),
        second_pointer
    );
}

#[test]
fn configured_lfs_cache_distinguishes_missing_and_corrupt_objects() {
    use glassbox_comparison::compare_git_content;
    use glassbox_model::{ComparisonData, LfsUnavailableReason};

    let repo = Repository::new();
    repo.git(["config", "lfs.storage", "custom lfs"]);
    let object = b"original asset";
    let (oid, pointer) = lfs_pointer(object);
    repo.write("asset.png", &pointer);
    let revision = repo.commit("Add binary media");
    let review = review_git(repo.path(), GitReviewMode::Commit(&revision)).unwrap();
    let missing = |expected| {
        let ComparisonData::UnavailableLfs {
            before: None,
            after: Some(after),
        } = compare_git_content(&review, 0).unwrap()
        else {
            panic!("expected a typed unavailable object");
        };
        assert_eq!(after.object.oid, oid);
        assert_eq!(after.object.size, object.len() as u64);
        assert_eq!(after.reason, expected);
    };
    missing(LfsUnavailableReason::Missing);
    let cache = repo.path().join(".git/custom lfs");
    let path = lfs_cache(&cache, &oid, b"tampered asset");
    missing(LfsUnavailableReason::Mismatched);
    fs::write(path, object).unwrap();
    assert!(matches!(
        compare_git_content(&review, 0).unwrap(),
        ComparisonData::Media { before: None, after: Some(asset) } if asset.bytes == object
    ));
}
