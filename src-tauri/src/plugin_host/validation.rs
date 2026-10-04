//! MIRROR of `rim-server/rim_services/src/plugin_host/validation.rs` — keep in sync.
//! Extraction to shared `rim_plugin_validation` crate filed as task TBD.
//! If you change one, change the other AND its test corpus.

use crate::plugin_host::manifest::{ManifestCommand, PluginManifest};

const RESERVED_PREFIXES: &[&str] = &["system.", "internal.", "admin.", "audit."];
const RESERVED_SEGMENTS: &[&str] = &["system", "internal", "admin", "audit"];
const MIN_KEY_LEN: usize = 4;
const MAX_KEY_LEN: usize = 128;

/// N1 / F2 validation failure surfaced as a typed enum so the JS UI can branch
/// without string-parsing the message (WARN: replace flat `to_string()` surface
/// with `#[serde(tag = "kind")]` so frontend can pattern-match on `kind`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind")]
pub enum ValidationError {
    /// N1 closure: a capability key declared by the plugin is malformed or
    /// uses a reserved namespace. The plugin is rejected at install time so
    /// the capability gate can never be bypassed by creative key crafting.
    #[serde(rename = "INVALID_CAPABILITY_KEY")]
    InvalidCapabilityKey { key: String, reason: String },
    /// F2 closure: an `ai_callable` command's `output_schema` declares a field
    /// whose name normalises to `installid` or `installationid`. Exfiltrating
    /// the per-installation ID via an AI-visible surface breaks pseudonymity
    /// across workspace accounts; the plugin is rejected at install time.
    #[serde(rename = "INSTALL_ID_LEAK")]
    InstallIdLeakInAiSurface {
        command_id: String,
        field_path: String,
    },
    /// The command is `ai_callable` but its `output_schema` is absent or
    /// structurally opaque (no `properties`, `additionalProperties: true`,
    /// non-object root). Static install-ID leak analysis is impossible without
    /// a declared schema; human review is required before the plugin is allowed
    /// onto the AI surface.
    #[serde(rename = "REQUIRES_MANUAL_REVIEW")]
    RequiresManualReview { command_id: String, reason: String },
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidCapabilityKey { key, reason } => {
                write!(f, "invalid capability key `{key}`: {reason}")
            }
            Self::InstallIdLeakInAiSurface {
                command_id,
                field_path,
            } => write!(
                f,
                "command `{command_id}` is ai_callable but its output_schema \
                 declares `{field_path}` which matches the plugin-install-id \
                 leak heuristic — install rejected"
            ),
            Self::RequiresManualReview { command_id, reason } => write!(
                f,
                "command `{command_id}` requires manual install review: {reason}"
            ),
        }
    }
}

impl std::error::Error for ValidationError {}

/// N1 closure: validates a single capability key declared by plugin_id.
pub fn validate_plugin_capability(
    plugin_id: &str,
    capability_key: &str,
) -> Result<(), ValidationError> {
    let reject = |reason: &str| {
        Err(ValidationError::InvalidCapabilityKey {
            key: capability_key.to_string(),
            reason: reason.to_string(),
        })
    };

    let len = capability_key.len();
    if len < MIN_KEY_LEN {
        return reject(&format!(
            "capability key must be at least {MIN_KEY_LEN} bytes (got {len})"
        ));
    }
    if len > MAX_KEY_LEN {
        return reject(&format!(
            "capability key must be at most {MAX_KEY_LEN} bytes (got {len})"
        ));
    }

    if !capability_key
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.')
    {
        return reject(
            "capability key must match [a-z0-9_.]+ (lowercase ASCII alnum, underscore, dot)",
        );
    }

    if capability_key.starts_with('.') || capability_key.ends_with('.') {
        return reject("capability key may not start or end with `.`");
    }
    if capability_key.contains("..") {
        return reject("capability key may not contain `..` (empty segment)");
    }

    for reserved in RESERVED_PREFIXES {
        if capability_key.starts_with(reserved) {
            return reject(&format!(
                "capability key starts with reserved namespace `{reserved}` \
                 (reserved for builtin caps)"
            ));
        }
    }

    let required_prefix = format!("plugin.{plugin_id}.");
    if !capability_key.starts_with(&required_prefix) {
        return reject(&format!(
            "capability key must start with `{required_prefix}` so the gate \
             can attribute the cap back to its declaring plugin"
        ));
    }

    let verb = &capability_key[required_prefix.len()..];
    if verb.is_empty() {
        return reject("capability key must declare a verb after `plugin.<id>.`");
    }

    for segment in capability_key.split('.') {
        if RESERVED_SEGMENTS.contains(&segment) {
            return reject(&format!(
                "capability key segment `{segment}` is reserved and may not \
                 appear as a component of a plugin cap"
            ));
        }
    }

    Ok(())
}

/// F2 closure: walks every ai_callable command and inspects output_schema for install-ID leak.
pub fn walk_output_schema_for_install_id_leak(
    commands: &[ManifestCommand],
) -> Result<(), ValidationError> {
    for command in commands {
        if !command.ai_callable {
            continue;
        }
        check_ai_command_output_schema(command)?;
    }
    Ok(())
}

fn check_ai_command_output_schema(command: &ManifestCommand) -> Result<(), ValidationError> {
    let Some(schema) = command.output_schema.as_ref() else {
        return Err(ValidationError::RequiresManualReview {
            command_id: command.id.clone(),
            reason: "ai_callable: true requires a declared output_schema for \
                     static install-ID leak analysis"
                .to_string(),
        });
    };

    let Some(root) = schema.as_object() else {
        return Err(ValidationError::RequiresManualReview {
            command_id: command.id.clone(),
            reason: "output_schema must be a JSON object describing an object envelope".to_string(),
        });
    };

    let root_type = root.get("type").and_then(|v| v.as_str());
    if root_type != Some("object") {
        return Err(ValidationError::RequiresManualReview {
            command_id: command.id.clone(),
            reason: format!(
                "output_schema root type must be `object` (got {:?})",
                root_type.unwrap_or("none")
            ),
        });
    }

    let additional_props_open = root
        .get("additionalProperties")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if additional_props_open {
        return Err(ValidationError::RequiresManualReview {
            command_id: command.id.clone(),
            reason: "output_schema declares `additionalProperties: true` — \
                     opaque shape cannot be statically scanned for install-ID leak"
                .to_string(),
        });
    }

    if root.get("properties").and_then(|v| v.as_object()).is_none()
        && !contains_compositional_keyword(root)
    {
        return Err(ValidationError::RequiresManualReview {
            command_id: command.id.clone(),
            reason: "output_schema must declare `properties` (or a compositional \
                     keyword: oneOf/anyOf/allOf/$defs) for static install-ID \
                     leak analysis"
                .to_string(),
        });
    }

    walk_schema_node(&command.id, "", schema)
}

fn contains_compositional_keyword(node: &serde_json::Map<String, serde_json::Value>) -> bool {
    node.contains_key("oneOf")
        || node.contains_key("anyOf")
        || node.contains_key("allOf")
        || node.contains_key("$defs")
        || node.contains_key("items")
}

fn walk_schema_node(
    command_id: &str,
    parent_path: &str,
    node: &serde_json::Value,
) -> Result<(), ValidationError> {
    let Some(obj) = node.as_object() else {
        return Ok(());
    };

    if let Some(properties) = obj.get("properties").and_then(|v| v.as_object()) {
        for (name, value) in properties {
            let path = join_path(parent_path, name);
            if name_matches_install_id_leak(name) {
                return Err(ValidationError::InstallIdLeakInAiSurface {
                    command_id: command_id.to_string(),
                    field_path: path,
                });
            }
            walk_schema_node(command_id, &path, value)?;
        }
    }

    if let Some(items) = obj.get("items") {
        let items_path = format!("{parent_path}[]");
        if let Some(tuple) = items.as_array() {
            for (i, item) in tuple.iter().enumerate() {
                let tuple_path = format!("{parent_path}[{i}]");
                walk_schema_node(command_id, &tuple_path, item)?;
            }
        } else {
            walk_schema_node(command_id, &items_path, items)?;
        }
    }

    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(branches) = obj.get(keyword).and_then(|v| v.as_array()) {
            for (i, branch) in branches.iter().enumerate() {
                let branch_path = format!("{parent_path}|{keyword}[{i}]");
                walk_schema_node(command_id, &branch_path, branch)?;
            }
        }
    }

    if let Some(defs) = obj.get("$defs").and_then(|v| v.as_object()) {
        for (name, def) in defs {
            let def_path = if parent_path.is_empty() {
                format!("$defs.{name}")
            } else {
                format!("{parent_path}.$defs.{name}")
            };
            if name_matches_install_id_leak(name) {
                return Err(ValidationError::InstallIdLeakInAiSurface {
                    command_id: command_id.to_string(),
                    field_path: def_path,
                });
            }
            walk_schema_node(command_id, &def_path, def)?;
        }
    }

    Ok(())
}

fn join_path(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        child.to_string()
    } else {
        format!("{parent}.{child}")
    }
}

fn name_matches_install_id_leak(name: &str) -> bool {
    let normalized: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    normalized.contains("installid") || normalized.contains("installationid")
}

/// Single entry point: compose N1 (capability key shape) + F2 (install-ID leak).
pub fn validate_plugin_manifest(manifest: &PluginManifest) -> Result<(), ValidationError> {
    for cap in &manifest.capabilities {
        validate_plugin_capability(&manifest.plugin_id, cap)?;
    }
    walk_output_schema_for_install_id_leak(&manifest.commands)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::manifest::{ManifestCommand, PluginManifest, RuntimeKind};

    fn manifest_with_commands(
        plugin_id: &str,
        capabilities: Vec<String>,
        commands: Vec<ManifestCommand>,
    ) -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            plugin_id: plugin_id.into(),
            display_name: "Test".into(),
            version: "0.1.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "./bin".into(),
            capabilities,
            commands,
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        }
    }

    fn ai_command(
        id: &str,
        ai_callable: bool,
        output_schema: Option<serde_json::Value>,
    ) -> ManifestCommand {
        ManifestCommand {
            id: id.into(),
            title: id.into(),
            description: "test".into(),
            keybind_capable: false,
            dangerous: false,
            required_context: vec![],
            required_capabilities: vec![],
            arguments: vec![],
            ai_callable,
            output_schema,
        }
    }

    // ── N1: validate_plugin_capability ──

    #[test]
    fn n1_rejects_dispatch_plan_garbage_set() {
        let plugin_id = "self";
        for bad in [
            "*",
            "a",
            "abc",
            "foo bar",
            "system.evil",
            "plugin.other.foo",
            "PLUGIN.self.foo",
            "plugin.self.",
            "plugin.self..bad",
            ".plugin.self.foo",
            "plugin.self.foo.",
            "plugin.self.audit",
            "plugin.self.system",
        ] {
            let result = validate_plugin_capability(plugin_id, bad);
            assert!(
                result.is_err(),
                "N1 must reject `{bad}` but it passed: {result:?}"
            );
        }
    }

    #[test]
    fn n1_rejects_overlong_key() {
        let plugin_id = "self";
        let key = format!("plugin.{plugin_id}.{}", "x".repeat(200));
        assert!(validate_plugin_capability(plugin_id, &key).is_err());
    }

    #[test]
    fn n1_rejects_max_len_plus_one() {
        let plugin_id = "self";
        let prefix = format!("plugin.{plugin_id}.");
        let verb_len = MAX_KEY_LEN + 1 - prefix.len();
        let key = format!("{prefix}{}", "a".repeat(verb_len));
        assert_eq!(key.len(), MAX_KEY_LEN + 1);
        assert!(validate_plugin_capability(plugin_id, &key).is_err());
    }

    #[test]
    fn n1_accepts_max_len_exactly() {
        let plugin_id = "self";
        let prefix = format!("plugin.{plugin_id}.");
        let verb_len = MAX_KEY_LEN - prefix.len();
        let key = format!("{prefix}{}", "a".repeat(verb_len));
        assert_eq!(key.len(), MAX_KEY_LEN);
        assert!(validate_plugin_capability(plugin_id, &key).is_ok());
    }

    #[test]
    fn n1_accepts_well_formed_keys() {
        let plugin_id = "dev.example.k8s_tools";
        for good in [
            "plugin.dev.example.k8s_tools.restart_pod",
            "plugin.dev.example.k8s_tools.list_pods",
            "plugin.dev.example.k8s_tools.fetch_logs_2",
        ] {
            let result = validate_plugin_capability(plugin_id, good);
            assert!(
                result.is_ok(),
                "N1 should accept `{good}` but rejected: {result:?}"
            );
        }
    }

    #[test]
    fn n1_rejects_capability_for_other_plugin() {
        let result = validate_plugin_capability("attacker_plugin", "plugin.victim_plugin.do_thing");
        assert!(matches!(
            result,
            Err(ValidationError::InvalidCapabilityKey { .. })
        ));
    }

    #[test]
    fn n1_error_includes_offending_key_for_diagnostics() {
        let err = validate_plugin_capability("self", "*").unwrap_err();
        match err {
            ValidationError::InvalidCapabilityKey { key, .. } => assert_eq!(key, "*"),
            other => panic!("expected InvalidCapabilityKey, got {other:?}"),
        }
    }

    // ── F2: walk_output_schema_for_install_id_leak ──

    #[test]
    fn f2_no_ai_callable_commands_passes() {
        let m = manifest_with_commands("self", vec![], vec![ai_command("safe.cmd", false, None)]);
        assert!(walk_output_schema_for_install_id_leak(&m.commands).is_ok());
    }

    #[test]
    fn f2_ai_callable_without_schema_requires_manual_review() {
        let m = manifest_with_commands("self", vec![], vec![ai_command("opaque.cmd", true, None)]);
        let err = walk_output_schema_for_install_id_leak(&m.commands).unwrap_err();
        assert!(matches!(err, ValidationError::RequiresManualReview { .. }));
    }

    #[test]
    fn f2_ai_callable_with_typed_clean_schema_passes() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "summary": { "type": "string" },
                "count": { "type": "integer" }
            }
        });
        let m = manifest_with_commands(
            "self",
            vec![],
            vec![ai_command("safe.cmd", true, Some(schema))],
        );
        assert!(walk_output_schema_for_install_id_leak(&m.commands).is_ok());
    }

    #[test]
    fn f2_ai_callable_with_install_id_leak_rejects() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "summary": { "type": "string" },
                "plugin_install_id": { "type": "string" }
            }
        });
        let m = manifest_with_commands(
            "self",
            vec![],
            vec![ai_command("leaky.cmd", true, Some(schema))],
        );
        let err = walk_output_schema_for_install_id_leak(&m.commands).unwrap_err();
        match err {
            ValidationError::InstallIdLeakInAiSurface {
                command_id,
                field_path,
            } => {
                assert_eq!(command_id, "leaky.cmd");
                assert_eq!(field_path, "plugin_install_id");
            }
            other => panic!("expected InstallIdLeakInAiSurface, got {other:?}"),
        }
    }

    #[test]
    fn f2_detects_nested_install_id_leak() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "envelope": {
                    "type": "object",
                    "properties": {
                        "metadata": {
                            "type": "object",
                            "properties": {
                                "install_id": { "type": "string" }
                            }
                        }
                    }
                }
            }
        });
        let m = manifest_with_commands(
            "self",
            vec![],
            vec![ai_command("nested.cmd", true, Some(schema))],
        );
        let err = walk_output_schema_for_install_id_leak(&m.commands).unwrap_err();
        match err {
            ValidationError::InstallIdLeakInAiSurface { field_path, .. } => {
                assert_eq!(field_path, "envelope.metadata.install_id");
            }
            other => panic!("expected nested InstallIdLeakInAiSurface, got {other:?}"),
        }
    }

    #[test]
    fn f2_detects_case_insensitive_install_id_variants() {
        for leak in ["INSTALL_ID", "InstallId", "Plugin_Install_Id", "installid"] {
            let schema = serde_json::json!({
                "type": "object",
                "properties": { leak: { "type": "string" } }
            });
            let m =
                manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
            assert!(
                matches!(
                    walk_output_schema_for_install_id_leak(&m.commands),
                    Err(ValidationError::InstallIdLeakInAiSurface { .. })
                ),
                "should reject leak field `{leak}`"
            );
        }
    }

    #[test]
    fn f2_detects_camel_and_kebab_case_install_id_variants() {
        for leak in [
            "installationId",
            "pluginInstallationId",
            "plugin-install-id",
            "PluginInstallationID",
            "InstallationID",
            "installationid",
            "PLUGIN-INSTALLATION-ID",
        ] {
            let schema = serde_json::json!({
                "type": "object",
                "properties": { leak: { "type": "string" } }
            });
            let m =
                manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
            assert!(
                matches!(
                    walk_output_schema_for_install_id_leak(&m.commands),
                    Err(ValidationError::InstallIdLeakInAiSurface { .. })
                ),
                "should reject leak field `{leak}`"
            );
        }
    }

    #[test]
    fn f2_does_not_match_legitimate_installer_fields() {
        for legit in [
            "installer",
            "installation_date",
            "installs",
            "uninstall",
            "installer_version",
            "reinstall_count",
            "install_path",
            "install_dir",
            "install_size",
            "install_log",
            "installable",
            "installation_status",
            "installation_progress",
        ] {
            let schema = serde_json::json!({
                "type": "object",
                "properties": { legit: { "type": "string" } }
            });
            let m =
                manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
            assert!(
                walk_output_schema_for_install_id_leak(&m.commands).is_ok(),
                "must NOT reject legitimate field `{legit}`"
            );
        }
    }

    #[test]
    fn f2_detects_install_id_under_array_items_object_form() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "results": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "install_id": { "type": "string" }
                        }
                    }
                }
            }
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        let err = walk_output_schema_for_install_id_leak(&m.commands).unwrap_err();
        match err {
            ValidationError::InstallIdLeakInAiSurface { field_path, .. } => {
                assert_eq!(field_path, "results[].install_id");
            }
            other => panic!("expected InstallIdLeakInAiSurface, got {other:?}"),
        }
    }

    #[test]
    fn f2_detects_install_id_under_array_items_tuple_form() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "row": {
                    "type": "array",
                    "items": [
                        { "type": "string" },
                        { "type": "object", "properties": { "installId": { "type": "string" } } }
                    ]
                }
            }
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }

    #[test]
    fn f2_detects_install_id_under_one_of_branch() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "outcome": {
                    "oneOf": [
                        { "type": "object", "properties": { "ok": { "type": "boolean" } } },
                        { "type": "object", "properties": { "plugin_install_id": { "type": "string" } } }
                    ]
                }
            }
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }

    #[test]
    fn f2_detects_install_id_under_any_of_branch() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "v": {
                    "anyOf": [
                        { "type": "string" },
                        { "type": "object", "properties": { "installationId": { "type": "string" } } }
                    ]
                }
            }
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }

    #[test]
    fn f2_detects_install_id_under_all_of_branch() {
        let schema = serde_json::json!({
            "type": "object",
            "allOf": [
                { "type": "object", "properties": { "summary": { "type": "string" } } },
                { "type": "object", "properties": { "install_id": { "type": "string" } } }
            ]
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }

    #[test]
    fn f2_detects_install_id_under_dollar_defs() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "summary": { "type": "string" } },
            "$defs": {
                "leakBody": {
                    "type": "object",
                    "properties": { "install_id": { "type": "string" } }
                }
            }
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        let err = walk_output_schema_for_install_id_leak(&m.commands).unwrap_err();
        match err {
            ValidationError::InstallIdLeakInAiSurface { field_path, .. } => {
                assert!(
                    field_path.contains("$defs.leakBody"),
                    "expected $defs path, got `{field_path}`"
                );
            }
            other => panic!("expected leak under $defs, got {other:?}"),
        }
    }

    #[test]
    fn f2_detects_install_id_named_dollar_def_key() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "summary": { "type": "string" } },
            "$defs": {
                "install_id": { "type": "string" }
            }
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }

    #[test]
    fn f2_root_oneof_without_properties_is_walked_not_escalated() {
        let schema = serde_json::json!({
            "type": "object",
            "oneOf": [
                { "type": "object", "properties": { "a": { "type": "string" } } },
                { "type": "object", "properties": { "b": { "type": "integer" } } }
            ]
        });
        let m = manifest_with_commands("self", vec![], vec![ai_command("c", true, Some(schema))]);
        assert!(walk_output_schema_for_install_id_leak(&m.commands).is_ok());
    }

    #[test]
    fn f2_open_additional_properties_requires_manual_review() {
        let schema = serde_json::json!({
            "type": "object",
            "additionalProperties": true,
            "properties": { "summary": { "type": "string" } }
        });
        let m = manifest_with_commands(
            "self",
            vec![],
            vec![ai_command("opaque.cmd", true, Some(schema))],
        );
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::RequiresManualReview { .. })
        ));
    }

    #[test]
    fn f2_non_object_root_requires_manual_review() {
        let schema = serde_json::json!({ "type": "string" });
        let m = manifest_with_commands(
            "self",
            vec![],
            vec![ai_command("scalar.cmd", true, Some(schema))],
        );
        assert!(matches!(
            walk_output_schema_for_install_id_leak(&m.commands),
            Err(ValidationError::RequiresManualReview { .. })
        ));
    }

    #[test]
    fn f2_non_ai_command_with_install_id_field_passes() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "plugin_install_id": { "type": "string" } }
        });
        let m = manifest_with_commands(
            "self",
            vec![],
            vec![ai_command("human_only.cmd", false, Some(schema))],
        );
        assert!(walk_output_schema_for_install_id_leak(&m.commands).is_ok());
    }

    // ── validate_plugin_manifest orchestrator ──

    #[test]
    fn orchestrator_rejects_bad_capability_first() {
        let leaky_schema = serde_json::json!({
            "type": "object",
            "properties": { "install_id": { "type": "string" } }
        });
        let m = manifest_with_commands(
            "self",
            vec!["plugin.other.foo".to_string()],
            vec![ai_command("c", true, Some(leaky_schema))],
        );
        assert!(matches!(
            validate_plugin_manifest(&m),
            Err(ValidationError::InvalidCapabilityKey { .. })
        ));
    }

    #[test]
    fn orchestrator_passes_clean_manifest() {
        let clean_schema = serde_json::json!({
            "type": "object",
            "properties": { "summary": { "type": "string" } }
        });
        let m = manifest_with_commands(
            "self",
            vec!["plugin.self.do_thing".to_string()],
            vec![ai_command("c", true, Some(clean_schema))],
        );
        assert!(validate_plugin_manifest(&m).is_ok());
    }

    #[test]
    fn orchestrator_rejects_f2_leak_when_caps_are_clean() {
        let leaky_schema = serde_json::json!({
            "type": "object",
            "properties": { "plugin_install_id": { "type": "string" } }
        });
        let m = manifest_with_commands(
            "self",
            vec!["plugin.self.do_thing".to_string()],
            vec![ai_command("leaky.cmd", true, Some(leaky_schema))],
        );
        assert!(matches!(
            validate_plugin_manifest(&m),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }
}
