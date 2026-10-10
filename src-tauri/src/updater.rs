//! The in-app updater's configuration: the endpoints and public key in `updater.json`, compiled
//! into the binary. With no public key the updater and process plugins stay unregistered and the
//! UI reports that updates are not configured.

use serde::{Deserialize, Serialize};
use tauri::{Runtime, Url};

/// `updater.json` as it was when this binary was built.
const BUNDLED: &str = include_str!("../updater.json");

/// The update endpoints and the public key update signatures are checked against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdaterConfig {
    endpoints: Vec<Url>,
    pubkey: String,
}

/// `updater.json` as written: both fields optional, so `{}` reads as not configured.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdaterFile {
    #[serde(default)]
    endpoints: Vec<String>,
    #[serde(default)]
    pubkey: String,
}

impl UpdaterConfig {
    /// Reads `updater.json`: `Ok(None)` when the public key is empty, an error when the file is
    /// malformed or a key comes without any valid endpoint.
    pub(crate) fn parse(raw: &str) -> Result<Option<Self>, String> {
        let file: UpdaterFile =
            serde_json::from_str(raw).map_err(|e| format!("updater.json: {e}"))?;
        let pubkey = file.pubkey.trim().to_string();
        if pubkey.is_empty() {
            return Ok(None);
        }
        if file.endpoints.is_empty() {
            return Err("updater.json: a public key needs at least one endpoint".to_string());
        }
        let endpoints = file
            .endpoints
            .iter()
            .map(|e| Url::parse(e).map_err(|err| format!("updater.json: endpoint {e:?}: {err}")))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(Self { endpoints, pubkey }))
    }

    /// The configuration compiled into this binary; a malformed file is logged and read as not
    /// configured, so the app still starts.
    pub(crate) fn bundled() -> Option<Self> {
        match Self::parse(BUNDLED) {
            Ok(config) => config,
            Err(e) => {
                log::warn!("[updater] updates disabled: {e}");
                None
            }
        }
    }

    /// The updater plugin's configuration, in the shape `plugins.updater` takes in tauri.conf.json.
    fn plugin_config(&self) -> serde_json::Value {
        serde_json::json!({
            "endpoints": self.endpoints.iter().map(Url::as_str).collect::<Vec<_>>(),
            "pubkey": self.pubkey,
        })
    }
}

/// What `updater_status` reports to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct UpdaterStatus {
    configured: bool,
}

impl UpdaterStatus {
    pub(crate) fn of(config: Option<&UpdaterConfig>) -> Self {
        Self {
            configured: config.is_some(),
        }
    }
}

/// Registers the updater and process plugins when `config` is set, putting the endpoints and
/// key into the context's plugin configuration, which is where the updater plugin reads them.
pub(crate) fn register<R: Runtime>(
    builder: tauri::Builder<R>,
    context: &mut tauri::Context<R>,
    config: Option<&UpdaterConfig>,
) -> tauri::Builder<R> {
    let Some(config) = config else {
        return builder;
    };
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".to_string(), config.plugin_config());
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
}

/// Whether this build checks for updates.
#[tauri::command]
pub(crate) fn updater_status(status: tauri::State<'_, UpdaterStatus>) -> UpdaterStatus {
    *status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_committed_file_is_not_configured() {
        assert_eq!(UpdaterConfig::parse(BUNDLED), Ok(None));
    }

    #[test]
    fn an_empty_key_is_not_configured_even_with_endpoints() {
        let raw = r#"{"endpoints": ["https://updates.example/latest.json"], "pubkey": "  "}"#;
        assert_eq!(UpdaterConfig::parse(raw), Ok(None));
        assert_eq!(UpdaterConfig::parse("{}"), Ok(None));
    }

    #[test]
    fn a_key_with_endpoints_is_configured() {
        let raw =
            r#"{"endpoints": ["https://updates.example/{{target}}/latest.json"], "pubkey": "KEY"}"#;
        let config = UpdaterConfig::parse(raw).unwrap().unwrap();
        assert_eq!(config.pubkey, "KEY");
        assert_eq!(
            config.plugin_config(),
            serde_json::json!({
                "endpoints": ["https://updates.example/%7B%7Btarget%7D%7D/latest.json"],
                "pubkey": "KEY",
            })
        );
        assert!(UpdaterStatus::of(Some(&config)).configured);
        assert!(!UpdaterStatus::of(None).configured);
    }

    #[test]
    fn the_plugin_reads_the_injected_configuration() {
        let raw =
            r#"{"endpoints": ["https://updates.example/{{target}}/latest.json"], "pubkey": "KEY"}"#;
        let config = UpdaterConfig::parse(raw).unwrap().unwrap();
        let plugin: tauri_plugin_updater::Config =
            serde_json::from_value(config.plugin_config()).unwrap();
        assert_eq!(plugin.pubkey, "KEY");
        assert_eq!(plugin.endpoints, config.endpoints);
    }

    #[test]
    fn a_key_without_endpoints_is_an_error() {
        let raw = r#"{"endpoints": [], "pubkey": "KEY"}"#;
        assert!(UpdaterConfig::parse(raw).is_err());
    }

    #[test]
    fn a_bad_endpoint_or_field_is_an_error() {
        assert!(UpdaterConfig::parse(r#"{"endpoints": ["not a url"], "pubkey": "KEY"}"#).is_err());
        assert!(UpdaterConfig::parse(r#"{"endpoint": [], "pubkey": ""}"#).is_err());
        assert!(UpdaterConfig::parse("not json").is_err());
    }
}
