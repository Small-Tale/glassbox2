use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplicationSettings {
    #[serde(default)]
    pub appearance: Appearance,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_follows_system_by_default() {
        assert_eq!(
            serde_json::from_str::<ApplicationSettings>("{}").unwrap(),
            ApplicationSettings::default()
        );
    }

    #[test]
    fn all_appearance_values_have_stable_wire_names() {
        for (appearance, wire_name) in [
            (Appearance::System, "system"),
            (Appearance::Light, "light"),
            (Appearance::Dark, "dark"),
        ] {
            let settings = ApplicationSettings { appearance };
            let wire = serde_json::to_value(settings).unwrap();
            assert_eq!(wire, serde_json::json!({ "appearance": wire_name }));
            assert_eq!(
                serde_json::from_value::<ApplicationSettings>(wire).unwrap(),
                settings
            );
        }
    }
}
