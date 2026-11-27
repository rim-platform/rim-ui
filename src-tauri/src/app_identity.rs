//! The identifier the app runs under: the one in `tauri.conf.json` for release builds, and a
//! separate one for debug builds.

/// The identifier of release builds, as `tauri.conf.json` names it.
pub(crate) const RELEASE_IDENTIFIER: &str = "com.rim.rim-ui";

/// The identifier this build runs under. Debug builds use `com.rim.rim-ui.dev`, so they keep
/// their data, web engine storage and credential store entry apart from the installed app.
pub(crate) const fn identifier() -> &'static str {
    if cfg!(debug_assertions) {
        "com.rim.rim-ui.dev"
    } else {
        RELEASE_IDENTIFIER
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(debug_assertions)]
    fn debug_builds_use_their_own_identifier() {
        assert_eq!(identifier(), format!("{RELEASE_IDENTIFIER}.dev"));
    }

    #[test]
    fn the_release_identifier_is_the_configured_one() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], RELEASE_IDENTIFIER);
    }
}
