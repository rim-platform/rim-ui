//! Install-time plugin manifest validation. This is the only copy: the
//! server-side mirror (`rim_services::plugin_host::validation`) was removed on
//! 2026-10-04 as dead code, so there is nothing to keep in sync any more.

use crate::plugin_host::capability::{
    BUILTIN_CAPABILITIES, ENCRYPTED_CHAT_CAPABILITIES, NETWORK_FETCH,
};
use crate::plugin_host::manifest::{ManifestCommand, PluginManifest, RuntimeKind};

const RESERVED_PREFIXES: &[&str] = &["system.", "internal.", "admin.", "audit."];
const RESERVED_SEGMENTS: &[&str] = &["system", "internal", "admin", "audit"];
const MIN_KEY_LEN: usize = 4;
const MAX_KEY_LEN: usize = 128;
/// How many origins `network_origins` may list.
pub const MAX_NETWORK_ORIGINS: usize = 16;
/// Capabilities a `WebSandboxed` plugin can never hold, because the browser
/// gives it no programs and no files.
const LOCAL_ONLY_CAPABILITIES: &[&str] = &["local.process", "fs.read", "fs.write"];
/// Longest bundle path, in bytes.
pub const MAX_BUNDLE_PATH_LEN: usize = 255;
/// The context kinds a command's `required_context` can name, and the arguments
/// the host adds to the command's `args` for each.
const CONTEXT_ARGUMENTS: &[(&str, &[&str])] = &[
    ("workspace", &["workspace_id"]),
    ("conversation", &["conversation_id", "thread_id"]),
    ("message", &["message_id", "conversation_id", "thread_id"]),
];

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
    /// `network_origins` breaks its rules: wrong kind, missing or present
    /// without `network.fetch`, too many, malformed, duplicated, or naming the
    /// app's or the RIM API's own origin.
    #[serde(rename = "INVALID_NETWORK_ORIGINS")]
    InvalidNetworkOrigins { reason: String },
    /// A `WebSandboxed` entrypoint that is not a bundle path to one ES module.
    #[serde(rename = "INVALID_ENTRYPOINT")]
    InvalidEntrypoint { entrypoint: String, reason: String },
    /// A `WebSandboxed` panel whose id cannot name its folder under `panels/`.
    #[serde(rename = "INVALID_PANEL")]
    InvalidPanel { panel_id: String, reason: String },
    /// A command declares an argument the host sets from a context it requires.
    #[serde(rename = "RESERVED_ARGUMENT")]
    ReservedArgument {
        command_id: String,
        argument: String,
        context: String,
    },
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
            Self::InvalidNetworkOrigins { reason } => {
                write!(f, "invalid network_origins: {reason}")
            }
            Self::InvalidEntrypoint { entrypoint, reason } => {
                write!(f, "invalid entrypoint `{entrypoint}`: {reason}")
            }
            Self::InvalidPanel { panel_id, reason } => {
                write!(f, "invalid panel `{panel_id}`: {reason}")
            }
            Self::ReservedArgument {
                command_id,
                argument,
                context,
            } => write!(
                f,
                "command `{command_id}` declares argument `{argument}`, which the host sets \
                 from its required {context} context"
            ),
        }
    }
}

impl std::error::Error for ValidationError {}

/// N1 closure for a `DesktopLocalProcess` plugin; see [`validate_capability`].
#[cfg(test)]
pub fn validate_plugin_capability(
    plugin_id: &str,
    capability_key: &str,
) -> Result<(), ValidationError> {
    validate_capability(RuntimeKind::DesktopLocalProcess, plugin_id, capability_key)
}

/// N1 closure: validates a single capability key declared by plugin_id.
///
/// A manifest may declare the built-in names in [`BUILTIN_CAPABILITIES`] and
/// its own keys of the form `plugin.<plugin_id>.<verb>`, with the verb in
/// `[a-z0-9_.]`. Hyphens are fine in the plugin id part, since manifests allow
/// them there. A `WebSandboxed` plugin may also declare [`NETWORK_FETCH`], and
/// is told why it can never hold the names of local programs, files and
/// host-brokered requests.
pub fn validate_capability(
    kind: RuntimeKind,
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

    if BUILTIN_CAPABILITIES.contains(&capability_key) {
        return Ok(());
    }
    if capability_key == NETWORK_FETCH {
        return match kind {
            RuntimeKind::WebSandboxed => Ok(()),
            RuntimeKind::DesktopLocalProcess => reject(
                "network.fetch is for WebSandboxed plugins; a local process reaches the \
                 network on its own",
            ),
        };
    }
    if kind == RuntimeKind::WebSandboxed {
        if LOCAL_ONLY_CAPABILITIES.contains(&capability_key) {
            return reject(
                "WebSandboxed plugins cannot run programs or read files; use DesktopLocalProcess",
            );
        }
        if capability_key == "network" {
            return reject(
                "network names host-brokered requests for local processes; a WebSandboxed \
                 plugin asks for network.fetch",
            );
        }
    }

    for reserved in RESERVED_PREFIXES {
        if capability_key.starts_with(reserved) {
            return reject(&format!(
                "capability key starts with reserved namespace `{reserved}` \
                 (reserved for builtin caps)"
            ));
        }
    }

    // The plugin id is checked by the manifest loader (alphanumeric and `-`
    // segments), so only the verb after it needs a character check here.
    let required_prefix = format!("plugin.{plugin_id}.");
    let Some(verb) = capability_key.strip_prefix(&required_prefix) else {
        return reject(&format!(
            "capability key must be one of {BUILTIN_CAPABILITIES:?} or start with \
             `{required_prefix}` so the gate can attribute the cap back to its \
             declaring plugin"
        ));
    };
    if verb.is_empty() {
        return reject("capability key must declare a verb after `plugin.<id>.`");
    }

    if !verb
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.')
    {
        return reject(
            "capability verb must match [a-z0-9_.]+ (lowercase ASCII alnum, underscore, dot)",
        );
    }
    if verb.starts_with('.') || verb.ends_with('.') {
        return reject("capability key may not start or end with `.`");
    }
    if verb.contains("..") {
        return reject("capability key may not contain `..` (empty segment)");
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

/// An encrypted chat capability widens its plain one to encrypted conversations, so a
/// manifest that asks for it must ask for the plain one too.
fn validate_encrypted_chat(manifest: &PluginManifest) -> Result<(), ValidationError> {
    for (encrypted, plain) in ENCRYPTED_CHAT_CAPABILITIES {
        let has = |name: &str| manifest.capabilities.iter().any(|c| c == name);
        if has(encrypted) && !has(plain) {
            return Err(ValidationError::InvalidCapabilityKey {
                key: (*encrypted).to_string(),
                reason: format!("{encrypted} requires {plain} as well"),
            });
        }
    }
    Ok(())
}

/// A command may not declare an argument the host sets from a context it requires.
fn validate_context_arguments(commands: &[ManifestCommand]) -> Result<(), ValidationError> {
    for command in commands {
        for kind in &command.required_context {
            let Some((_, reserved)) = CONTEXT_ARGUMENTS.iter().find(|(k, _)| k == kind) else {
                continue;
            };
            for argument in &command.arguments {
                let Some(name) = argument.get("name").and_then(|n| n.as_str()) else {
                    continue;
                };
                if reserved.contains(&name) {
                    return Err(ValidationError::ReservedArgument {
                        command_id: command.id.clone(),
                        argument: name.to_string(),
                        context: kind.clone(),
                    });
                }
            }
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

/// Whether `path` is a bundle path: 1 to 255 bytes of `/`-separated segments
/// of `A-Z a-z 0-9 . _ -`, none empty, `.` or `..`, none starting with `.`.
pub fn is_bundle_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= MAX_BUNDLE_PATH_LEN && path.split('/').all(is_bundle_segment)
}

/// One segment of a bundle path; see [`is_bundle_path`].
pub fn is_bundle_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// An origin from `network_origins`, split into its parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkOrigin {
    /// `https` or `wss`.
    pub scheme: String,
    pub host: String,
    /// The explicit port, if any.
    pub port: Option<u16>,
}

impl NetworkOrigin {
    /// Host and port with the default port (443) left out, which is how the
    /// consent prompt names the site and how origins are compared.
    pub fn site(&self) -> String {
        match self.port {
            Some(port) if port != 443 => format!("{}:{port}", self.host),
            _ => self.host.clone(),
        }
    }
}

/// Parse one `network_origins` entry: `https://host[:port]` or
/// `wss://host[:port]`, lowercase, with no path, query, fragment, userinfo or
/// wildcard.
pub fn parse_network_origin(origin: &str) -> Result<NetworkOrigin, String> {
    let (scheme, rest) = if let Some(rest) = origin.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = origin.strip_prefix("wss://") {
        ("wss", rest)
    } else {
        return Err(format!("`{origin}` must start with https:// or wss://"));
    };
    let (host, port) = match rest.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    let port = match port {
        None => None,
        Some(digits) => {
            let valid = !digits.is_empty()
                && digits.len() <= 5
                && !digits.starts_with('0')
                && digits.bytes().all(|b| b.is_ascii_digit());
            match digits.parse::<u16>() {
                Ok(port) if valid => Some(port),
                _ => return Err(format!("`{origin}` has an invalid port")),
            }
        }
    };
    let valid_host = !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        });
    if !valid_host {
        return Err(format!(
            "`{origin}` must be scheme://host[:port] with a lowercase host and no path, \
             query, fragment, userinfo or wildcard"
        ));
    }
    Ok(NetworkOrigin {
        scheme: scheme.to_string(),
        host: host.to_string(),
        port,
    })
}

/// The `network_origins` rules: only for `WebSandboxed`, present exactly when
/// `network.fetch` is declared, 1 to 16 well-formed origins, no duplicates, and
/// none on the host and port of a `forbidden_origins` entry (the app's and the
/// RIM API's origins).
pub fn validate_network_origins(
    manifest: &PluginManifest,
    forbidden_origins: &[String],
) -> Result<(), ValidationError> {
    let reject = |reason: String| Err(ValidationError::InvalidNetworkOrigins { reason });
    let wants_fetch = manifest.capabilities.iter().any(|c| c == NETWORK_FETCH);
    let Some(origins) = &manifest.network_origins else {
        if wants_fetch {
            return reject("network.fetch needs network_origins listing 1 to 16 origins".into());
        }
        return Ok(());
    };
    if manifest.runtime_kind != RuntimeKind::WebSandboxed {
        return reject("network_origins is for WebSandboxed plugins".into());
    }
    if !wants_fetch {
        return reject("network_origins is present without the network.fetch capability".into());
    }
    if origins.is_empty() || origins.len() > MAX_NETWORK_ORIGINS {
        return reject(format!(
            "lists {} origins, must list 1 to {MAX_NETWORK_ORIGINS}",
            origins.len()
        ));
    }
    let forbidden_sites: Vec<String> = forbidden_origins
        .iter()
        .filter_map(|o| forbidden_site(o))
        .collect();
    let mut seen = std::collections::HashSet::new();
    for origin in origins {
        let parsed = parse_network_origin(origin)
            .map_err(|reason| ValidationError::InvalidNetworkOrigins { reason })?;
        if !seen.insert(origin.as_str()) {
            return reject(format!("`{origin}` is listed twice"));
        }
        if forbidden_sites.contains(&parsed.site()) {
            return reject(format!(
                "`{origin}` is RIM's own origin, which a plugin may never reach"
            ));
        }
    }
    Ok(())
}

/// Host and port of an `http(s)`/`ws(s)` origin, default ports left out, for
/// comparing a plugin's origins with the app's and the API's.
fn forbidden_site(origin: &str) -> Option<String> {
    let (scheme, rest) = origin.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    let default_port = match scheme {
        "https" | "wss" => "443",
        "http" | "ws" => "80",
        _ => return None,
    };
    Some(match authority.rsplit_once(':') {
        Some((host, port)) if port == default_port => host.to_string(),
        _ => authority,
    })
}

/// The `WebSandboxed` file rules a manifest can state: the entrypoint is a
/// bundle path to one ES module, and each panel id names a folder.
fn validate_web_layout(manifest: &PluginManifest) -> Result<(), ValidationError> {
    let entry = &manifest.entrypoint;
    if !is_bundle_path(entry) {
        return Err(ValidationError::InvalidEntrypoint {
            entrypoint: entry.clone(),
            reason: "must be a bundle path of A-Z a-z 0-9 . _ - segments".into(),
        });
    }
    if !(entry.ends_with(".mjs") || entry.ends_with(".js")) {
        return Err(ValidationError::InvalidEntrypoint {
            entrypoint: entry.clone(),
            reason: "a WebSandboxed entrypoint is an ES module ending in .mjs or .js".into(),
        });
    }
    if entry.starts_with("panels/") {
        return Err(ValidationError::InvalidEntrypoint {
            entrypoint: entry.clone(),
            reason: "the entrypoint may not live under panels/".into(),
        });
    }
    for panel in &manifest.panels {
        if !is_bundle_segment(&panel.id) {
            return Err(ValidationError::InvalidPanel {
                panel_id: panel.id.clone(),
                reason: "a panel id names its folder under panels/: A-Z a-z 0-9 . _ -, not \
                         starting with ."
                    .into(),
            });
        }
    }
    Ok(())
}

/// Single entry point: compose N1 (capability key shape) + F2 (install-ID leak)
/// and the kind's rules, with no host origins to refuse.
pub fn validate_plugin_manifest(manifest: &PluginManifest) -> Result<(), ValidationError> {
    validate_plugin_manifest_for_host(manifest, &[])
}

/// [`validate_plugin_manifest`], also refusing `network_origins` on the host
/// and port of one of `forbidden_origins`.
pub fn validate_plugin_manifest_for_host(
    manifest: &PluginManifest,
    forbidden_origins: &[String],
) -> Result<(), ValidationError> {
    for cap in &manifest.capabilities {
        validate_capability(manifest.runtime_kind, &manifest.plugin_id, cap)?;
    }
    validate_encrypted_chat(manifest)?;
    validate_network_origins(manifest, forbidden_origins)?;
    if manifest.runtime_kind == RuntimeKind::WebSandboxed {
        validate_web_layout(manifest)?;
    }
    validate_context_arguments(&manifest.commands)?;
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
            network_origins: None,
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
    fn n1_accepts_builtin_capabilities() {
        for cap in BUILTIN_CAPABILITIES {
            let result = validate_plugin_capability("dev.example.hello-world", cap);
            assert!(result.is_ok(), "`{cap}` should be accepted: {result:?}");
        }
    }

    #[test]
    fn n1_rejects_builtin_names_that_guard_nothing() {
        for bad in [
            "local.process",
            "network",
            "fs.read",
            "fs.write",
            "events.read",
            "chat.admin",
            "chat.read.all",
            "ui",
        ] {
            assert!(
                validate_plugin_capability("dev.example.tool", bad).is_err(),
                "`{bad}` must be rejected"
            );
        }
    }

    #[test]
    fn n1_accepts_keys_of_a_hyphenated_plugin_id() {
        let plugin_id = "dev.example.hello-world";
        assert!(
            validate_plugin_capability(plugin_id, "plugin.dev.example.hello-world.greet").is_ok()
        );
        for bad in [
            "plugin.dev.example.hello-world.do-thing",
            "plugin.dev.example.hello-world.",
            "plugin.dev.example.hello-world..x",
            "plugin.dev.example.hello.world.greet",
            "plugin.dev.example.hello-world.audit",
        ] {
            assert!(
                validate_plugin_capability(plugin_id, bad).is_err(),
                "`{bad}` must be rejected"
            );
        }
    }

    #[test]
    fn manifest_with_builtin_and_own_capabilities_validates() {
        let manifest = manifest_with_commands(
            "dev.example.k8s-pods",
            vec![
                "ui.panel".into(),
                "plugin.dev.example.k8s-pods.restart_pod".into(),
            ],
            vec![],
        );
        assert_eq!(validate_plugin_manifest(&manifest), Ok(()));
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

    // ── Shared vectors, judged alike by manifestRules.ts ──

    /// The verdict an install gives a manifest: it parses, passes the manifest's
    /// own checks, has no reserved id, and passes install validation.
    fn install_verdict(manifest: &serde_json::Value, forbidden: &[String]) -> Result<(), String> {
        let manifest: PluginManifest =
            serde_json::from_value(manifest.clone()).map_err(|e| e.to_string())?;
        manifest.validate().map_err(|e| e.to_string())?;
        if manifest.has_reserved_prefix() {
            return Err("reserved plugin_id prefix".into());
        }
        validate_plugin_manifest_for_host(&manifest, forbidden).map_err(|e| e.to_string())
    }

    #[test]
    fn shared_manifest_vectors() {
        let doc: serde_json::Value =
            serde_json::from_str(include_str!("../../../protocol/manifest-vectors.json"))
                .expect("manifest-vectors.json is JSON");
        let forbidden: Vec<String> = serde_json::from_value(doc["forbiddenOrigins"].clone())
            .expect("forbiddenOrigins is a list of strings");
        let vectors = doc["vectors"].as_array().expect("vectors is a list");
        assert!(vectors.len() > 50);
        for vector in vectors {
            let name = vector["name"].as_str().expect("each vector has a name");
            let valid = vector["valid"]
                .as_bool()
                .expect("each vector has a verdict");
            let verdict = install_verdict(&vector["manifest"], &forbidden);
            assert_eq!(verdict.is_ok(), valid, "{name}: {verdict:?}");
        }
    }

    #[test]
    fn network_origin_sites_drop_the_default_port() {
        let origin = parse_network_origin("https://api.example.com:443").unwrap();
        assert_eq!(origin.site(), "api.example.com");
        let origin = parse_network_origin("wss://stream.example.com:8443").unwrap();
        assert_eq!(origin.scheme, "wss");
        assert_eq!(origin.site(), "stream.example.com:8443");
    }
}
