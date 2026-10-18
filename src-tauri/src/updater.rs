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

    /// The configuration compiled into this binary. A malformed file reads as not configured, so
    /// the app still starts, and comes with the warning to log once the logger is installed.
    pub(crate) fn bundled() -> (Option<Self>, Option<DeferredWarning>) {
        Self::read(BUNDLED)
    }

    /// Reads `raw` as `parse` does, turning an error into a deferred warning and no configuration.
    fn read(raw: &str) -> (Option<Self>, Option<DeferredWarning>) {
        match Self::parse(raw) {
            Ok(config) => (config, None),
            Err(e) => (
                None,
                Some(DeferredWarning(format!("[updater] updates disabled: {e}"))),
            ),
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

/// A start-up warning held until the log plugin's logger is installed: the updater configuration
/// is read before the log plugin is added to the builder, when a log call would be dropped.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DeferredWarning(String);

impl DeferredWarning {
    /// Logs the warning; called from the setup hook, which runs after plugins are initialized.
    pub(crate) fn emit(self) {
        log::warn!("{}", self.0);
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

    /// The log records written from the current thread, installing the capturing logger on first
    /// use.
    fn captured_on_this_thread() -> Vec<(log::Level, String)> {
        use std::sync::{Mutex, OnceLock};
        use std::thread::ThreadId;

        /// A logger keeping each record with the thread that wrote it, so tests running in
        /// parallel only see their own records.
        struct ThreadLogger(Mutex<Vec<(ThreadId, log::Level, String)>>);

        impl log::Log for ThreadLogger {
            fn enabled(&self, _: &log::Metadata<'_>) -> bool {
                true
            }
            fn log(&self, record: &log::Record<'_>) {
                self.0.lock().unwrap().push((
                    std::thread::current().id(),
                    record.level(),
                    record.args().to_string(),
                ));
            }
            fn flush(&self) {}
        }

        static LOGGER: OnceLock<&'static ThreadLogger> = OnceLock::new();
        let logger = LOGGER.get_or_init(|| {
            let logger: &'static ThreadLogger =
                Box::leak(Box::new(ThreadLogger(Mutex::new(Vec::new()))));
            log::set_logger(logger).expect("no other logger is installed in unit tests");
            log::set_max_level(log::LevelFilter::Trace);
            logger
        });
        let me = std::thread::current().id();
        logger
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|(thread, _, _)| *thread == me)
            .map(|(_, level, message)| (*level, message.clone()))
            .collect()
    }

    #[test]
    fn an_unusable_file_defers_its_warning_until_emitted() {
        let expected =
            "[updater] updates disabled: updater.json: a public key needs at least one endpoint";
        assert!(captured_on_this_thread().is_empty());
        let (config, warning) = UpdaterConfig::read(r#"{"endpoints": [], "pubkey": "KEY"}"#);
        assert_eq!(config, None);
        assert_eq!(warning, Some(DeferredWarning(expected.to_string())));
        assert!(captured_on_this_thread().is_empty());

        warning.unwrap().emit();
        assert_eq!(
            captured_on_this_thread(),
            vec![(log::Level::Warn, expected.to_string())]
        );
    }

    #[test]
    fn a_usable_or_absent_configuration_has_no_warning() {
        assert_eq!(UpdaterConfig::read(BUNDLED), (None, None));
        let raw = r#"{"endpoints": ["https://updates.example/latest.json"], "pubkey": "KEY"}"#;
        let (config, warning) = UpdaterConfig::read(raw);
        assert!(config.is_some());
        assert_eq!(warning, None);
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
