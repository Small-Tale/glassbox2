use std::fs;
use std::sync::Barrier;
use std::thread;

use glassbox_model::{Appearance, ApplicationSettings};
use glassbox_settings::{AnalysisPreferences, GuidanceTopic, SettingsError, SettingsStore};
use serde_json::Value;
use tempfile::tempdir;

#[test]
fn an_absent_file_defaults_to_system_and_the_next_client_reads_an_override() {
    let directory = tempdir().unwrap();
    let settings_dir = directory.path().join("glassbox");
    let store = SettingsStore::in_directory(&settings_dir);
    assert_eq!(store.load().unwrap(), ApplicationSettings::default());
    assert!(!settings_dir.exists());

    let dark = ApplicationSettings {
        appearance: Appearance::Dark,
    };
    store.save(dark).unwrap();
    assert_eq!(
        SettingsStore::in_directory(&settings_dir).load().unwrap(),
        dark
    );
}

#[test]
fn an_unversioned_document_preserves_other_fields_when_upgraded() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("settings.json");
    fs::write(
        &path,
        r#"{"appearance":"light","plugin_options":{"enabled":true}}"#,
    )
    .unwrap();
    let store = SettingsStore::in_directory(directory.path());
    assert_eq!(store.load().unwrap().appearance, Appearance::Light);
    store.save(ApplicationSettings::default()).unwrap();

    let stored: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(stored["version"], 1);
    assert_eq!(stored["appearance"], "system");
    assert_eq!(stored["plugin_options"]["enabled"], true);
}

#[test]
fn analysis_preferences_distinguish_launch_defaults_from_explicitly_disabled() {
    let directory = tempdir().unwrap();
    let store = SettingsStore::in_directory(directory.path());
    assert_eq!(store.load_analysis().unwrap(), None);
    let configured = AnalysisPreferences {
        provider: Some("fixture".into()),
        model: Some("model".into()),
        guidance_topics: [GuidanceTopic::Testing].into(),
    };
    store.save_analysis(configured.clone()).unwrap();
    store
        .save(ApplicationSettings {
            appearance: Appearance::Dark,
        })
        .unwrap();
    assert_eq!(store.load_analysis().unwrap(), Some(configured));
    store.save_analysis(AnalysisPreferences::default()).unwrap();
    assert_eq!(
        store.load_analysis().unwrap(),
        Some(AnalysisPreferences::default())
    );
    assert_eq!(store.load().unwrap().appearance, Appearance::Dark);
}

#[test]
fn malformed_and_future_documents_remain_untouched() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let store = SettingsStore::in_directory(directory.path());

    for contents in ["{", r#"{"appearance":"unknown"}"#, r#"{"version":2}"#] {
        fs::write(&path, contents).unwrap();
        let error = store.load().unwrap_err();
        if contents.contains("version") {
            assert!(matches!(error, SettingsError::UnsupportedVersion(2)));
        } else {
            assert!(matches!(error, SettingsError::Json(_)));
        }
        assert!(store.save(ApplicationSettings::default()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), contents);
    }
}

#[test]
fn concurrent_saves_publish_only_complete_snapshots() {
    let directory = tempdir().unwrap();
    let store = SettingsStore::in_directory(directory.path());
    store.save(ApplicationSettings::default()).unwrap();
    let barrier = Barrier::new(3);
    thread::scope(|scope| {
        for appearance in [Appearance::Light, Appearance::Dark] {
            let directory = directory.path();
            let barrier = &barrier;
            scope.spawn(move || {
                let writer = SettingsStore::in_directory(directory);
                barrier.wait();
                for _ in 0..20 {
                    writer.save(ApplicationSettings { appearance }).unwrap();
                }
            });
        }
        barrier.wait();
        for _ in 0..100 {
            store.load().expect("every observed snapshot is valid");
        }
    });
    assert!(matches!(
        store.load().unwrap().appearance,
        Appearance::Light | Appearance::Dark
    ));
    let mut entries: Vec<_> = fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    entries.sort();
    assert_eq!(entries, [".settings.lock", "settings.json"]);
}

#[test]
fn reviewed_files_are_kept_per_comparison_and_leave_other_settings_alone() {
    // HS2-FTEQVQ: marks belong to one comparison identity and share the document safely.
    let directory = tempdir().unwrap();
    let store = SettingsStore::in_directory(directory.path());
    assert!(store.load_reviewed("one").unwrap().is_empty());
    assert!(!directory.path().join("settings.json").exists());

    store
        .save(ApplicationSettings {
            appearance: Appearance::Dark,
        })
        .unwrap();
    store.set_reviewed("one", "src/a.rs", Some("r1")).unwrap();
    store.set_reviewed("one", "src/b.rs", Some("r2")).unwrap();
    store.set_reviewed("two", "src/a.rs", Some("r9")).unwrap();
    assert_eq!(store.load_reviewed("one").unwrap().len(), 2);
    assert_eq!(store.load_reviewed("one").unwrap()["src/a.rs"], "r1");
    assert_eq!(store.load_reviewed("two").unwrap()["src/a.rs"], "r9");
    assert_eq!(store.load().unwrap().appearance, Appearance::Dark);

    store.set_reviewed("one", "src/a.rs", Some("r3")).unwrap();
    assert_eq!(store.load_reviewed("one").unwrap()["src/a.rs"], "r3");
    store.set_reviewed("one", "src/a.rs", None).unwrap();
    store.set_reviewed("one", "never-marked.rs", None).unwrap();
    assert_eq!(
        store
            .load_reviewed("one")
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        ["src/b.rs"]
    );

    store.set_reviewed("one", "src/b.rs", None).unwrap();
    store.set_reviewed("two", "src/a.rs", None).unwrap();
    let document: Value =
        serde_json::from_slice(&fs::read(directory.path().join("settings.json")).unwrap()).unwrap();
    assert!(
        document.get("reviewProgress").is_none(),
        "an empty record is not kept"
    );
    assert_eq!(document["appearance"], "dark");
}

#[test]
fn a_malformed_progress_record_is_reported_and_not_overwritten() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let original = r#"{"version":1,"reviewProgress":["not","a","map"]}"#;
    fs::write(&path, original).unwrap();
    let store = SettingsStore::in_directory(directory.path());
    assert!(store.load_reviewed("one").is_err());
    assert!(store.set_reviewed("one", "a.rs", Some("r1")).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
}
