use crate::plugin_host::manifest::{ManifestCommand, ManifestError, PluginManifest, RuntimeKind};
use std::path::Path;

/// Simple mode entrypoint filenames, in priority order.
const SIMPLE_ENTRYPOINTS: &[&str] = &["main.ts", "main.js", "main.py"];

/// Parses a simple-mode plugin manifest from comment headers in the entrypoint file.
///
/// Format (lines must appear at the top of the file, before any non-comment/non-empty line):
/// ```text
/// # rim-plugin: dev.example.my-tool
/// # rim-name: My Tool
/// # rim-version: 1.0.0
/// # rim-description: Does useful things
/// # rim-author: Jane Doe
/// # rim-capabilities: chat.read, network
/// # rim-command: do_thing | Do Thing | Does a thing
/// ```
///
/// `file_name` names the entrypoint and picks its command.
///
/// # Errors
///
/// Returns a [`ManifestError`] for an unknown or malformed `rim-` header, a
/// missing `rim-plugin` or `rim-name`, or a manifest that fails validation.
pub fn parse_simple_manifest(
    source: &str,
    file_name: &str,
) -> Result<PluginManifest, ManifestError> {
    let mut plugin_id: Option<String> = None;
    let mut name: Option<String> = None;
    let mut version: Option<String> = None;
    let mut description: Option<String> = None;
    let mut author: Option<String> = None;
    let mut capabilities: Vec<String> = Vec::new();
    let mut commands: Vec<ManifestCommand> = Vec::new();

    for (line_num, line) in source.lines().enumerate() {
        let trimmed = line.trim();

        // Stop parsing at the first non-comment, non-empty line.
        if !trimmed.is_empty() && !trimmed.starts_with('#') && !trimmed.starts_with("//") {
            break;
        }

        // Strip the comment prefix.
        let content = trimmed
            .strip_prefix('#')
            .or_else(|| trimmed.strip_prefix("//"))
            .map(|s| s.trim());

        let Some(content) = content else {
            continue;
        };

        if content.is_empty() {
            continue;
        }

        // Parse `key: value`.
        let Some((key, value)) = content.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();

        if value.is_empty() {
            return Err(ManifestError::Validation(format!(
                "line {}: empty value for key '{key}'",
                line_num + 1
            )));
        }

        match key {
            "rim-plugin" => plugin_id = Some(value.to_string()),
            "rim-name" => name = Some(value.to_string()),
            "rim-version" => version = Some(value.to_string()),
            "rim-description" => description = Some(value.to_string()),
            "rim-author" => author = Some(value.to_string()),
            "rim-capabilities" => {
                capabilities = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            "rim-command" => {
                let parts: Vec<&str> = value.splitn(3, '|').collect();
                if parts.len() < 2 {
                    return Err(ManifestError::Validation(format!(
                        "line {}: rim-command must have format 'id | title' or 'id | title | description'",
                        line_num + 1
                    )));
                }
                let cmd_id = parts[0].trim();
                let cmd_title = parts[1].trim();
                let cmd_desc = parts.get(2).map(|s| s.trim()).unwrap_or("");

                if cmd_id.is_empty() || cmd_title.is_empty() {
                    return Err(ManifestError::Validation(format!(
                        "line {}: rim-command id and title must not be empty",
                        line_num + 1
                    )));
                }

                commands.push(ManifestCommand {
                    id: cmd_id.to_string(),
                    title: cmd_title.to_string(),
                    description: cmd_desc.to_string(),
                    keybind_capable: false,
                    dangerous: false,
                    required_context: vec![],
                    required_capabilities: vec![],
                    arguments: vec![],
                    ai_callable: false,
                    output_schema: None,
                });
            }
            _ => {
                // An unknown `rim-` key is an error.
                if key.starts_with("rim-") {
                    return Err(ManifestError::Validation(format!(
                        "line {}: unknown manifest key '{key}'",
                        line_num + 1
                    )));
                }
                // Other comments are skipped.
            }
        }
    }

    let plugin_id = plugin_id
        .ok_or_else(|| ManifestError::Validation("missing required header: rim-plugin".into()))?;
    let display_name =
        name.ok_or_else(|| ManifestError::Validation("missing required header: rim-name".into()))?;
    let version = version.unwrap_or_else(|| "0.1.0".into());

    let entrypoint = detect_entrypoint(file_name);

    let manifest = PluginManifest {
        manifest_version: 1,
        plugin_id,
        display_name,
        version,
        description: description.unwrap_or_default(),
        author,
        runtime_kind: RuntimeKind::DesktopLocalProcess,
        entrypoint,
        capabilities,
        network_origins: None,
        commands,
        keybind_suggestions: vec![],
        context_actions: vec![],
        panels: vec![],
        settings_schema: vec![],
    };

    manifest.validate()?;
    Ok(manifest)
}

/// Returns the entrypoint command for a file, chosen by its extension.
fn detect_entrypoint(file_name: &str) -> String {
    if file_name.ends_with(".ts") {
        format!("npx tsx {file_name}")
    } else if file_name.ends_with(".py") {
        format!("python {file_name}")
    } else if file_name.ends_with(".js") {
        format!("node {file_name}")
    } else {
        file_name.to_string()
    }
}

/// Returns the name of the first simple-mode entrypoint present in `plugin_dir`.
pub fn find_simple_entrypoint(plugin_dir: &Path) -> Option<String> {
    for name in SIMPLE_ENTRYPOINTS {
        if plugin_dir.join(name).exists() {
            return Some(name.to_string());
        }
    }
    None
}

/// Loads a simple-mode manifest from a plugin directory; `None` when it has no
/// simple-mode entrypoint.
///
/// # Errors
///
/// Returns a [`ManifestError`] when the entrypoint cannot be read or its
/// headers do not make a valid manifest.
pub fn load_simple_manifest(plugin_dir: &Path) -> Result<Option<PluginManifest>, ManifestError> {
    let Some(entrypoint_name) = find_simple_entrypoint(plugin_dir) else {
        return Ok(None);
    };
    let source = std::fs::read_to_string(plugin_dir.join(&entrypoint_name))?;
    let manifest = parse_simple_manifest(&source, &entrypoint_name)?;
    Ok(Some(manifest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_manifest() {
        let source = r#"# rim-plugin: dev.example.hello
# rim-name: Hello Plugin
# rim-version: 1.0.0
# rim-description: Says hello
# rim-capabilities: chat.read, network
# rim-command: say_hello | Say Hello | Greets the user

console.log("hello");
"#;
        let manifest = parse_simple_manifest(source, "main.js").unwrap();
        assert_eq!(manifest.plugin_id, "dev.example.hello");
        assert_eq!(manifest.display_name, "Hello Plugin");
        assert_eq!(manifest.version, "1.0.0");
        assert_eq!(manifest.capabilities, vec!["chat.read", "network"]);
        assert_eq!(manifest.commands.len(), 1);
        assert_eq!(manifest.commands[0].id, "say_hello");
        assert_eq!(manifest.entrypoint, "node main.js");
    }

    #[test]
    fn parse_typescript_entrypoint() {
        let source = "# rim-plugin: dev.example.ts-tool\n# rim-name: TS Tool\n";
        let manifest = parse_simple_manifest(source, "main.ts").unwrap();
        assert_eq!(manifest.entrypoint, "npx tsx main.ts");
    }

    #[test]
    fn parse_python_entrypoint() {
        let source = "# rim-plugin: dev.example.py-tool\n# rim-name: Py Tool\n";
        let manifest = parse_simple_manifest(source, "main.py").unwrap();
        assert_eq!(manifest.entrypoint, "python main.py");
    }

    #[test]
    fn double_slash_comments() {
        let source = "// rim-plugin: dev.example.js-tool\n// rim-name: JS Tool\n";
        let manifest = parse_simple_manifest(source, "main.js").unwrap();
        assert_eq!(manifest.plugin_id, "dev.example.js-tool");
    }

    #[test]
    fn missing_plugin_id() {
        let source = "# rim-name: Hello\n";
        let err = parse_simple_manifest(source, "main.js").unwrap_err();
        assert!(err.to_string().contains("rim-plugin"));
    }

    #[test]
    fn missing_name() {
        let source = "# rim-plugin: dev.example.test\n";
        let err = parse_simple_manifest(source, "main.js").unwrap_err();
        assert!(err.to_string().contains("rim-name"));
    }

    #[test]
    fn empty_value_rejected() {
        let source = "# rim-plugin:\n# rim-name: Test\n";
        let err = parse_simple_manifest(source, "main.js").unwrap_err();
        assert!(err.to_string().contains("empty value"));
    }

    #[test]
    fn unknown_rim_key_rejected() {
        let source = "# rim-plugin: dev.example.test\n# rim-name: Test\n# rim-unknown: foo\n";
        let err = parse_simple_manifest(source, "main.js").unwrap_err();
        assert!(err.to_string().contains("unknown manifest key"));
    }

    #[test]
    fn malformed_command_rejected() {
        let source =
            "# rim-plugin: dev.example.test\n# rim-name: Test\n# rim-command: no_pipe_here\n";
        let err = parse_simple_manifest(source, "main.js").unwrap_err();
        assert!(err.to_string().contains("rim-command must have format"));
    }

    #[test]
    fn default_version() {
        let source = "# rim-plugin: dev.example.test\n# rim-name: Test\n";
        let manifest = parse_simple_manifest(source, "main.js").unwrap();
        assert_eq!(manifest.version, "0.1.0");
    }

    #[test]
    fn stops_at_non_comment_line() {
        let source =
            "# rim-plugin: dev.example.test\n# rim-name: Test\ncode();\n# rim-version: 2.0.0\n";
        let manifest = parse_simple_manifest(source, "main.js").unwrap();
        // rim-version after code line should be ignored
        assert_eq!(manifest.version, "0.1.0");
    }

    #[test]
    fn find_simple_entrypoint_ts_priority() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("main.ts"), "").unwrap();
        std::fs::write(tmp.path().join("main.js"), "").unwrap();
        assert_eq!(find_simple_entrypoint(tmp.path()), Some("main.ts".into()));
    }

    #[test]
    fn find_simple_entrypoint_none() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert_eq!(find_simple_entrypoint(tmp.path()), None);
    }
}
