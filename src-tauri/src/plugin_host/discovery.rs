use crate::plugin_host::manifest::{ManifestError, PluginManifest};
use crate::plugin_host::simple_manifest;
use crate::plugin_host::validation::validate_plugin_manifest;
use std::path::{Path, PathBuf};

pub const MANIFEST_FILE: &str = "rim-plugin.json";

pub fn plugins_dir() -> PathBuf {
    dirs::home_dir()
        .expect("home directory must be resolvable")
        .join(".rim")
        .join("plugins")
}

pub struct DiscoveredPlugin {
    pub manifest: PluginManifest,
    pub plugin_dir: PathBuf,
}

pub fn discover_plugins(
    plugins_dir: &Path,
) -> Vec<Result<DiscoveredPlugin, (PathBuf, ManifestError)>> {
    let mut results = Vec::new();

    let entries = match std::fs::read_dir(plugins_dir) {
        Ok(entries) => entries,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        // No plugin id starts with '.': these are the trash and install staging.
        if entry.file_name().as_encoded_bytes().starts_with(b".") {
            continue;
        }
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join(MANIFEST_FILE);
        if manifest_path.exists() {
            match PluginManifest::load(&manifest_path) {
                Ok(manifest) => {
                    if let Err(e) = validate_plugin_manifest(&manifest) {
                        // Log and skip: a manifest written directly to disk after install
                        // may have been tampered with, so it never reaches the caches.
                        log::warn!(
                            "[AUDIT] event=plugin_discovery_rejected plugin_id={} path={} reason={}",
                            manifest.plugin_id,
                            path.display(),
                            e
                        );
                    } else {
                        results.push(Ok(DiscoveredPlugin {
                            manifest,
                            plugin_dir: path,
                        }));
                    }
                }
                Err(e) => results.push(Err((path, e))),
            }
        } else {
            // Try simple mode entrypoint
            match simple_manifest::load_simple_manifest(&path) {
                Ok(Some(manifest)) => {
                    if let Err(e) = validate_plugin_manifest(&manifest) {
                        log::warn!(
                            "[AUDIT] event=plugin_discovery_rejected plugin_id={} path={} reason={}",
                            manifest.plugin_id,
                            path.display(),
                            e
                        );
                    } else {
                        results.push(Ok(DiscoveredPlugin {
                            manifest,
                            plugin_dir: path,
                        }));
                    }
                }
                Ok(None) => {} // No manifest found, skip
                Err(e) => results.push(Err((path, e))),
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_manifest(dir: &Path, plugin_id: &str) {
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": plugin_id,
            "display_name": "Test Plugin",
            "version": "1.0.0",
            "description": "A test plugin",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
            "capabilities": [],
            "commands": [],
            "keybind_suggestions": [],
            "context_actions": [],
            "panels": [],
            "settings_schema": []
        });
        std::fs::write(dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();
    }

    #[test]
    fn discovers_valid_plugin() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.hello");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        write_manifest(&plugin_dir, "dev.example.hello");

        let results = discover_plugins(tmp.path());
        assert_eq!(results.len(), 1);
        assert!(results[0].is_ok());
        let discovered = results[0].as_ref().unwrap();
        assert_eq!(discovered.manifest.plugin_id, "dev.example.hello");
    }

    #[test]
    fn skips_dirs_without_manifest() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("no-manifest");
        std::fs::create_dir_all(&plugin_dir).unwrap();

        let results = discover_plugins(tmp.path());
        assert!(results.is_empty());
    }

    #[test]
    fn skips_dot_entries_and_what_is_inside_them() {
        let tmp = TempDir::new().unwrap();
        let trash = tmp.path().join(".trash");
        let trashed = trash.join("dev.example.hello-0190");
        std::fs::create_dir_all(&trashed).unwrap();
        write_manifest(&trash, "dev.example.trash");
        write_manifest(&trashed, "dev.example.hello");
        let hidden = tmp.path().join(".dev.example.hidden");
        std::fs::create_dir_all(&hidden).unwrap();
        write_manifest(&hidden, "dev.example.hidden");

        assert!(discover_plugins(tmp.path()).is_empty());
    }

    #[test]
    fn missing_plugins_dir() {
        let results = discover_plugins(Path::new("/tmp/nonexistent_rim_plugins_dir"));
        assert!(results.is_empty());
    }

    // ── boot-time discovery runs install validation ──

    #[test]
    fn discovery_rejects_tampered_manifest_with_invalid_capability() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.tampered");
        std::fs::create_dir_all(&plugin_dir).unwrap();

        // A manifest with a capability key in a reserved namespace, as if its
        // rim-plugin.json had been written directly to disk after install.
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": "dev.example.tampered",
            "display_name": "Tampered",
            "version": "1.0.0",
            "description": "malicious",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
            "capabilities": ["system.evil"]
        });
        std::fs::write(plugin_dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();

        // Also write a valid plugin to confirm clean ones still load.
        let valid_dir = tmp.path().join("dev.example.valid");
        std::fs::create_dir_all(&valid_dir).unwrap();
        write_manifest(&valid_dir, "dev.example.valid");

        let results = discover_plugins(tmp.path());

        // Only the valid plugin is returned; the tampered one is logged and skipped.
        assert_eq!(
            results.len(),
            1,
            "only the valid plugin should be in results"
        );
        let ok = results[0].as_ref().unwrap();
        assert_eq!(ok.manifest.plugin_id, "dev.example.valid");
    }
}
