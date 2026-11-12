//! What the installer installed, kept in `agents/installed.json` in the app's data directory.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// The file's name in the agents folder.
pub(crate) const FILE_NAME: &str = "installed.json";

/// An installed agent: its preset, version, and the program and arguments it is started with.
/// `installed_at` is in milliseconds since the Unix epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAgent {
    pub(crate) preset_id: String,
    pub(crate) version: String,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) installed_at: i64,
}

/// The file's contents: the version of RIM's Node.js when it is installed, and the agents.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Installed {
    pub(crate) node: Option<String>,
    pub(crate) agents: Vec<InstalledAgent>,
}

impl Installed {
    /// The installed agent of preset `preset_id`.
    pub(crate) fn agent(&self, preset_id: &str) -> Option<&InstalledAgent> {
        self.agents
            .iter()
            .find(|agent| agent.preset_id == preset_id)
    }

    /// Puts `agent` in place of its preset's entry, or adds it.
    pub(crate) fn set_agent(&mut self, agent: InstalledAgent) {
        match self
            .agents
            .iter_mut()
            .find(|entry| entry.preset_id == agent.preset_id)
        {
            Some(entry) => *entry = agent,
            None => self.agents.push(agent),
        }
    }

    /// Takes preset `preset_id`'s entry out.
    pub(crate) fn remove_agent(&mut self, preset_id: &str) {
        self.agents.retain(|agent| agent.preset_id != preset_id);
    }
}

/// Reads the file at `path`, with the warning to log when it was there but not usable. A missing
/// or unusable file is an empty record.
pub(crate) fn read(path: &Path) -> (Installed, Option<String>) {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Installed::default(), None);
        }
        Err(error) => {
            return (
                Installed::default(),
                Some(format!(
                    "{} is not readable, no agent counts as installed: {error}",
                    path.display()
                )),
            );
        }
    };
    match serde_json::from_slice::<Installed>(&raw) {
        Ok(mut installed) => {
            installed
                .agents
                .retain(|agent| super::presets::find(&agent.preset_id).is_some());
            (installed, None)
        }
        Err(error) => (
            Installed::default(),
            Some(format!(
                "{} is not valid, no agent counts as installed: {error}",
                path.display()
            )),
        ),
    }
}

/// Writes `installed` to `path` through a temporary file renamed over it, readable only by this
/// user on Unix.
///
/// # Errors
///
/// A sentence for the page when it could not be written.
pub(crate) fn write(path: &Path, installed: &Installed) -> Result<(), String> {
    let failed = |error: std::io::Error| {
        log::warn!("[agent_installer] cannot write {}: {error}", path.display());
        "The list of installed agents could not be saved.".to_owned()
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(failed)?;
    }
    let raw = serde_json::to_vec_pretty(installed)
        .map_err(|error| failed(std::io::Error::other(error)))?;
    let temporary = path.with_extension("json.tmp");
    crate::agent_runner::write_private(&temporary, &raw)
        .and_then(|()| fs::rename(&temporary, path))
        .map_err(|error| {
            let _ = fs::remove_file(&temporary);
            failed(error)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn agent(preset_id: &str, version: &str) -> InstalledAgent {
        InstalledAgent {
            preset_id: preset_id.into(),
            version: version.into(),
            program: format!("/a/{preset_id}/{version}/x"),
            args: vec!["acp".into()],
            installed_at: 5,
        }
    }

    #[test]
    fn the_record_round_trips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("agents").join(FILE_NAME);
        let mut installed = Installed {
            node: Some("26.13.0".into()),
            agents: Vec::new(),
        };
        installed.set_agent(agent("goose", "1"));
        installed.set_agent(agent("goose", "2"));
        installed.set_agent(agent("opencode", "1"));
        write(&path, &installed).unwrap();
        let (read, warning) = read(&path);
        assert_eq!(warning, None);
        assert_eq!(read, installed);
        assert_eq!(read.agent("goose").unwrap().version, "2");
        let json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["agents"][0]["presetId"], "goose");
        assert_eq!(json["agents"][0]["installedAt"], 5);
        assert_eq!(json["node"], "26.13.0");
    }

    #[test]
    fn a_corrupt_file_is_an_empty_record_with_a_warning() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(FILE_NAME);
        fs::write(&path, "{ nope").unwrap();
        let (read, warning) = read(&path);
        assert_eq!(read, Installed::default());
        assert!(warning.unwrap().contains("is not valid"));
        let (read, warning) = super::read(&dir.path().join("missing.json"));
        assert_eq!(read, Installed::default());
        assert_eq!(warning, None);
    }

    #[test]
    fn unknown_presets_are_dropped() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(FILE_NAME);
        let installed = Installed {
            node: None,
            agents: vec![agent("goose", "1"), agent("nobody", "1")],
        };
        write(&path, &installed).unwrap();
        assert_eq!(read(&path).0.agents, vec![agent("goose", "1")]);
    }
}
