//! Install-time plugin manifest validation: capability names and the
//! capabilities commands require, the install-ID leak check on AI-callable
//! commands, the rules of each runtime kind, and the `settings_schema` rules,
//! which also check a value the user saves for a setting.

use crate::plugin_host::capability::{
    BUILTIN_CAPABILITIES, ENCRYPTED_CHAT_CAPABILITIES, NETWORK_FETCH,
};
use crate::plugin_host::manifest::{ManifestCommand, PluginManifest, RuntimeKind, SettingSchema};
use crate::plugin_host::storage::is_storage_key;

/// How many origins `network_origins` may list.
pub const MAX_NETWORK_ORIGINS: usize = 16;
/// Capabilities a `WebSandboxed` plugin can never hold, because the browser
/// gives it no programs and no files.
const LOCAL_ONLY_CAPABILITIES: &[&str] = &["local.process", "fs.read", "fs.write"];
/// Longest bundle path, in bytes.
pub const MAX_BUNDLE_PATH_LEN: usize = 255;
/// The value types a `settings_schema` entry may declare.
pub const SETTING_VALUE_TYPES: &[&str] = &["string", "boolean", "integer", "path", "enum"];
/// Largest magnitude of an `integer` setting, its bounds and its default: 2^53 - 1,
/// which every JSON reader holds exactly.
pub const MAX_SETTING_INTEGER: i64 = (1 << 53) - 1;
/// The context kinds a command's `required_context` can name, and the arguments
/// the host adds to the command's `args` for each.
const CONTEXT_ARGUMENTS: &[(&str, &[&str])] = &[
    ("workspace", &["workspace_id"]),
    ("conversation", &["conversation_id", "thread_id"]),
    ("message", &["message_id", "conversation_id", "thread_id"]),
];

/// Why a manifest failed install validation, serialized with a `kind` tag so
/// the UI can branch on the variant without parsing the message.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind")]
pub enum ValidationError {
    /// A capability in `capabilities` or a command's `required_capabilities`
    /// that is not a built-in name the plugin's kind may hold, or an encrypted
    /// chat capability declared without its plain one.
    #[serde(rename = "INVALID_CAPABILITY_KEY")]
    InvalidCapabilityKey { key: String, reason: String },
    /// A command requires a capability the manifest's `capabilities` does not
    /// declare, so the permission prompt never offers it and the command could
    /// never run.
    #[serde(rename = "UNDECLARED_CAPABILITY")]
    UndeclaredCapability { command_id: String, key: String },
    /// An `ai_callable` command's `output_schema` declares a field
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
    /// A `settings_schema` entry breaks a rule of its fields, named by its
    /// position and its key.
    #[serde(rename = "INVALID_SETTINGS_SCHEMA")]
    InvalidSettingsSchema {
        index: usize,
        key: String,
        reason: String,
    },
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidCapabilityKey { key, reason } => {
                write!(f, "invalid capability key `{key}`: {reason}")
            }
            Self::UndeclaredCapability { command_id, key } => write!(
                f,
                "command `{command_id}` requires capability `{key}`, which the manifest's \
                 capabilities do not declare"
            ),
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
            Self::InvalidSettingsSchema { index, key, reason } => {
                write!(f, "invalid settings_schema[{index}] `{key}`: {reason}")
            }
        }
    }
}

impl std::error::Error for ValidationError {}

/// Validates one capability name of a `DesktopLocalProcess` plugin; see
/// [`validate_capability`].
///
/// # Errors
///
/// Returns [`ValidationError::InvalidCapabilityKey`] when the name is refused.
#[cfg(test)]
pub fn validate_plugin_capability(capability_key: &str) -> Result<(), ValidationError> {
    validate_capability(RuntimeKind::DesktopLocalProcess, capability_key)
}

/// Validates one capability name a plugin of `kind` declares or a command of it
/// requires.
///
/// The names are the built-in ones in [`BUILTIN_CAPABILITIES`], and
/// [`NETWORK_FETCH`] for a `WebSandboxed` plugin: the permission prompt offers
/// only those, so any other name could never be approved.
///
/// # Errors
///
/// Returns [`ValidationError::InvalidCapabilityKey`] for any other name, saying
/// why a `WebSandboxed` plugin can never hold the names of local programs, files
/// and host-brokered requests, and why a `plugin.`-prefixed key is refused.
pub fn validate_capability(kind: RuntimeKind, capability_key: &str) -> Result<(), ValidationError> {
    let reject = |reason: String| {
        Err(ValidationError::InvalidCapabilityKey {
            key: capability_key.to_string(),
            reason,
        })
    };

    if BUILTIN_CAPABILITIES.contains(&capability_key) {
        return Ok(());
    }
    if capability_key == NETWORK_FETCH {
        return match kind {
            RuntimeKind::WebSandboxed => Ok(()),
            RuntimeKind::DesktopLocalProcess => reject(
                "network.fetch is for WebSandboxed plugins; a local process reaches the \
                 network on its own"
                    .into(),
            ),
        };
    }
    if kind == RuntimeKind::WebSandboxed {
        if LOCAL_ONLY_CAPABILITIES.contains(&capability_key) {
            return reject(
                "WebSandboxed plugins cannot run programs or read files; use DesktopLocalProcess"
                    .into(),
            );
        }
        if capability_key == "network" {
            return reject(
                "network names host-brokered requests for local processes; a WebSandboxed \
                 plugin asks for network.fetch"
                    .into(),
            );
        }
    }

    let mut allowed = BUILTIN_CAPABILITIES.join(", ");
    if kind == RuntimeKind::WebSandboxed {
        allowed.push_str(", ");
        allowed.push_str(NETWORK_FETCH);
    }
    if capability_key.starts_with("plugin.") {
        return reject(format!(
            "plugin-scoped capability keys are not supported, since the permission prompt \
             cannot approve them; a manifest names only built-in capabilities: {allowed}"
        ));
    }
    reject(format!(
        "not a built-in capability; a manifest names only built-in capabilities: {allowed}"
    ))
}

/// Validates every command's `required_capabilities`: each is a name
/// [`validate_capability`] accepts and one the manifest's `capabilities`
/// declares.
///
/// # Errors
///
/// Returns [`ValidationError::InvalidCapabilityKey`] for a name that is not
/// built-in, its reason naming the command, and
/// [`ValidationError::UndeclaredCapability`] for one missing from
/// `capabilities`.
fn validate_required_capabilities(manifest: &PluginManifest) -> Result<(), ValidationError> {
    for command in &manifest.commands {
        for key in &command.required_capabilities {
            validate_capability(manifest.runtime_kind, key).map_err(|error| match error {
                ValidationError::InvalidCapabilityKey { key, reason } => {
                    ValidationError::InvalidCapabilityKey {
                        key,
                        reason: format!("required by command `{}`: {reason}", command.id),
                    }
                }
                other => other,
            })?;
            if !manifest.capabilities.contains(key) {
                return Err(ValidationError::UndeclaredCapability {
                    command_id: command.id.clone(),
                    key: key.clone(),
                });
            }
        }
    }
    Ok(())
}

/// Refuses an encrypted chat capability declared without its plain one, which it
/// widens to encrypted conversations.
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

/// Refuses a command that declares an argument the host sets from a context it
/// requires.
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

/// Checks the `output_schema` of every `ai_callable` command for a field that
/// would leak the install ID.
///
/// # Errors
///
/// Returns [`ValidationError::InstallIdLeakInAiSurface`] when a schema declares
/// an install-ID field, and [`ValidationError::RequiresManualReview`] when a
/// schema is missing or too opaque to analyse.
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

/// Parses one `network_origins` entry: `https://host[:port]` or
/// `wss://host[:port]`, lowercase, with no path, query, fragment, userinfo or
/// wildcard.
///
/// # Errors
///
/// Returns a message naming the entry when it breaks any of those rules.
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

/// Checks the `network_origins` rules: only for `WebSandboxed`, present exactly
/// when `network.fetch` is declared, 1 to 16 well-formed origins, no
/// duplicates, and none on the host and port of a `forbidden_origins` entry
/// (the app's and the RIM API's origins).
///
/// # Errors
///
/// Returns [`ValidationError::InvalidNetworkOrigins`] naming the broken rule.
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

/// Checks the `WebSandboxed` file rules a manifest can state: the entrypoint is
/// a bundle path to one ES module, and each panel id names a folder.
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

/// Whether `number` lies within ±[`MAX_SETTING_INTEGER`].
fn is_setting_integer(number: i64) -> bool {
    (-MAX_SETTING_INTEGER..=MAX_SETTING_INTEGER).contains(&number)
}

/// Why `value` cannot be the value of `setting`, or `None` when it can: a JSON
/// string for `string` and `path`, `true` or `false` for `boolean`, an integer
/// of at most 2^53 - 1 in magnitude within `min` and `max` for `integer`, and
/// one of `options` for `enum`.
pub fn setting_value_error(setting: &SettingSchema, value: &serde_json::Value) -> Option<String> {
    match setting.value_type.as_str() {
        "string" | "path" if !value.is_string() => Some("must be a string".into()),
        "boolean" if !value.is_boolean() => Some("must be true or false".into()),
        "integer" => {
            let Some(number) = value.as_i64() else {
                return Some("must be an integer".into());
            };
            if !is_setting_integer(number) {
                return Some("must lie between -(2^53 - 1) and 2^53 - 1".into());
            }
            if let Some(min) = setting.min.filter(|min| number < *min) {
                return Some(format!("must be at least {min}"));
            }
            if let Some(max) = setting.max.filter(|max| number > *max) {
                return Some(format!("must be at most {max}"));
            }
            None
        }
        "enum" => {
            let options = setting.options.as_deref().unwrap_or_default();
            match value.as_str() {
                Some(choice) if options.iter().any(|o| o == choice) => None,
                _ => Some(format!("must be one of: {}", options.join(", "))),
            }
        }
        "string" | "path" | "boolean" => None,
        other => Some(format!("has the unsupported value_type `{other}`")),
    }
}

/// Checks every `settings_schema` entry: a storage-key `key` unique in the
/// manifest, a non-empty `title`, a known `value_type`, `is_secret` only on a
/// `string` without a `default`, `min` and `max` only on an `integer` and in
/// order, `options` exactly on an `enum`, non-empty and without duplicates,
/// `placeholder` only on `string`, `path` and `integer`, integers of at most
/// 2^53 - 1 in magnitude, and a `default` the setting accepts as a value.
///
/// # Errors
///
/// Returns [`ValidationError::InvalidSettingsSchema`] for the first entry that
/// breaks a rule, naming the rule.
pub fn validate_settings_schema(settings: &[SettingSchema]) -> Result<(), ValidationError> {
    let mut keys = std::collections::HashSet::new();
    for (index, setting) in settings.iter().enumerate() {
        let reject = |reason: String| {
            Err(ValidationError::InvalidSettingsSchema {
                index,
                key: setting.key.clone(),
                reason,
            })
        };
        let value_type = setting.value_type.as_str();
        if !is_storage_key(&setting.key) {
            return reject("key must be 1 to 128 characters of A-Z a-z 0-9 . _ -".into());
        }
        if !keys.insert(setting.key.as_str()) {
            return reject("key is declared twice".into());
        }
        if setting.title.is_empty() {
            return reject("title must not be empty".into());
        }
        if !SETTING_VALUE_TYPES.contains(&value_type) {
            return reject(format!(
                "value_type must be one of {}",
                SETTING_VALUE_TYPES.join(", ")
            ));
        }
        if setting.is_secret && value_type != "string" {
            return reject("is_secret is allowed only with value_type string".into());
        }
        if setting.is_secret && setting.default.is_some() {
            return reject("a secret setting may not have a default".into());
        }
        if (setting.min.is_some() || setting.max.is_some()) && value_type != "integer" {
            return reject("min and max are allowed only with value_type integer".into());
        }
        for (name, bound) in [("min", setting.min), ("max", setting.max)] {
            if bound.is_some_and(|b| !is_setting_integer(b)) {
                return reject(format!("{name} must lie between -(2^53 - 1) and 2^53 - 1"));
            }
        }
        if let (Some(min), Some(max)) = (setting.min, setting.max) {
            if min > max {
                return reject("min must be at most max".into());
            }
        }
        match (&setting.options, value_type == "enum") {
            (None, true) => return reject("an enum setting needs options".into()),
            (Some(_), false) => {
                return reject("options are allowed only with value_type enum".into())
            }
            (Some(options), true) => {
                if options.is_empty() {
                    return reject("options must list at least one value".into());
                }
                let mut seen = std::collections::HashSet::new();
                if let Some(twice) = options.iter().find(|o| !seen.insert(o.as_str())) {
                    return reject(format!("options lists `{twice}` twice"));
                }
            }
            (None, false) => {}
        }
        if setting.placeholder.is_some() && !matches!(value_type, "string" | "path" | "integer") {
            return reject(
                "placeholder is allowed only with value_type string, path or integer".into(),
            );
        }
        if let Some(reason) = setting
            .default
            .as_ref()
            .and_then(|default| setting_value_error(setting, default))
        {
            return reject(format!("default {reason}"));
        }
    }
    Ok(())
}

/// Validates a manifest for install: built-in capability names, commands that
/// require only declared capabilities, the install-ID leak check, the kind's
/// rules and the `settings_schema` rules, with no host origins to refuse.
///
/// # Errors
///
/// Returns the first [`ValidationError`] the manifest fails.
pub fn validate_plugin_manifest(manifest: &PluginManifest) -> Result<(), ValidationError> {
    validate_plugin_manifest_for_host(manifest, &[])
}

/// [`validate_plugin_manifest`], also refusing `network_origins` on the host
/// and port of one of `forbidden_origins`.
///
/// # Errors
///
/// Returns the first [`ValidationError`] the manifest fails.
pub fn validate_plugin_manifest_for_host(
    manifest: &PluginManifest,
    forbidden_origins: &[String],
) -> Result<(), ValidationError> {
    for cap in &manifest.capabilities {
        validate_capability(manifest.runtime_kind, cap)?;
    }
    validate_encrypted_chat(manifest)?;
    validate_required_capabilities(manifest)?;
    validate_network_origins(manifest, forbidden_origins)?;
    if manifest.runtime_kind == RuntimeKind::WebSandboxed {
        validate_web_layout(manifest)?;
    }
    validate_context_arguments(&manifest.commands)?;
    validate_settings_schema(&manifest.settings_schema)?;
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

    // ── capability names: validate_plugin_capability ──

    #[test]
    fn capability_key_accepts_builtin_capabilities() {
        for cap in BUILTIN_CAPABILITIES {
            let result = validate_plugin_capability(cap);
            assert!(result.is_ok(), "`{cap}` should be accepted: {result:?}");
        }
    }

    #[test]
    fn capability_key_rejects_names_that_are_not_builtin() {
        for bad in [
            "*",
            "",
            "foo bar",
            "system.evil",
            "local.process",
            "network",
            "fs.read",
            "fs.write",
            "events.read",
            "chat.admin",
            "chat.read.all",
            "CHAT.READ",
            "ui",
        ] {
            let result = validate_plugin_capability(bad);
            assert!(
                matches!(result, Err(ValidationError::InvalidCapabilityKey { .. })),
                "`{bad}` must be rejected: {result:?}"
            );
        }
    }

    #[test]
    fn capability_key_rejects_plugin_scoped_keys() {
        for bad in [
            "plugin.dev.example.tool.read",
            "plugin.dev.example.other.read",
        ] {
            let err = validate_plugin_capability(bad).unwrap_err();
            assert_eq!(
                err.to_string(),
                format!(
                    "invalid capability key `{bad}`: plugin-scoped capability keys are not \
                     supported, since the permission prompt cannot approve them; a manifest \
                     names only built-in capabilities: ui.panel, ui.notify, chat.read, \
                     chat.write, chat.read.encrypted, chat.write.encrypted"
                )
            );
        }
    }

    #[test]
    fn capability_key_error_lists_network_fetch_for_web_plugins() {
        let err = validate_capability(RuntimeKind::WebSandboxed, "events.read").unwrap_err();
        assert_eq!(
            err.to_string(),
            "invalid capability key `events.read`: not a built-in capability; a manifest names \
             only built-in capabilities: ui.panel, ui.notify, chat.read, chat.write, \
             chat.read.encrypted, chat.write.encrypted, network.fetch"
        );
    }

    #[test]
    fn manifest_with_a_plugin_scoped_capability_is_refused() {
        let manifest = manifest_with_commands(
            "dev.example.k8s-pods",
            vec![
                "ui.panel".into(),
                "plugin.dev.example.k8s-pods.restart_pod".into(),
            ],
            vec![],
        );
        let err = validate_plugin_manifest(&manifest).unwrap_err();
        assert!(
            matches!(&err, ValidationError::InvalidCapabilityKey { key, .. }
                if key == "plugin.dev.example.k8s-pods.restart_pod"),
            "{err:?}"
        );
    }

    #[test]
    fn capability_key_error_includes_offending_key_for_diagnostics() {
        let err = validate_plugin_capability("*").unwrap_err();
        match err {
            ValidationError::InvalidCapabilityKey { key, .. } => assert_eq!(key, "*"),
            other => panic!("expected InvalidCapabilityKey, got {other:?}"),
        }
    }

    // ── required_capabilities ──

    fn requiring(id: &str, required: &[&str]) -> ManifestCommand {
        let mut command = ai_command(id, false, None);
        command.required_capabilities = required.iter().map(|c| c.to_string()).collect();
        command
    }

    #[test]
    fn required_capabilities_within_capabilities_validate() {
        let manifest = manifest_with_commands(
            "dev.example.poll",
            vec!["chat.read".into(), "chat.write".into()],
            vec![
                requiring("vote", &["chat.read", "chat.write"]),
                requiring("results", &["chat.read"]),
                requiring("help", &[]),
            ],
        );
        assert_eq!(validate_plugin_manifest(&manifest), Ok(()));
    }

    #[test]
    fn required_capability_that_is_not_builtin_is_refused() {
        let manifest = manifest_with_commands(
            "dev.example.tool",
            vec!["chat.read".into()],
            vec![requiring("read", &["plugin.dev.example.tool.read"])],
        );
        let err = validate_plugin_manifest(&manifest).unwrap_err();
        assert!(
            matches!(&err, ValidationError::InvalidCapabilityKey { key, .. }
                if key == "plugin.dev.example.tool.read"),
            "{err:?}"
        );
        assert_eq!(
            err.to_string(),
            "invalid capability key `plugin.dev.example.tool.read`: required by command `read`: \
             plugin-scoped capability keys are not supported, since the permission prompt \
             cannot approve them; a manifest names only built-in capabilities: ui.panel, \
             ui.notify, chat.read, chat.write, chat.read.encrypted, chat.write.encrypted"
        );
    }

    #[test]
    fn required_capability_missing_from_capabilities_is_refused() {
        let manifest = manifest_with_commands(
            "dev.example.poll",
            vec!["chat.read".into()],
            vec![
                requiring("results", &["chat.read"]),
                requiring("post", &["chat.read", "chat.write"]),
            ],
        );
        let err = validate_plugin_manifest(&manifest).unwrap_err();
        assert_eq!(
            err,
            ValidationError::UndeclaredCapability {
                command_id: "post".into(),
                key: "chat.write".into(),
            }
        );
        assert_eq!(
            err.to_string(),
            "command `post` requires capability `chat.write`, which the manifest's \
             capabilities do not declare"
        );
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({
                "kind": "UNDECLARED_CAPABILITY",
                "command_id": "post",
                "key": "chat.write",
            })
        );
    }

    #[test]
    fn web_plugin_command_may_require_network_fetch_it_declares() {
        let mut manifest = manifest_with_commands(
            "dev.example.web",
            vec!["network.fetch".into()],
            vec![requiring("refresh", &["network.fetch"])],
        );
        manifest.runtime_kind = RuntimeKind::WebSandboxed;
        manifest.entrypoint = "main.mjs".into();
        manifest.network_origins = Some(vec!["https://api.example.com".into()]);
        assert_eq!(validate_plugin_manifest(&manifest), Ok(()));
    }

    // ── install-ID leak: walk_output_schema_for_install_id_leak ──

    #[test]
    fn install_id_leak_no_ai_callable_commands_passes() {
        let m = manifest_with_commands("self", vec![], vec![ai_command("safe.cmd", false, None)]);
        assert!(walk_output_schema_for_install_id_leak(&m.commands).is_ok());
    }

    #[test]
    fn install_id_leak_ai_callable_without_schema_requires_manual_review() {
        let m = manifest_with_commands("self", vec![], vec![ai_command("opaque.cmd", true, None)]);
        let err = walk_output_schema_for_install_id_leak(&m.commands).unwrap_err();
        assert!(matches!(err, ValidationError::RequiresManualReview { .. }));
    }

    #[test]
    fn install_id_leak_ai_callable_with_typed_clean_schema_passes() {
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
    fn install_id_leak_ai_callable_with_leak_rejects() {
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
    fn install_id_leak_detects_nested_leak() {
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
    fn install_id_leak_detects_case_insensitive_variants() {
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
    fn install_id_leak_detects_camel_and_kebab_case_variants() {
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
    fn install_id_leak_ignores_legitimate_installer_fields() {
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
    fn install_id_leak_detects_under_array_items_object_form() {
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
    fn install_id_leak_detects_under_array_items_tuple_form() {
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
    fn install_id_leak_detects_under_one_of_branch() {
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
    fn install_id_leak_detects_under_any_of_branch() {
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
    fn install_id_leak_detects_under_all_of_branch() {
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
    fn install_id_leak_detects_under_dollar_defs() {
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
    fn install_id_leak_detects_named_dollar_def_key() {
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
    fn install_id_leak_root_oneof_without_properties_is_walked_not_escalated() {
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
    fn install_id_leak_open_additional_properties_requires_manual_review() {
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
    fn install_id_leak_non_object_root_requires_manual_review() {
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
    fn install_id_leak_non_ai_command_with_install_id_field_passes() {
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
            vec!["chat.read".to_string()],
            vec![ai_command("c", true, Some(clean_schema))],
        );
        assert!(validate_plugin_manifest(&m).is_ok());
    }

    #[test]
    fn orchestrator_rejects_install_id_leak_when_caps_are_clean() {
        let leaky_schema = serde_json::json!({
            "type": "object",
            "properties": { "plugin_install_id": { "type": "string" } }
        });
        let m = manifest_with_commands(
            "self",
            vec!["chat.read".to_string()],
            vec![ai_command("leaky.cmd", true, Some(leaky_schema))],
        );
        assert!(matches!(
            validate_plugin_manifest(&m),
            Err(ValidationError::InstallIdLeakInAiSurface { .. })
        ));
    }

    #[test]
    fn a_broken_setting_is_refused_with_its_position_and_key() {
        let mut m = manifest_with_commands("dev.example.pods", vec![], vec![]);
        m.settings_schema = serde_json::from_value(serde_json::json!([
            { "key": "namespace", "title": "Namespace", "value_type": "string" },
            { "key": "refresh", "title": "Refresh", "value_type": "integer", "min": 5, "default": 1 }
        ]))
        .unwrap();
        let error = validate_plugin_manifest(&m).unwrap_err();
        assert_eq!(
            error,
            ValidationError::InvalidSettingsSchema {
                index: 1,
                key: "refresh".into(),
                reason: "default must be at least 5".into(),
            }
        );
        assert_eq!(
            error.to_string(),
            "invalid settings_schema[1] `refresh`: default must be at least 5"
        );
        assert_eq!(
            serde_json::to_value(&error).unwrap()["kind"],
            "INVALID_SETTINGS_SCHEMA"
        );
    }

    #[test]
    fn setting_values_are_checked_by_type_bounds_and_options() {
        let setting =
            |v: serde_json::Value| -> SettingSchema { serde_json::from_value(v).unwrap() };
        let integer = setting(serde_json::json!({
            "key": "n", "title": "N", "value_type": "integer", "min": -3, "max": 3
        }));
        assert_eq!(setting_value_error(&integer, &serde_json::json!(3)), None);
        assert_eq!(
            setting_value_error(&integer, &serde_json::json!(-4)).as_deref(),
            Some("must be at least -3")
        );
        assert_eq!(
            setting_value_error(&integer, &serde_json::json!(i64::MIN)).as_deref(),
            Some("must lie between -(2^53 - 1) and 2^53 - 1")
        );
        let choice = setting(serde_json::json!({
            "key": "c", "title": "C", "value_type": "enum", "options": ["a", "b"]
        }));
        assert_eq!(setting_value_error(&choice, &serde_json::json!("b")), None);
        assert!(setting_value_error(&choice, &serde_json::json!("c")).is_some());
        let unknown =
            setting(serde_json::json!({ "key": "u", "title": "U", "value_type": "number" }));
        assert!(setting_value_error(&unknown, &serde_json::json!(1)).is_some());
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
        let builtin: Vec<String> = serde_json::from_value(doc["builtinCapabilities"].clone())
            .expect("builtinCapabilities is a list of strings");
        assert_eq!(builtin, BUILTIN_CAPABILITIES);
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
