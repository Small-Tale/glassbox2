use std::fs;
use std::io;
use std::path::Path;

use glassbox_comparison::compare_paths;
use glassbox_model::{Change, ContentKind};
use tempfile::tempdir;

#[test]
fn compares_two_named_files_outside_a_repository() {
    let directory = tempdir().unwrap();
    let before = directory.path().join("old report.txt");
    let after = directory.path().join("new report.txt");
    fs::write(&before, "old\n").unwrap();
    fs::write(&after, "new\n").unwrap();

    let entries = compare_paths(&before, &after).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].change, Change::Modified);
    let old = entries[0].before.as_ref().unwrap();
    let new = entries[0].after.as_ref().unwrap();
    assert_eq!(old.display_path, Path::new("old report.txt"));
    assert_eq!(new.display_path, Path::new("new report.txt"));
    assert_eq!(old.source_path, before);
    assert_eq!(new.source_path, after);
    assert_eq!(new.kind, ContentKind::Text);

    fs::write(&after, "old\n").unwrap();
    assert!(compare_paths(&before, &after).unwrap().is_empty());
}

#[test]
fn pairs_recursive_paths_exactly_and_reports_binary_additions() {
    let before = tempdir().unwrap();
    let after = tempdir().unwrap();
    for directory in [&before, &after] {
        fs::create_dir(directory.path().join("sub folder")).unwrap();
        fs::write(directory.path().join(".gitignore"), "*").unwrap();
    }
    fs::create_dir(before.path().join("empty directory")).unwrap();
    fs::write(before.path().join("Case.txt"), "same bytes").unwrap();
    fs::write(after.path().join("case.txt"), "same bytes").unwrap();
    fs::write(before.path().join("sub folder").join("same name"), "before").unwrap();
    fs::write(after.path().join("sub folder").join("same name"), "after").unwrap();
    fs::write(after.path().join("payload.dat"), [0, 3, 4]).unwrap();

    let changes = compare_paths(before.path(), after.path()).unwrap();
    assert_eq!(
        changes.iter().map(|entry| entry.change).collect::<Vec<_>>(),
        [
            Change::Deleted,
            Change::Added,
            Change::Added,
            Change::Modified
        ]
    );
    assert_eq!(changes[2].after.as_ref().unwrap().kind, ContentKind::Binary);
    let relative = Path::new("sub folder").join("same name");
    assert_eq!(changes[3].after.as_ref().unwrap().display_path, relative);
}

#[test]
fn both_roots_must_exist_and_have_matching_types() {
    let before = tempdir().unwrap();
    let after = tempdir().unwrap();
    assert!(
        compare_paths(before.path(), after.path())
            .unwrap()
            .is_empty()
    );

    let path = after.path().join("file.txt");
    assert_eq!(
        compare_paths(before.path(), &path).unwrap_err().kind(),
        io::ErrorKind::NotFound
    );
    fs::write(&path, "test").unwrap();
    assert_eq!(
        compare_paths(before.path(), &path).unwrap_err().kind(),
        io::ErrorKind::InvalidInput
    );
}

#[cfg(unix)]
#[test]
fn symlink_targets_are_compared_without_traversing_them() {
    use std::os::unix::fs::symlink;
    let before = tempdir().unwrap();
    let after = tempdir().unwrap();
    symlink(".", before.path().join("loop")).unwrap();
    symlink("missing", after.path().join("loop")).unwrap();

    let changes = compare_paths(before.path(), after.path()).unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].change, Change::Modified);
    assert_eq!(
        changes[0].after.as_ref().unwrap().kind,
        ContentKind::Symlink
    );
}

#[test]
fn direct_comparison_maps_text_hunks_and_loads_diagram_sources() {
    use glassbox_comparison::compare_direct_content;
    use glassbox_model::ComparisonData;

    let before = tempdir().unwrap();
    let after = tempdir().unwrap();
    fs::write(before.path().join("lines.txt"), "same\nold\n").unwrap();
    fs::write(after.path().join("lines.txt"), "same\nnew\n").unwrap();
    fs::write(after.path().join("process.dot"), "digraph { a -> b }").unwrap();
    let changes = compare_paths(before.path(), after.path()).unwrap();

    let ComparisonData::Text(hunks) = compare_direct_content(&changes[0]).unwrap() else {
        panic!("expected text hunks");
    };
    assert_eq!(hunks[0].lines[1].before_line, Some(2));
    assert_eq!(hunks[0].lines[2].after_line, Some(2));
    let ComparisonData::Media {
        before: None,
        after: Some(asset),
    } = compare_direct_content(&changes[1]).unwrap()
    else {
        panic!("expected an added diagram");
    };
    assert_eq!(asset.content_type, "text/plain");
    assert_eq!(asset.bytes, b"digraph { a -> b }");
}
