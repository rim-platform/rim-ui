use serde::{Deserialize, Serialize};
use std::path::Path;

const RESERVED_PREFIXES: &[&str] = &["dev.rim.", "com.rim."];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuntimeKind {
    DesktopLocalProcess,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestCommand {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub keybind_capable: bool,
    #[serde(default)]
    pub dangerous: bool,
    #[serde(default)]
    pub required_context: Vec<String>,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    #[serde(default)]
    pub arguments: Vec<serde_json::Value>,
    /// Opt-in for AI agent exposure. F2 validation rejects ai_callable commands
    /// whose output_schema would leak a plugin_install_id before registration.
    #[serde(default)]
    pub ai_callable: bool,
    /// JSON-Schema-shaped output envelope declaration. None → F2 requires manual review
    /// for ai_callable commands (cannot statically prove absence of install-ID leak).
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeybindSuggestion {
    pub keystroke: String,
    pub command_id: String,
    pub context: String,
    pub preset_args: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextAction {
    pub id: String,
    pub title: String,
    pub command_id: String,
    #[serde(default)]
    pub context_types: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PanelDef {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// Where the shell shows the panel. Left out, it opens next to the tool panel.
    /// Skipped when absent so manifests without it keep their content hash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<PanelSlot>,
}

/// Where the shell shows a plugin panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelSlot {
    /// A narrow column next to the tool panel (the default).
    ToolPanel,
    /// The main area, in place of the conversation.
    MainArea,
}

/// A manifest command as the UI lists it in the palette, the keybind picker
/// and the agent's tools.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommandInfo {
    /// The id in the manifest, e.g. `restart_pod`.
    pub id: String,
    /// `plugin.<plugin_id>.<id>`, the id the palette and keybinds use.
    pub qualified_id: String,
    pub title: String,
    pub description: String,
    pub keybind_capable: bool,
    pub dangerous: bool,
    pub ai_callable: bool,
    pub arguments: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingSchema {
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub value_type: String,
    #[serde(default)]
    pub is_secret: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub manifest_version: i32,
    pub plugin_id: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub runtime_kind: RuntimeKind,
    pub entrypoint: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub commands: Vec<ManifestCommand>,
    #[serde(default)]
    pub keybind_suggestions: Vec<KeybindSuggestion>,
    #[serde(default)]
    pub context_actions: Vec<ContextAction>,
    #[serde(default)]
    pub panels: Vec<PanelDef>,
    #[serde(default)]
    pub settings_schema: Vec<SettingSchema>,
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("failed to read manifest: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to parse manifest: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("validation error: {0}")]
    Validation(String),
}

impl PluginManifest {
    pub fn load(path: &Path) -> Result<Self, ManifestError> {
        let content = std::fs::read_to_string(path)?;
        let manifest: Self = serde_json::from_str(&content)?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.manifest_version != 1 {
            return Err(ManifestError::Validation(format!(
                "unsupported manifest_version: {}",
                self.manifest_version
            )));
        }
        if self.plugin_id.is_empty() {
            return Err(ManifestError::Validation(
                "plugin_id must not be empty".into(),
            ));
        }
        if self.display_name.is_empty() {
            return Err(ManifestError::Validation(
                "display_name must not be empty".into(),
            ));
        }
        if self.version.is_empty() {
            return Err(ManifestError::Validation(
                "version must not be empty".into(),
            ));
        }
        if self.entrypoint.is_empty() {
            return Err(ManifestError::Validation(
                "entrypoint must not be empty".into(),
            ));
        }
        validate_plugin_id(&self.plugin_id)?;

        // Validate keybind_suggestions reference declared commands
        let command_ids: Vec<&str> = self.commands.iter().map(|c| c.id.as_str()).collect();
        for suggestion in &self.keybind_suggestions {
            if !command_ids.contains(&suggestion.command_id.as_str()) {
                return Err(ManifestError::Validation(format!(
                    "keybind_suggestion references undeclared command: '{}'",
                    suggestion.command_id
                )));
            }
        }

        // Validate context_actions reference declared commands
        for action in &self.context_actions {
            if !command_ids.contains(&action.command_id.as_str()) {
                return Err(ManifestError::Validation(format!(
                    "context_action '{}' references undeclared command: '{}'",
                    action.id, action.command_id
                )));
            }
        }

        Ok(())
    }

    /// Get keybind suggestions with fully qualified command IDs (plugin.{plugin_id}.{cmd_id}).
    pub fn qualified_keybind_suggestions(&self) -> Vec<KeybindSuggestion> {
        self.keybind_suggestions
            .iter()
            .map(|s| KeybindSuggestion {
                keystroke: s.keystroke.clone(),
                command_id: format!("plugin.{}.{}", self.plugin_id, s.command_id),
                context: s.context.clone(),
                preset_args: s.preset_args.clone(),
            })
            .collect()
    }

    /// Get context actions with fully qualified command IDs.
    pub fn qualified_context_actions(&self) -> Vec<ContextAction> {
        self.context_actions
            .iter()
            .map(|a| ContextAction {
                id: format!("plugin.{}.{}", self.plugin_id, a.id),
                title: a.title.clone(),
                command_id: format!("plugin.{}.{}", self.plugin_id, a.command_id),
                context_types: a.context_types.clone(),
            })
            .collect()
    }

    /// Every declared command, with its qualified id, for the UI.
    pub fn command_infos(&self) -> Vec<CommandInfo> {
        self.commands
            .iter()
            .map(|c| CommandInfo {
                id: c.id.clone(),
                qualified_id: format!("plugin.{}.{}", self.plugin_id, c.id),
                title: c.title.clone(),
                description: c.description.clone(),
                keybind_capable: c.keybind_capable,
                dangerous: c.dangerous,
                ai_callable: c.ai_callable,
                arguments: c.arguments.clone(),
            })
            .collect()
    }

    pub fn has_reserved_prefix(&self) -> bool {
        RESERVED_PREFIXES
            .iter()
            .any(|prefix| self.plugin_id.starts_with(prefix))
    }

    /// SHA-256 hex of the canonical JSON serialization. Used to detect manifest
    /// drift between installs so the consent gate can demand re-approval when
    /// the ai_callable command set changes.
    pub fn content_hash(&self) -> String {
        use sha2::{Digest, Sha256};
        let json = serde_json::to_string(self).unwrap_or_default();
        hex::encode(Sha256::digest(json.as_bytes()))
    }

    /// Returns the set of ai_callable command IDs declared in this manifest.
    pub fn ai_callable_command_ids(&self) -> Vec<String> {
        self.commands
            .iter()
            .filter(|c| c.ai_callable)
            .map(|c| c.id.clone())
            .collect()
    }
}

fn validate_plugin_id(id: &str) -> Result<(), ManifestError> {
    // Must be reverse-domain: segments separated by dots, each segment non-empty,
    // only alphanumeric and hyphens.
    let segments: Vec<&str> = id.split('.').collect();
    if segments.len() < 3 {
        return Err(ManifestError::Validation(format!(
            "plugin_id must have at least 3 segments (reverse-domain notation): '{id}'"
        )));
    }
    for segment in &segments {
        if segment.is_empty() {
            return Err(ManifestError::Validation(format!(
                "plugin_id contains an empty segment: '{id}'"
            )));
        }
        if !segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(ManifestError::Validation(format!(
                "plugin_id segment contains invalid characters: '{segment}'"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_plugin_id() {
        assert!(validate_plugin_id("dev.example.my-plugin").is_ok());
    }

    #[test]
    fn too_few_segments() {
        assert!(validate_plugin_id("example.plugin").is_err());
    }

    #[test]
    fn empty_segment() {
        assert!(validate_plugin_id("dev..plugin").is_err());
    }

    #[test]
    fn reserved_prefix_detected() {
        let m = PluginManifest {
            manifest_version: 1,
            plugin_id: "dev.rim.core".into(),
            display_name: "Core".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main".into(),
            capabilities: vec![],
            commands: vec![],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        };
        assert!(m.has_reserved_prefix());
    }

    #[test]
    fn non_reserved_prefix() {
        let m = PluginManifest {
            manifest_version: 1,
            plugin_id: "dev.example.tool".into(),
            display_name: "Tool".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main".into(),
            capabilities: vec![],
            commands: vec![],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        };
        assert!(!m.has_reserved_prefix());
    }

    fn manifest_with_commands() -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            plugin_id: "dev.example.tool".into(),
            display_name: "Tool".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main".into(),
            capabilities: vec![],
            commands: vec![
                ManifestCommand {
                    id: "do_thing".into(),
                    title: "Do Thing".into(),
                    description: "does a thing".into(),
                    keybind_capable: true,
                    dangerous: false,
                    required_context: vec![],
                    required_capabilities: vec![],
                    arguments: vec![],
                    ai_callable: false,
                    output_schema: None,
                },
                ManifestCommand {
                    id: "other_action".into(),
                    title: "Other".into(),
                    description: "other".into(),
                    keybind_capable: false,
                    dangerous: false,
                    required_context: vec!["message".into()],
                    required_capabilities: vec![],
                    arguments: vec![],
                    ai_callable: false,
                    output_schema: None,
                },
            ],
            keybind_suggestions: vec![KeybindSuggestion {
                keystroke: "Ctrl+Shift+T".into(),
                command_id: "do_thing".into(),
                context: "global".into(),
                preset_args: None,
            }],
            context_actions: vec![ContextAction {
                id: "ctx_other".into(),
                title: "Other on message".into(),
                command_id: "other_action".into(),
                context_types: vec!["message".into()],
            }],
            panels: vec![],
            settings_schema: vec![],
        }
    }

    #[test]
    fn command_infos_carry_qualified_ids_and_flags() {
        let mut m = manifest_with_commands();
        m.commands[1].dangerous = true;
        let infos = m.command_infos();
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].qualified_id, "plugin.dev.example.tool.do_thing");
        assert!(infos[0].keybind_capable && !infos[0].dangerous);
        assert_eq!(infos[1].id, "other_action");
        assert!(infos[1].dangerous && !infos[1].keybind_capable);
    }

    #[test]
    fn panel_slot_is_optional_and_left_out_when_absent() {
        let panel: PanelDef =
            serde_json::from_value(serde_json::json!({"id": "main", "title": "Main"})).unwrap();
        assert_eq!(panel.slot, None);
        assert_eq!(
            serde_json::to_value(&panel).unwrap(),
            serde_json::json!({"id": "main", "title": "Main", "description": ""})
        );
        let panel: PanelDef = serde_json::from_value(
            serde_json::json!({"id": "pods", "title": "Pods", "slot": "main_area"}),
        )
        .unwrap();
        assert_eq!(panel.slot, Some(PanelSlot::MainArea));
    }

    #[test]
    fn keybind_suggestion_valid_command_ref() {
        let m = manifest_with_commands();
        assert!(m.validate().is_ok());
    }

    #[test]
    fn keybind_suggestion_invalid_command_ref() {
        let mut m = manifest_with_commands();
        m.keybind_suggestions.push(KeybindSuggestion {
            keystroke: "Ctrl+X".into(),
            command_id: "nonexistent".into(),
            context: "global".into(),
            preset_args: None,
        });
        let err = m.validate().unwrap_err();
        assert!(err.to_string().contains("undeclared command"));
        assert!(err.to_string().contains("nonexistent"));
    }

    #[test]
    fn context_action_invalid_command_ref() {
        let mut m = manifest_with_commands();
        m.context_actions.push(ContextAction {
            id: "bad_action".into(),
            title: "Bad".into(),
            command_id: "missing_cmd".into(),
            context_types: vec![],
        });
        let err = m.validate().unwrap_err();
        assert!(err.to_string().contains("undeclared command"));
        assert!(err.to_string().contains("missing_cmd"));
    }

    #[test]
    fn qualified_keybind_suggestions() {
        let m = manifest_with_commands();
        let suggestions = m.qualified_keybind_suggestions();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(
            suggestions[0].command_id,
            "plugin.dev.example.tool.do_thing"
        );
        assert_eq!(suggestions[0].keystroke, "Ctrl+Shift+T");
    }

    #[test]
    fn qualified_context_actions() {
        let m = manifest_with_commands();
        let actions = m.qualified_context_actions();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].id, "plugin.dev.example.tool.ctx_other");
        assert_eq!(
            actions[0].command_id,
            "plugin.dev.example.tool.other_action"
        );
        assert_eq!(actions[0].context_types, vec!["message"]);
    }
}
