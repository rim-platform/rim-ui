#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::RwLock;

/// Maps iframe instances to their owning plugin and panel.
/// Used for routing UI events from iframes back to the correct plugin process.
pub struct PanelRegistry {
    /// iframe_id -> (plugin_id, panel_id)
    iframes: RwLock<HashMap<String, (String, String)>>,
}

impl PanelRegistry {
    pub fn new() -> Self {
        Self {
            iframes: RwLock::new(HashMap::new()),
        }
    }

    /// Register an iframe as belonging to a plugin's panel.
    /// Called when the frontend mounts the iframe.
    pub fn register(
        &self,
        iframe_id: &str,
        plugin_id: &str,
        panel_id: &str,
    ) -> Result<(), String> {
        let mut iframes = self.iframes.write().map_err(|e| e.to_string())?;
        iframes.insert(
            iframe_id.to_string(),
            (plugin_id.to_string(), panel_id.to_string()),
        );
        log::info!(
            "panel_registry: registered iframe={} -> plugin={} panel={}",
            iframe_id,
            plugin_id,
            panel_id
        );
        Ok(())
    }

    /// Look up the plugin and panel for an iframe.
    /// Used to route postMessage events from the iframe source.
    pub fn lookup(&self, iframe_id: &str) -> Result<Option<(String, String)>, String> {
        let iframes = self.iframes.read().map_err(|e| e.to_string())?;
        Ok(iframes.get(iframe_id).cloned())
    }

    /// Unregister an iframe (on unmount).
    pub fn unregister(&self, iframe_id: &str) -> Result<(), String> {
        let mut iframes = self.iframes.write().map_err(|e| e.to_string())?;
        iframes.remove(iframe_id);
        Ok(())
    }

    /// Unregister all iframes for a plugin (on disable/uninstall).
    pub fn unregister_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let mut iframes = self.iframes.write().map_err(|e| e.to_string())?;
        iframes.retain(|_, (pid, _)| pid != plugin_id);
        Ok(())
    }

    /// Get all iframe_ids for a specific plugin and panel.
    pub fn iframes_for_panel(
        &self,
        plugin_id: &str,
        panel_id: &str,
    ) -> Result<Vec<String>, String> {
        let iframes = self.iframes.read().map_err(|e| e.to_string())?;
        Ok(iframes
            .iter()
            .filter_map(|(iframe_id, (pid, panid))| {
                if pid == plugin_id && panid == panel_id {
                    Some(iframe_id.clone())
                } else {
                    None
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_lookup() {
        let registry = PanelRegistry::new();
        registry
            .register("iframe-1", "dev.example.test", "main")
            .unwrap();

        let result = registry.lookup("iframe-1").unwrap();
        assert_eq!(
            result,
            Some(("dev.example.test".into(), "main".into()))
        );
    }

    #[test]
    fn lookup_nonexistent() {
        let registry = PanelRegistry::new();
        assert!(registry.lookup("nonexistent").unwrap().is_none());
    }

    #[test]
    fn unregister() {
        let registry = PanelRegistry::new();
        registry
            .register("iframe-1", "dev.example.test", "main")
            .unwrap();
        registry.unregister("iframe-1").unwrap();
        assert!(registry.lookup("iframe-1").unwrap().is_none());
    }

    #[test]
    fn unregister_plugin_removes_all() {
        let registry = PanelRegistry::new();
        registry
            .register("iframe-1", "dev.example.test", "panel_a")
            .unwrap();
        registry
            .register("iframe-2", "dev.example.test", "panel_b")
            .unwrap();
        registry
            .register("iframe-3", "dev.example.other", "main")
            .unwrap();

        registry.unregister_plugin("dev.example.test").unwrap();

        assert!(registry.lookup("iframe-1").unwrap().is_none());
        assert!(registry.lookup("iframe-2").unwrap().is_none());
        assert!(registry.lookup("iframe-3").unwrap().is_some());
    }

    #[test]
    fn iframes_for_panel() {
        let registry = PanelRegistry::new();
        registry
            .register("iframe-1", "dev.example.test", "main")
            .unwrap();
        registry
            .register("iframe-2", "dev.example.test", "main")
            .unwrap();
        registry
            .register("iframe-3", "dev.example.test", "other")
            .unwrap();

        let iframes = registry
            .iframes_for_panel("dev.example.test", "main")
            .unwrap();
        assert_eq!(iframes.len(), 2);
        assert!(iframes.contains(&"iframe-1".to_string()));
        assert!(iframes.contains(&"iframe-2".to_string()));
    }
}
