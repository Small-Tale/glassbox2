use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Barrier, mpsc};
use std::time::Duration;

use glassbox_feedback::{BundleContext, BundleStore, CleanupScope};
use glassbox_model::feedback::ReviewFeedback;
use tempfile::tempdir;

fn context(project: Option<&Path>) -> BundleContext {
    BundleContext {
        project: project.map(Path::to_owned),
        comparison: "Working tree".into(),
        before: None,
        after: None,
    }
}

/// What a person expects to see: Windows' `canonicalize` returns `\\?\C:\dir` and the UI shows `C:\dir` (HS2-SX3Q6R).
fn ordinary(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

#[test]
fn listed_projects_use_ordinary_paths_and_clear_by_the_shown_path() {
    let fixture = tempdir().unwrap();
    let project = fixture.path().join("native ev").join("Field Notes repo");
    fs::create_dir_all(&project).unwrap();
    let store = BundleStore::in_directory(fixture.path().join("feedback"));
    let bundle = store
        .create(context(Some(&project)), &ReviewFeedback::default())
        .unwrap();
    drop(bundle);

    let listed = store.usage().unwrap().projects;
    assert_eq!(listed.len(), 1);
    let shown = listed[0].project.clone().unwrap();
    assert!(!shown.to_string_lossy().starts_with(r"\\?\"), "{shown:?}");
    assert_eq!(shown, ordinary(fs::canonicalize(&project).unwrap()));

    let report = store.cleanup(CleanupScope::Project(shown)).unwrap();
    assert_eq!(report.removed_bundles, 1);
    assert_eq!(store.usage().unwrap().bundles, 0);
}

#[test]
fn a_project_folder_that_was_deleted_is_still_listed_and_cleared_by_its_shown_path() {
    let fixture = tempdir().unwrap();
    let project = fixture.path().join("gone project");
    fs::create_dir(&project).unwrap();
    let store = BundleStore::in_directory(fixture.path().join("feedback"));
    drop(
        store
            .create(context(Some(&project)), &ReviewFeedback::default())
            .unwrap(),
    );
    fs::remove_dir(&project).unwrap();

    let listed = store.usage().unwrap().projects;
    assert_eq!(listed.len(), 1);
    let shown = listed[0].project.clone().unwrap();
    assert!(!shown.to_string_lossy().starts_with(r"\\?\"), "{shown:?}");

    let report = store.cleanup(CleanupScope::Project(shown)).unwrap();
    assert_eq!(report.removed_bundles, 1);
    assert_eq!(store.usage().unwrap().bundles, 0);
}

#[test]
fn usage_and_cleanup_route_by_project_and_keep_active_bundles() {
    let fixture = tempdir().unwrap();
    let root = fixture.path().join("feedback");
    let first_project = fixture.path().join("first project");
    let second_project = fixture.path().join("second project");
    for path in [&first_project, &second_project] {
        fs::create_dir(path).unwrap();
    }
    let store = BundleStore::in_directory(&root);
    assert_eq!(store.usage().unwrap().bytes, 0);
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().removed_bundles, 0);
    let state = ReviewFeedback::default();
    let open = store.create(context(Some(&first_project)), &state).unwrap();
    let idle = store.create(context(Some(&first_project)), &state).unwrap();
    let other = store
        .create(context(Some(&second_project)), &state)
        .unwrap();
    let unassigned = store.create(context(None), &state).unwrap();

    let idle_path = idle.path();
    let other_path = other.path();
    let unassigned_path = unassigned.path();
    drop((idle, other, unassigned));
    let foreign = root.join("review-unrelated");
    fs::create_dir(&foreign).unwrap();
    fs::write(foreign.join("review.md"), "Keep this file").unwrap();

    let usage = store.usage().unwrap();
    assert_eq!(usage.bundles, 4);
    assert_eq!(usage.projects.len(), 3);
    assert_eq!(
        usage.bytes,
        usage
            .projects
            .iter()
            .map(|project| project.bytes)
            .sum::<u64>()
    );
    assert_eq!(
        usage
            .projects
            .iter()
            .find(|project| project.project
                == Some(ordinary(fs::canonicalize(&first_project).unwrap())))
            .unwrap()
            .bundles,
        2
    );

    let report = store.cleanup(CleanupScope::Project(first_project)).unwrap();
    assert_eq!((report.removed_bundles, report.active_bundles), (1, 1));
    assert!(report.reclaimed_bytes > 0);
    assert!(report.problems.is_empty());
    assert!(!idle_path.exists());
    assert!(other_path.is_file());
    assert!(unassigned_path.is_file());
    assert!(open.path().is_file());
    open.publish(&state).unwrap();

    let path = open.path();
    drop(open);
    let report = store.cleanup(CleanupScope::All).unwrap();
    assert_eq!((report.removed_bundles, report.active_bundles), (3, 0));
    assert!(!path.exists());
    assert!(foreign.join("review.md").is_file());
    assert_eq!(store.usage().unwrap().bundles, 0);
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().removed_bundles, 0);
}

#[test]
fn concurrent_cleanups_remove_each_idle_bundle_exactly_once() {
    let fixture = tempdir().unwrap();
    let root = fixture.path().join("feedback");
    let store = BundleStore::in_directory(&root);
    for _ in 0..8 {
        store
            .create(context(None), &ReviewFeedback::default())
            .unwrap();
    }
    let barrier = Barrier::new(2);
    std::thread::scope(|scope| {
        let cleanup = || {
            barrier.wait();
            store.cleanup(CleanupScope::All).unwrap()
        };
        let first = scope.spawn(cleanup);
        let second = scope.spawn(cleanup);
        let total = first.join().unwrap().removed_bundles + second.join().unwrap().removed_bundles;
        assert_eq!(total, 8);
    });
    assert_eq!(store.usage().unwrap().bundles, 0);
}

#[test]
fn project_cleanup_resumes_retirement_after_the_copied_path_is_invalidated() {
    let fixture = tempdir().unwrap();
    let root = fixture.path().join("feedback");
    let project = fixture.path().join("project");
    fs::create_dir(&project).unwrap();
    let store = BundleStore::in_directory(root);
    let bundle = store
        .create(context(Some(&project)), &ReviewFeedback::default())
        .unwrap();
    let path = bundle.path();
    let directory = path.parent().unwrap();
    let attachments = directory.join("attachments");
    fs::write(attachments.join("remaining-evidence"), [1, 2, 3]).unwrap();
    drop(bundle);

    fs::rename(&path, directory.join(".deleting-review.md")).unwrap();
    assert!(!path.exists());
    assert_eq!(store.usage().unwrap().bundles, 1);
    let report = store.cleanup(CleanupScope::Project(project)).unwrap();
    assert_eq!(report.removed_bundles, 1);
    assert!(report.problems.is_empty());
    assert!(!directory.exists());
    assert_eq!(store.usage().unwrap().bundles, 0);
}

#[cfg(unix)]
#[test]
fn usage_and_cleanup_never_follow_unrelated_symlinks() {
    let fixture = tempdir().unwrap();
    let root = fixture.path().join("feedback");
    let outside = fixture.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("valuable.txt"), vec![0; 10_000]).unwrap();
    let store = BundleStore::in_directory(&root);
    let bundle = store
        .create(context(None), &ReviewFeedback::default())
        .unwrap();
    let bundle_path = bundle.path();
    std::os::unix::fs::symlink(&outside, bundle_path.parent().unwrap().join("external")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("review-external")).unwrap();
    drop(bundle);

    let usage = store.usage().unwrap();
    assert!(usage.bytes < 10_000);
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().removed_bundles, 1);
    assert!(outside.join("valuable.txt").is_file());
}

const CHILD_ROOT: &str = "GLASSBOX_STORAGE_TEST_CHILD_ROOT";
const CHILD_MARKER: &str = "GLASSBOX_STORAGE_TEST_BUNDLE=";

#[test]
fn child_holds_a_bundle_lease() {
    let Some(root) = std::env::var_os(CHILD_ROOT) else {
        return;
    };
    let store = BundleStore::in_directory(PathBuf::from(root));
    let bundle = store
        .create(context(None), &ReviewFeedback::default())
        .unwrap();
    println!("{CHILD_MARKER}{}", bundle.path().display());
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).unwrap();
    drop(bundle);
}

struct Writer(Child);
impl Drop for Writer {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn cleanup_skips_another_process_until_its_writer_exits() {
    let fixture = tempdir().unwrap();
    let root = fixture.path().join("feedback");
    let mut writer = Writer(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "child_holds_a_bundle_lease", "--nocapture"])
            .env(CHILD_ROOT, &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );

    let stdout = writer.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let path = BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
            .find_map(|line| {
                line.split_once(CHILD_MARKER)
                    .map(|(_, path)| PathBuf::from(path))
            });
        let _ = sender.send(path);
    });
    let feedback = receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    let store = BundleStore::in_directory(&root);
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().active_bundles, 1);
    assert!(feedback.is_file());
    writer.0.kill().unwrap();
    writer.0.wait().unwrap();
    assert_eq!(store.cleanup(CleanupScope::All).unwrap().removed_bundles, 1);
    assert!(!feedback.exists());
}
