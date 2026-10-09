//! Plugin manifest statements: a publisher's identity key signing the exact `rim-plugin.json`
//! of one plugin version and where its code comes from (a bundle's SHA-256 and size, or a git
//! commit and the SHA-256 of its tree).
//!
//! Verification follows the server's `rim_identity::plugin_manifest` rule for rule and message
//! for message: the field rules, then the publisher's key log, the entry at `keySeq` and its
//! identity key's signature over `rim.plugin-manifest.v1\0 || payload`. A recovery rotation after
//! `keySeq` leaves the signature valid but the statement withdrawn ([`Validity`]).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::statement::{self, context, KeyHead, RotationSigner, SecretKey, Statement};
use super::KeyIdentityError;

/// Largest payload, in bytes.
pub(crate) const MAX_PAYLOAD_LEN: usize = 96 * 1024;
/// Longest `publisherName`, in characters.
pub(crate) const MAX_PUBLISHER_NAME_CHARS: usize = 80;
/// Longest plugin `version`, in characters.
pub(crate) const MAX_PLUGIN_VERSION_CHARS: usize = 64;
/// Largest embedded `manifest`, in bytes.
pub(crate) const MAX_MANIFEST_LEN: usize = 64 * 1024;
/// Largest bundle a `bundle` source may name, in bytes.
pub(crate) const MAX_BUNDLE_SIZE: u64 = 8 * 1024 * 1024;
/// Longest `git` source URL, in bytes.
pub(crate) const MAX_GIT_URL_LEN: usize = 2048;

/// One entry of a replayed key log: the identity key it made current and who signed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyHistoryEntry {
    pub(crate) seq: u32,
    pub(crate) identity_key: String,
    /// `None` for the inception.
    pub(crate) signer: Option<RotationSigner>,
}

/// A key log verified from its inception to its head, keeping every entry's identity key and
/// signer, so a statement signed under an older entry can be checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyHistory {
    principal_id: String,
    entries: Vec<KeyHistoryEntry>,
}

impl KeyHistory {
    /// Verify a whole log, oldest entry first.
    pub(crate) fn replay(log: &[Statement]) -> Result<Self, KeyIdentityError> {
        Ok(Self::from_head(&statement::replay(log)?))
    }

    pub(crate) fn from_head(head: &KeyHead) -> Self {
        let entries = head
            .identity_keys
            .iter()
            .zip(&head.signers)
            .enumerate()
            .map(|(seq, (identity_key, signer))| KeyHistoryEntry {
                seq: seq as u32,
                identity_key: identity_key.clone(),
                signer: *signer,
            })
            .collect();
        Self {
            principal_id: head.principal_id.clone(),
            entries,
        }
    }

    pub(crate) fn principal_id(&self) -> &str {
        &self.principal_id
    }

    pub(crate) fn entry(&self, seq: u32) -> Option<&KeyHistoryEntry> {
        self.entries.get(seq as usize)
    }

    /// The seq of the first recovery rotation after entry `seq`, if there is one.
    pub(crate) fn recovery_after(&self, seq: u32) -> Option<u32> {
        self.entries
            .iter()
            .skip(seq as usize + 1)
            .find(|e| e.signer == Some(RotationSigner::Recovery))
            .map(|e| e.seq)
    }
}

/// The two kinds of plugin a manifest's `runtime_kind` names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum PluginRuntimeKind {
    DesktopLocalProcess,
    WebSandboxed,
}

impl PluginRuntimeKind {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "DesktopLocalProcess" => Some(Self::DesktopLocalProcess),
            "WebSandboxed" => Some(Self::WebSandboxed),
            _ => None,
        }
    }
}

/// Where the signed plugin's code comes from, written into the payload in this field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum PluginSource {
    /// A bundle file: its SHA-256 as lowercase hex, and its length in bytes.
    Bundle { sha256: String, size: u64 },
    /// A git commit, and the SHA-256 of its tree's files as lowercase hex.
    #[serde(rename_all = "camelCase")]
    Git {
        url: String,
        commit: String,
        tree_sha256: String,
    },
}

/// A plugin manifest statement whose fields passed every rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifestStatement {
    pub(crate) principal_id: String,
    pub(crate) key_seq: u32,
    /// Trimmed. Chosen by the publisher, so it proves nothing about who they are.
    pub(crate) publisher_name: String,
    pub(crate) plugin_id: String,
    pub(crate) version: String,
    /// The exact text of `rim-plugin.json`.
    pub(crate) manifest: String,
    pub(crate) display_name: String,
    pub(crate) runtime_kind: PluginRuntimeKind,
    pub(crate) source: PluginSource,
    pub(crate) issued_at: String,
}

/// Whether a verified statement still stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum Validity {
    Valid,
    /// The key log entry at `at_seq`, after the statement's `keySeq`, is a recovery rotation.
    #[serde(rename_all = "camelCase")]
    PublisherRecovered {
        at_seq: u32,
    },
}

/// A verified statement and whether it still stands, as the webview receives it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedPluginManifest {
    pub(crate) statement: PluginManifestStatement,
    pub(crate) validity: Validity,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawSource {
    kind: String,
    sha256: Option<String>,
    size: Option<u64>,
    url: Option<String>,
    commit: Option<String>,
    tree_sha256: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawPluginManifest {
    v: u32,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    key_seq: u32,
    publisher_name: String,
    plugin_id: String,
    version: String,
    manifest: String,
    source: RawSource,
    issued_at: DateTime<Utc>,
}

/// The manifest fields a statement is checked against. Other fields are the host's.
#[derive(Deserialize)]
struct ManifestHead {
    #[serde(rename = "manifest_version")]
    _manifest_version: u64,
    plugin_id: String,
    display_name: String,
    version: String,
    runtime_kind: String,
}

fn invalid(message: impl Into<String>) -> KeyIdentityError {
    KeyIdentityError::Invalid(message.into())
}

fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn check_git_url(url: &str) -> Result<(), KeyIdentityError> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("ssh://"));
    let ok = rest.is_some_and(|r| !r.is_empty())
        && url.len() <= MAX_GIT_URL_LEN
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if !ok {
        return Err(invalid(format!(
            "source.url must be an https:// or ssh:// URL of at most {MAX_GIT_URL_LEN} bytes"
        )));
    }
    Ok(())
}

fn read_source(raw: RawSource) -> Result<PluginSource, KeyIdentityError> {
    match raw {
        RawSource {
            kind,
            sha256: Some(sha256),
            size: Some(size),
            url: None,
            commit: None,
            tree_sha256: None,
        } if kind == "bundle" => {
            if !is_lower_hex(&sha256, 64) {
                return Err(invalid("source.sha256 must be 64 lowercase hex characters"));
            }
            if !(1..=MAX_BUNDLE_SIZE).contains(&size) {
                return Err(invalid(format!(
                    "source.size must be 1 to {MAX_BUNDLE_SIZE}"
                )));
            }
            Ok(PluginSource::Bundle { sha256, size })
        }
        RawSource {
            kind,
            sha256: None,
            size: None,
            url: Some(url),
            commit: Some(commit),
            tree_sha256: Some(tree_sha256),
        } if kind == "git" => {
            check_git_url(&url)?;
            if !is_lower_hex(&commit, 40) && !is_lower_hex(&commit, 64) {
                return Err(invalid(
                    "source.commit must be 40 or 64 lowercase hex characters",
                ));
            }
            if !is_lower_hex(&tree_sha256, 64) {
                return Err(invalid(
                    "source.treeSha256 must be 64 lowercase hex characters",
                ));
            }
            Ok(PluginSource::Git {
                url,
                commit,
                tree_sha256,
            })
        }
        _ => Err(invalid(
            "source must be a bundle (sha256, size) or a git commit (url, commit, treeSha256)",
        )),
    }
}

fn read_manifest(manifest: &str) -> Result<ManifestHead, KeyIdentityError> {
    if manifest.len() > MAX_MANIFEST_LEN {
        return Err(invalid(format!(
            "manifest must be at most {MAX_MANIFEST_LEN} bytes"
        )));
    }
    // A struct also deserializes from a JSON array, so the object is checked by its first byte.
    if !manifest.trim_start().starts_with('{') {
        return Err(invalid("manifest must be a JSON object"));
    }
    serde_json::from_str(manifest).map_err(|e| invalid(format!("manifest is not valid: {e}")))
}

/// Trimmed, 1 to `max` characters, no control characters.
fn check_label(value: &str, field: &str, max: usize) -> Result<String, KeyIdentityError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max {
        return Err(invalid(format!("{field} must be 1 to {max} characters")));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(invalid(format!(
            "{field} must not contain control characters"
        )));
    }
    Ok(trimmed.to_string())
}

/// Read a plugin manifest statement and check every field rule, without its signature.
pub(crate) fn read_plugin_manifest(
    statement: &Statement,
) -> Result<PluginManifestStatement, KeyIdentityError> {
    let payload = &statement.payload;
    if payload.len() > MAX_PAYLOAD_LEN {
        return Err(invalid(format!(
            "statement payload exceeds {MAX_PAYLOAD_LEN} bytes"
        )));
    }
    let raw: RawPluginManifest = serde_json::from_str(payload)
        .map_err(|e| invalid(format!("statement payload is not valid: {e}")))?;
    if raw.v != 1 && raw.v != 2 {
        return Err(invalid(format!("unsupported statement version {}", raw.v)));
    }
    if raw.kind != "plugin-manifest" {
        return Err(invalid("expected a `plugin-manifest` statement"));
    }
    if raw.v != 2 {
        return Err(invalid("a plugin manifest must be a version 2 statement"));
    }
    let publisher_name = check_label(
        &raw.publisher_name,
        "publisherName",
        MAX_PUBLISHER_NAME_CHARS,
    )?;
    let head = read_manifest(&raw.manifest)?;
    if head.plugin_id != raw.plugin_id {
        return Err(invalid("pluginId does not match the manifest"));
    }
    if head.version != raw.version {
        return Err(invalid("version does not match the manifest"));
    }
    let version_chars = raw.version.chars().count();
    if !(1..=MAX_PLUGIN_VERSION_CHARS).contains(&version_chars) {
        return Err(invalid(format!(
            "version must be 1 to {MAX_PLUGIN_VERSION_CHARS} characters"
        )));
    }
    let runtime_kind = PluginRuntimeKind::from_name(&head.runtime_kind).ok_or_else(|| {
        invalid("the manifest's runtime_kind must be DesktopLocalProcess or WebSandboxed")
    })?;
    let source = read_source(raw.source)?;
    if runtime_kind == PluginRuntimeKind::WebSandboxed
        && !matches!(source, PluginSource::Bundle { .. })
    {
        return Err(invalid(
            "a WebSandboxed plugin must come with a bundle source",
        ));
    }
    Ok(PluginManifestStatement {
        principal_id: raw.principal_id,
        key_seq: raw.key_seq,
        publisher_name,
        plugin_id: raw.plugin_id,
        version: raw.version,
        manifest: raw.manifest,
        display_name: head.display_name,
        runtime_kind,
        source,
        issued_at: raw
            .issued_at
            .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
    })
}

/// Verify a plugin manifest statement against its publisher's key log: every field rule, the
/// log's principal, `keySeq` an entry of it and that entry's identity key's signature.
pub(crate) fn verify_plugin_manifest(
    history: &KeyHistory,
    statement: &Statement,
) -> Result<VerifiedPluginManifest, KeyIdentityError> {
    let parsed = read_plugin_manifest(statement)?;
    if parsed.principal_id != history.principal_id() {
        return Err(invalid("statement is for a different principal"));
    }
    let entry = history.entry(parsed.key_seq).ok_or_else(|| {
        invalid(format!(
            "keySeq {} is not an entry of the publisher's key log",
            parsed.key_seq
        ))
    })?;
    if !statement::verify(statement, context::PLUGIN_MANIFEST, &entry.identity_key, 2) {
        return Err(invalid("signature does not verify"));
    }
    let validity = match history.recovery_after(parsed.key_seq) {
        Some(at_seq) => Validity::PublisherRecovered { at_seq },
        None => Validity::Valid,
    };
    Ok(VerifiedPluginManifest {
        statement: parsed,
        validity,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Payload<'a> {
    v: u8,
    #[serde(rename = "type")]
    kind: &'a str,
    principal_id: &'a str,
    key_seq: u32,
    publisher_name: &'a str,
    plugin_id: &'a str,
    version: &'a str,
    manifest: &'a str,
    source: &'a PluginSource,
    issued_at: &'a str,
}

/// What the publisher chooses for a statement: the rest comes from the key log.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifestInput {
    pub(crate) publisher_name: String,
    /// The exact text of `rim-plugin.json`; `pluginId` and `version` are read from it.
    pub(crate) manifest: String,
    pub(crate) source: PluginSource,
}

/// Sign a plugin manifest statement with the identity key at `key_seq`, fields in the spec's
/// order, then check it with the verifier so nothing malformed leaves this device.
pub(crate) fn sign_plugin_manifest(
    identity: &SecretKey,
    head: &KeyHead,
    input: &PluginManifestInput,
    issued_at: &str,
) -> Result<Statement, KeyIdentityError> {
    let manifest = read_manifest(&input.manifest)?;
    let publisher_name = check_label(
        &input.publisher_name,
        "publisherName",
        MAX_PUBLISHER_NAME_CHARS,
    )?;
    let payload = serde_json::to_string(&Payload {
        v: 2,
        kind: "plugin-manifest",
        principal_id: &head.principal_id,
        key_seq: head.seq,
        publisher_name: &publisher_name,
        plugin_id: &manifest.plugin_id,
        version: &manifest.version,
        manifest: &input.manifest,
        source: &input.source,
        issued_at,
    })
    .map_err(|e| invalid(format!("statement could not be written: {e}")))?;
    let signed = identity.sign(context::PLUGIN_MANIFEST, payload);
    verify_plugin_manifest(&KeyHistory::from_head(head), &signed)?;
    Ok(signed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key_identity::statement::{inception, rotation, RotationSigner};
    use zeroize::Zeroizing;

    const SHA: &str = "5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85";
    const AT: &str = "2026-10-09T00:00:00Z";
    const RECOVERY: &str = "ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg";
    const PRINCIPAL: &str = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
    const KNOWN_PAYLOAD: &str = r#"{"v":2,"type":"plugin-manifest","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","keySeq":0,"publisherName":"Ada","pluginId":"dev.example.hello-web","version":"0.1.0","manifest":"{\"manifest_version\":1,\"plugin_id\":\"dev.example.hello-web\",\"display_name\":\"Hello Web\",\"version\":\"0.1.0\",\"description\":\"Says hello from a sandboxed frame.\",\"runtime_kind\":\"WebSandboxed\",\"entrypoint\":\"main.mjs\",\"commands\":[{\"id\":\"greet\",\"title\":\"Hello Web: Greet\",\"description\":\"Greets the signed-in user.\"}]}","source":{"kind":"bundle","sha256":"5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85","size":1605},"issuedAt":"2026-10-09T00:00:00Z"}"#;
    const KNOWN_SIGNATURE: &str = "ed25519:FRHxrYnev03jlVo484kL4PLh7GMArjEE4q1wiBNMSx7rD8CAis8YIivjSccshXkEdvYEw-wAIjzQgzDRj6kGCg";
    const MANIFEST: &str = r#"{"manifest_version":1,"plugin_id":"dev.example.hello-web","display_name":"Hello Web","version":"0.1.0","description":"Says hello from a sandboxed frame.","runtime_kind":"WebSandboxed","entrypoint":"main.mjs","commands":[{"id":"greet","title":"Hello Web: Greet","description":"Greets the signed-in user."}]}"#;

    fn key(n: u8) -> SecretKey {
        SecretKey::from_seed(Zeroizing::new([n; 32]))
    }

    fn known() -> Statement {
        Statement {
            payload: KNOWN_PAYLOAD.into(),
            signature: KNOWN_SIGNATURE.into(),
        }
    }

    fn log() -> Vec<Statement> {
        vec![inception(&key(1), RECOVERY, AT)]
    }

    fn history() -> KeyHistory {
        KeyHistory::replay(&log()).unwrap()
    }

    /// The known payload with one substitution, signed again by the identity key.
    fn resigned(from: &str, to: &str) -> Statement {
        key(1).sign(
            context::PLUGIN_MANIFEST,
            KNOWN_PAYLOAD.replacen(from, to, 1),
        )
    }

    fn refusal(statement: &Statement) -> String {
        verify_plugin_manifest(&history(), statement)
            .unwrap_err()
            .to_string()
    }

    #[test]
    fn known_answer_statement_verifies() {
        let verified = verify_plugin_manifest(&history(), &known()).unwrap();
        assert_eq!(verified.validity, Validity::Valid);
        let s = verified.statement;
        assert_eq!(s.principal_id, PRINCIPAL);
        assert_eq!(s.plugin_id, "dev.example.hello-web");
        assert_eq!(s.version, "0.1.0");
        assert_eq!(s.publisher_name, "Ada");
        assert_eq!(s.display_name, "Hello Web");
        assert_eq!(s.runtime_kind, PluginRuntimeKind::WebSandboxed);
        assert_eq!(s.manifest, MANIFEST);
        assert_eq!(
            s.source,
            PluginSource::Bundle {
                sha256: SHA.into(),
                size: 1605
            }
        );
    }

    #[test]
    fn signing_writes_the_known_payload_byte_for_byte() {
        let head = statement::replay(&log()).unwrap();
        let input = PluginManifestInput {
            publisher_name: " Ada ".into(),
            manifest: MANIFEST.into(),
            source: PluginSource::Bundle {
                sha256: SHA.into(),
                size: 1605,
            },
        };
        let signed = sign_plugin_manifest(&key(1), &head, &input, AT).unwrap();
        assert_eq!(signed.payload, KNOWN_PAYLOAD);
        assert_eq!(signed.signature, KNOWN_SIGNATURE);
    }

    #[test]
    fn step_1_refuses_a_malformed_statement() {
        assert!(refusal(&resigned(r#""v":2"#, r#""v":1"#)).contains("version 2 statement"));
        assert!(refusal(&resigned(r#""v":2"#, r#""v":3"#)).contains("unsupported statement"));
        assert!(refusal(&resigned("{", r#"{"extra":1,"#)).contains("unknown field"));
        assert!(refusal(&resigned("{", r#"{"publisherName":"Eve","#)).contains("duplicate field"));
        assert!(
            refusal(&resigned(r#""size":1605"#, r#""size":1605,"mirror":"x""#))
                .contains("unknown field")
        );
        assert!(refusal(&resigned("plugin-manifest", "profile-card")).contains("plugin-manifest"));
        let big = key(1).sign(
            context::PLUGIN_MANIFEST,
            format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_PAYLOAD_LEN)),
        );
        assert!(refusal(&big).contains("exceeds 98304 bytes"));
    }

    #[test]
    fn field_rules_match_the_server() {
        assert_eq!(
            refusal(&resigned(SHA, &SHA.to_uppercase())),
            "source.sha256 must be 64 lowercase hex characters"
        );
        for size in ["0", "8388609"] {
            assert_eq!(
                refusal(&resigned(r#""size":1605"#, &format!(r#""size":{size}"#))),
                "source.size must be 1 to 8388608"
            );
        }
        assert_eq!(
            refusal(&resigned(
                r#""pluginId":"dev.example.hello-web""#,
                r#""pluginId":"dev.example.other""#
            )),
            "pluginId does not match the manifest"
        );
        assert_eq!(
            refusal(&resigned(r#""version":"0.1.0""#, r#""version":"0.2.0""#)),
            "version does not match the manifest"
        );
        let git = format!(
            r#"{{"kind":"git","url":"https://github.com/acme/hello","commit":"{}","treeSha256":"{SHA}"}}"#,
            "a".repeat(40)
        );
        let bundle = format!(r#"{{"kind":"bundle","sha256":"{SHA}","size":1605}}"#);
        assert_eq!(
            refusal(&resigned(&bundle, &git)),
            "a WebSandboxed plugin must come with a bundle source"
        );
        let padding = "x".repeat(MAX_MANIFEST_LEN);
        let fat = resigned(
            r#""manifest":"{"#,
            &format!(r#""manifest":"{{\"description\":\"{padding}\","#),
        );
        assert_eq!(refusal(&fat), "manifest must be at most 65536 bytes");
        for name in ["  ", &"n".repeat(81), "A\\u0007"] {
            assert!(
                refusal(&resigned(r#""Ada""#, &format!("\"{name}\""))).contains("publisherName")
            );
        }
    }

    #[test]
    fn a_desktop_plugin_may_come_from_git() {
        let git = format!(
            r#"{{"kind":"git","url":"ssh://git@github.com/acme/hello","commit":"{}","treeSha256":"{SHA}"}}"#,
            "b".repeat(40)
        );
        let bundle = format!(r#"{{"kind":"bundle","sha256":"{SHA}","size":1605}}"#);
        let payload = KNOWN_PAYLOAD.replacen(&bundle, &git, 1).replacen(
            "WebSandboxed",
            "DesktopLocalProcess",
            1,
        );
        let statement = key(1).sign(context::PLUGIN_MANIFEST, payload);
        let verified = verify_plugin_manifest(&history(), &statement).unwrap();
        assert!(matches!(
            verified.statement.source,
            PluginSource::Git { .. }
        ));
    }

    #[test]
    fn step_2_refuses_another_principal() {
        let other = KeyHistory::replay(&[inception(&key(5), RECOVERY, AT)]).unwrap();
        assert_eq!(
            verify_plugin_manifest(&other, &known())
                .unwrap_err()
                .to_string(),
            "statement is for a different principal"
        );
    }

    #[test]
    fn step_3_refuses_a_missing_entry_or_a_bad_signature() {
        assert_eq!(
            refusal(&resigned(r#""keySeq":0"#, r#""keySeq":1"#)),
            "keySeq 1 is not an entry of the publisher's key log"
        );
        let flipped = Statement {
            payload: KNOWN_PAYLOAD.replace("\"Ada\"", "\"Adb\""),
            signature: KNOWN_SIGNATURE.into(),
        };
        assert_eq!(refusal(&flipped), "signature does not verify");
        let other_context = key(1).sign(context::KEY_LOG, KNOWN_PAYLOAD.into());
        assert_eq!(refusal(&other_context), "signature does not verify");
    }

    #[test]
    fn identity_rotation_keeps_it_valid_and_recovery_withdraws_it() {
        let mut log = log();
        let head = statement::replay(&log).unwrap();
        log.push(rotation(
            &head,
            RotationSigner::Identity,
            &key(1),
            &key(2).public_key(),
            AT,
        ));
        let history = KeyHistory::replay(&log).unwrap();
        let verified = verify_plugin_manifest(&history, &known()).unwrap();
        assert_eq!(verified.validity, Validity::Valid);

        let head = statement::replay(&log).unwrap();
        log.push(rotation(
            &head,
            RotationSigner::Recovery,
            &key(101),
            &key(3).public_key(),
            AT,
        ));
        let history = KeyHistory::replay(&log).unwrap();
        let verified = verify_plugin_manifest(&history, &known()).unwrap();
        assert_eq!(
            verified.validity,
            Validity::PublisherRecovered { at_seq: 2 }
        );
        assert_eq!(history.recovery_after(1), Some(2));
        assert_eq!(history.recovery_after(2), None);
        assert_eq!(
            serde_json::to_value(verified.validity).unwrap(),
            serde_json::json!({ "status": "publisherRecovered", "atSeq": 2 })
        );
    }
}
