//! Statements servers sign, as this app checks them: a server's key log and descriptor (its
//! discovery document), and the host-response and host-event statements a host signs for a
//! space this app uses through its relay. Version 2 only; unknown fields are refused and serde
//! refuses duplicate ones.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::key_identity::statement::{b64, canonical_key, unb64, verify, Statement};
use crate::key_identity::KeyIdentityError;

/// Context bytes of the statements servers sign.
pub(crate) mod context {
    pub(crate) const SERVER_KEY: &[u8] = b"rim.server-key.v1\0";
    pub(crate) const DESCRIPTOR: &[u8] = b"rim.server-descriptor.v1\0";
    pub(crate) const HOST_RESPONSE: &[u8] = b"rim.host-response.v1\0";
    pub(crate) const HOST_EVENT: &[u8] = b"rim.host-event.v1\0";
    pub(crate) const REVOCATION_ACK: &[u8] = b"rim.revocation-ack.v1\0";
}

const SERVER_DOMAIN: &[u8] = b"rim.server.v1\0";
const SERVER_PREFIX: &str = "rims1_";
const VERSION: u8 = 2;
const KIB: usize = 1024;
const MAX_LOG_ENTRIES: usize = 256;

type Result<T> = std::result::Result<T, KeyIdentityError>;

fn refused(what: &str, why: impl std::fmt::Display) -> KeyIdentityError {
    KeyIdentityError::Invalid(format!("{what}: {why}"))
}

fn bounded(statement: &Statement, max: usize, what: &str) -> Result<()> {
    if statement.payload.len() > max {
        return Err(refused(what, "too large"));
    }
    Ok(())
}

/// base64url(SHA-256(bytes)).
pub(crate) fn sha256_text(bytes: &[u8]) -> String {
    b64(&Sha256::digest(bytes))
}

/// The server id an inception payload fixes forever.
pub(crate) fn server_id(inception_payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(SERVER_DOMAIN);
    hasher.update(inception_payload.as_bytes());
    format!("{SERVER_PREFIX}{}", b64(&hasher.finalize()))
}

// ─── Server key log ──────────────────────────────────────────────────────────

/// Who signed a server key rotation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ServerSigner {
    Server,
    Recovery,
}

/// Where a verified server key log ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerHead {
    pub(crate) server_id: String,
    pub(crate) seq: u32,
    pub(crate) server_key: String,
    pub(crate) recovery_key: String,
    pub(crate) hash: String,
    /// The server key at every seq, oldest first.
    pub(crate) keys: Vec<String>,
    /// Who signed the entry at every seq; `None` for the inception.
    pub(crate) signers: Vec<Option<ServerSigner>>,
    /// base64url(SHA-256(payload)) of the entry at every seq.
    pub(crate) hashes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InceptionEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    seq: u32,
    server_key: String,
    recovery_key: String,
    #[allow(dead_code)]
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RotationEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    server_id: String,
    seq: u32,
    prev: String,
    server_key: String,
    recovery_key: String,
    signer: String,
    #[allow(dead_code)]
    created_at: chrono::DateTime<chrono::Utc>,
}

fn log_refused(why: impl std::fmt::Display) -> KeyIdentityError {
    refused("server key log", why)
}

fn log_key(text: &str) -> Result<String> {
    canonical_key(text, VERSION).map_err(|_| log_refused("a key is malformed"))
}

/// Verify a server's key log from its inception and return its head.
pub(crate) fn replay_server_log(log: &[Statement]) -> Result<ServerHead> {
    let (first, rest) = log.split_first().ok_or_else(|| log_refused("empty"))?;
    if log.len() > MAX_LOG_ENTRIES {
        return Err(log_refused("too long"));
    }
    bounded(first, 16 * KIB, "server key log")?;
    let entry: InceptionEntry = serde_json::from_str(&first.payload)
        .map_err(|_| log_refused("entry 0 is not a server key log entry"))?;
    if entry.v != VERSION || entry.kind != "server-inception" || entry.seq != 0 {
        return Err(log_refused("entry 0 is not an inception"));
    }
    let server_key = log_key(&entry.server_key)?;
    let recovery_key = log_key(&entry.recovery_key)?;
    if server_key == recovery_key {
        return Err(log_refused("the keys must differ"));
    }
    if !verify(first, context::SERVER_KEY, &server_key, VERSION) {
        return Err(log_refused("inception signature does not verify"));
    }
    let hash = sha256_text(first.payload.as_bytes());
    let mut head = ServerHead {
        server_id: server_id(&first.payload),
        seq: 0,
        keys: vec![server_key.clone()],
        signers: vec![None],
        hashes: vec![hash.clone()],
        server_key,
        recovery_key,
        hash,
    };
    for statement in rest {
        let at = head.seq + 1;
        bounded(statement, 16 * KIB, "server key log")?;
        let entry: RotationEntry = serde_json::from_str(&statement.payload)
            .map_err(|_| log_refused(format!("entry {at} is not a server key log entry")))?;
        if entry.v != VERSION || entry.kind != "server-rotate" {
            return Err(log_refused(format!("entry {at} is not a rotation")));
        }
        if entry.server_id != head.server_id || entry.seq != at || entry.prev != head.hash {
            return Err(log_refused(format!("entry {at} does not extend the log")));
        }
        let server_key = log_key(&entry.server_key)?;
        let recovery_key = log_key(&entry.recovery_key)?;
        if server_key == head.server_key {
            return Err(log_refused("a rotation must change the key"));
        }
        if server_key == recovery_key {
            return Err(log_refused("the keys must differ"));
        }
        let (signer, signer_key) = match entry.signer.as_str() {
            "server" if recovery_key == head.recovery_key => {
                (ServerSigner::Server, &head.server_key)
            }
            "server" => return Err(log_refused("only recovery may change the recovery key")),
            "recovery" => (ServerSigner::Recovery, &head.recovery_key),
            _ => return Err(log_refused("unknown rotation signer")),
        };
        if !verify(statement, context::SERVER_KEY, signer_key, VERSION) {
            return Err(log_refused(format!("entry {at} signature does not verify")));
        }
        let hash = sha256_text(statement.payload.as_bytes());
        head.keys.push(server_key.clone());
        head.signers.push(Some(signer));
        head.hashes.push(hash.clone());
        head.seq = at;
        head.server_key = server_key;
        head.recovery_key = recovery_key;
        head.hash = hash;
    }
    Ok(head)
}

// ─── Descriptor and discovery ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Endpoints {
    pub(crate) graphql: String,
    pub(crate) websocket: String,
    pub(crate) s2s: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DescriptorEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    server_id: String,
    key_seq: u32,
    version: u32,
    roles: Vec<String>,
    endpoints: Endpoints,
    #[allow(dead_code)]
    s2s_versions: serde_json::Value,
    #[allow(dead_code)]
    mls_cipher_suites: serde_json::Value,
    #[allow(dead_code)]
    limits: serde_json::Value,
    #[allow(dead_code)]
    registration: serde_json::Value,
    #[allow(dead_code)]
    issued_at: chrono::DateTime<chrono::Utc>,
}

/// A verified server descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerDescriptor {
    pub(crate) server_id: String,
    pub(crate) key_seq: u32,
    pub(crate) version: u32,
    pub(crate) roles: Vec<String>,
    pub(crate) endpoints: Endpoints,
}

fn roles_in_order(roles: &[String]) -> bool {
    let order = ["host", "relay"];
    let mut last: Option<usize> = None;
    for role in roles {
        let Some(at) = order.iter().position(|r| r == role) else {
            return false;
        };
        if last.is_some_and(|l| at <= l) {
            return false;
        }
        last = Some(at);
    }
    !roles.is_empty()
}

/// Verify a descriptor signed by the head key of `head`.
pub(crate) fn verify_descriptor(
    head: &ServerHead,
    descriptor: &Statement,
) -> Result<ServerDescriptor> {
    bounded(descriptor, 16 * KIB, "server descriptor")?;
    let entry: DescriptorEntry = serde_json::from_str(&descriptor.payload)
        .map_err(|_| refused("server descriptor", "malformed"))?;
    if entry.v != VERSION
        || entry.kind != "server-descriptor"
        || !(1..=i32::MAX as u32).contains(&entry.version)
        || !roles_in_order(&entry.roles)
    {
        return Err(refused("server descriptor", "malformed"));
    }
    if entry.server_id != head.server_id {
        return Err(refused("server descriptor", "another server"));
    }
    if entry.key_seq != head.seq {
        return Err(refused("server descriptor", "not signed by the head key"));
    }
    if !verify(descriptor, context::DESCRIPTOR, &head.server_key, VERSION) {
        return Err(refused("server descriptor", "signature does not verify"));
    }
    Ok(ServerDescriptor {
        server_id: entry.server_id,
        key_seq: entry.key_seq,
        version: entry.version,
        roles: entry.roles,
        endpoints: entry.endpoints,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscoveryDocument {
    rim: String,
    key_log: Vec<Statement>,
    descriptor: Statement,
}

/// A verified discovery document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedDiscovery {
    pub(crate) log: Vec<Statement>,
    pub(crate) head: ServerHead,
    pub(crate) descriptor: ServerDescriptor,
}

/// Read and verify a discovery document fetched for `origin`: the log replays, the descriptor
/// verifies under its head, and the server-to-server endpoint lives at that origin.
pub(crate) fn verify_discovery(document: &str, origin: &str) -> Result<VerifiedDiscovery> {
    let document: DiscoveryDocument =
        serde_json::from_str(document).map_err(|_| refused("server discovery", "malformed"))?;
    if document.rim != "server-discovery" {
        return Err(refused("server discovery", "malformed"));
    }
    let head = replay_server_log(&document.key_log)?;
    let descriptor = verify_descriptor(&head, &document.descriptor)?;
    if let Some(s2s) = &descriptor.endpoints.s2s {
        if !s2s.starts_with(origin.trim_end_matches('/')) {
            return Err(refused(
                "server discovery",
                "its endpoints are at another origin",
            ));
        }
    }
    Ok(VerifiedDiscovery {
        log: document.key_log,
        head,
        descriptor,
    })
}

// ─── Host responses ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostResponseEntry {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    host: String,
    key_seq: u32,
    request_sha256: String,
    status: u16,
    body_sha256: String,
}

/// A host-response statement read from `Rim-Host-Response` and `Rim-Host-Signature`.
#[derive(Debug, Clone)]
pub(crate) struct HostResponse {
    statement: Statement,
    entry: HostResponseEntry,
}

impl HostResponse {
    pub(crate) fn read(encoded: &str, signature: &str) -> Result<Self> {
        let malformed = || refused("host response", "malformed");
        let bytes = unb64(encoded).map_err(|_| malformed())?;
        let payload = String::from_utf8(bytes).map_err(|_| malformed())?;
        let statement = Statement {
            payload,
            signature: signature.to_string(),
        };
        bounded(&statement, 16 * KIB, "host response")?;
        let entry: HostResponseEntry =
            serde_json::from_str(&statement.payload).map_err(|_| malformed())?;
        if entry.v != VERSION || entry.kind != "host-response" {
            return Err(malformed());
        }
        Ok(Self { statement, entry })
    }

    pub(crate) fn key_seq(&self) -> u32 {
        self.entry.key_seq
    }
}

/// What a host response must say to answer a request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResponseExpectation {
    pub(crate) host: String,
    /// The device-request payload text the request carried.
    pub(crate) request_payload: String,
    pub(crate) status: u16,
    /// base64url(SHA-256(body bytes)) of the body received.
    pub(crate) body_sha256: String,
}

/// Check a host response against the request it answers and the host key at its `keySeq`.
pub(crate) fn verify_host_response(
    response: &HostResponse,
    host_key: &str,
    expected: &ResponseExpectation,
) -> Result<()> {
    let entry = &response.entry;
    if entry.host != expected.host {
        return Err(refused("host response", "from another host"));
    }
    if entry.request_sha256 != sha256_text(expected.request_payload.as_bytes()) {
        return Err(refused("host response", "answers another request"));
    }
    if entry.status != expected.status {
        return Err(refused("host response", "another status"));
    }
    if entry.body_sha256 != expected.body_sha256 {
        return Err(refused("host response", "another body"));
    }
    if !verify(
        &response.statement,
        context::HOST_RESPONSE,
        host_key,
        VERSION,
    ) {
        return Err(refused("host response", "signature does not verify"));
    }
    Ok(())
}

// ─── Host events ─────────────────────────────────────────────────────────────

/// A host-event statement, read before it is verified.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostEvent {
    #[serde(skip_serializing)]
    v: u8,
    #[serde(rename = "type", skip_serializing)]
    kind: String,
    pub(crate) host: String,
    pub(crate) key_seq: u32,
    pub(crate) workspace_id: String,
    pub(crate) stream: String,
    /// `None` on the ephemeral stream `e`.
    pub(crate) seq: Option<u64>,
    pub(crate) event: serde_json::Map<String, serde_json::Value>,
    pub(crate) issued_at: chrono::DateTime<chrono::Utc>,
}

/// Read a host-event envelope's payload.
pub(crate) fn read_host_event(envelope: &Statement) -> Result<HostEvent> {
    let malformed = || refused("host event", "malformed");
    bounded(envelope, 512 * KIB, "host event")?;
    let event: HostEvent = serde_json::from_str(&envelope.payload).map_err(|_| malformed())?;
    let typed = event.event.get("type").is_some_and(|t| t.is_string());
    let seq_ok = event
        .seq
        .is_none_or(|s| s <= crate::key_identity::statement::MAX_REQUEST_SEQ);
    if event.v != VERSION || event.kind != "host-event" || !typed || !seq_ok {
        return Err(malformed());
    }
    Ok(event)
}

/// Whether `envelope` is signed by the host key `host_key`.
pub(crate) fn verify_host_event(envelope: &Statement, host_key: &str) -> bool {
    verify(envelope, context::HOST_EVENT, host_key, VERSION)
}

// ─── Revocation acknowledgements ─────────────────────────────────────────────

/// A host's `revocation-ack`: it applied a device revocation.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevocationAck {
    #[serde(skip_serializing)]
    v: u8,
    #[serde(rename = "type", skip_serializing)]
    kind: String,
    pub(crate) host: String,
    pub(crate) key_seq: u32,
    pub(crate) principal_id: String,
    pub(crate) device_id: String,
    pub(crate) revocation_sha256: String,
    pub(crate) applied_at: chrono::DateTime<chrono::Utc>,
}

/// What an acknowledgement must answer: the revocation this app sent, to that host.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AckExpectation {
    pub(crate) host: String,
    /// The `device-revoke` payload text that was sent.
    pub(crate) revocation_payload: String,
}

/// Read a revocation acknowledgement before its key is chosen.
pub(crate) fn read_revocation_ack(ack: &Statement) -> Result<RevocationAck> {
    let malformed = || refused("revocation acknowledgement", "malformed");
    bounded(ack, 16 * KIB, "revocation acknowledgement")?;
    let entry: RevocationAck = serde_json::from_str(&ack.payload).map_err(|_| malformed())?;
    if entry.v != VERSION || entry.kind != "revocation-ack" {
        return Err(malformed());
    }
    Ok(entry)
}

/// Check an acknowledgement against the revocation it answers and the host key at its
/// `keySeq`: the host, the principal and device the revocation names, its hash, the signature.
pub(crate) fn verify_revocation_ack(
    ack: &Statement,
    host_key: &str,
    expected: &AckExpectation,
) -> Result<RevocationAck> {
    let what = "revocation acknowledgement";
    let entry = read_revocation_ack(ack)?;
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Revoked {
        principal_id: String,
        device_id: String,
    }
    let revoked: Revoked = serde_json::from_str(&expected.revocation_payload)
        .map_err(|_| refused(what, "the revocation is malformed"))?;
    if entry.host != expected.host {
        return Err(refused(what, "from another host"));
    }
    if entry.principal_id != revoked.principal_id || entry.device_id != revoked.device_id {
        return Err(refused(what, "names another device"));
    }
    if entry.revocation_sha256 != sha256_text(expected.revocation_payload.as_bytes()) {
        return Err(refused(what, "answers another revocation"));
    }
    if !verify(ack, context::REVOCATION_ACK, host_key, VERSION) {
        return Err(refused(what, "signature does not verify"));
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key_identity::statement::{
        delegation, device_request, DelegationInput, DeviceRequestInput, SecretKey,
    };
    use zeroize::Zeroizing;

    /// base64url(SHA-256(tagged key text)): how a delegation or an invite names a server key.
    fn key_hash(key: &str) -> String {
        sha256_text(key.as_bytes())
    }

    fn vectors() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../protocol/relay-vectors.json"))
            .expect("relay-vectors.json is JSON")
    }

    fn statement(value: &serde_json::Value) -> Statement {
        serde_json::from_value(value.clone()).expect("a statement")
    }

    fn text(value: &serde_json::Value) -> &str {
        value.as_str().expect("a string")
    }

    #[test]
    fn inceptions_replay_to_the_vector_ids_key_hashes_and_prev_links() {
        let v = vectors();
        for server in [&v["relay"], &v["host"]] {
            let head = replay_server_log(&[statement(&server["inception"])]).unwrap();
            assert_eq!(head.server_id, text(&server["serverId"]));
            assert_eq!(head.server_key, text(&server["serverKey"]));
            assert_eq!(head.hash, text(&server["prev"]));
            assert_eq!(key_hash(&head.server_key), text(&server["keyHash"]));
        }
    }

    #[test]
    fn a_server_rotation_extends_the_log_and_the_descriptor_follows_the_head() {
        let v = vectors();
        let host = &v["host"];
        let one = replay_server_log(&[statement(&host["inception"])]).unwrap();
        assert_eq!(
            verify_descriptor(&one, &statement(&host["descriptor"]))
                .unwrap()
                .roles,
            vec!["host", "relay"]
        );
        let two = replay_server_log(&[statement(&host["inception"]), statement(&host["rotation"])])
            .unwrap();
        assert_eq!(two.hash, text(&host["rotatedPrev"]));
        assert_eq!(key_hash(&two.server_key), text(&host["rotatedKeyHash"]));
        assert_eq!(two.signers, vec![None, Some(ServerSigner::Server)]);
        assert_eq!(
            verify_descriptor(&two, &statement(&host["rotatedDescriptor"]))
                .unwrap()
                .version,
            2
        );
        assert!(verify_descriptor(&two, &statement(&host["descriptor"])).is_err());
    }

    #[test]
    fn a_tampered_or_extended_entry_is_refused() {
        let v = vectors();
        let mut tampered = statement(&v["host"]["inception"]);
        tampered.payload = tampered.payload.replace("09T", "08T");
        assert!(replay_server_log(&[tampered]).is_err());
        let mut extra = statement(&v["host"]["inception"]);
        extra.payload = extra.payload.replace("{\"v\":2,", "{\"v\":2,\"x\":1,");
        assert!(replay_server_log(&[extra]).is_err());
    }

    #[test]
    fn discovery_verifies_for_its_origin_only() {
        let v = vectors();
        let document = serde_json::json!({
            "rim": "server-discovery",
            "keyLog": [v["host"]["inception"]],
            "descriptor": v["host"]["descriptor"],
        })
        .to_string();
        let verified = verify_discovery(&document, "https://host.example").unwrap();
        assert_eq!(verified.head.server_id, text(&v["host"]["serverId"]));
        assert!(verify_discovery(&document, "https://elsewhere.example").is_err());
    }

    #[test]
    fn the_device_request_vector_signs_byte_for_byte() {
        let v = vectors();
        let r = &v["deviceRequest"];
        assert_eq!(
            sha256_text(text(&r["body"]).as_bytes()),
            text(&r["bodySha256"])
        );
        let input = DeviceRequestInput {
            host: text(&r["input"]["host"]).into(),
            method: text(&r["input"]["method"]).into(),
            path: text(&r["input"]["path"]).into(),
            seq: r["input"]["seq"].as_u64().unwrap(),
            body_sha256: text(&r["bodySha256"]).into(),
            issued_at: text(&r["input"]["issuedAt"]).into(),
        };
        let device = SecretKey::from_seed(Zeroizing::new([20u8; 32]));
        let signed = device_request(
            &device,
            text(&r["input"]["principalId"]),
            text(&r["input"]["deviceId"]),
            &input,
        )
        .unwrap();
        assert_eq!(signed.payload, text(&r["payload"]));
        assert_eq!(signed.signature, text(&r["signature"]));
        assert_eq!(b64(signed.payload.as_bytes()), text(&r["header"]));

        let too_big = DeviceRequestInput {
            seq: 1 << 53,
            ..input.clone()
        };
        assert!(device_request(&device, "p", "d", &too_big).is_err());
        let put = DeviceRequestInput {
            method: "PUT".into(),
            ..input
        };
        assert!(device_request(&device, "p", "d", &put).is_err());
    }

    #[test]
    fn the_conformance_cases_sign_what_the_web_app_signs() {
        let v = vectors();
        let device = SecretKey::from_seed(Zeroizing::new([20u8; 32]));
        let cases = v["deviceRequestConformance"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let input = &case["input"];
            assert_eq!(
                sha256_text(text(&case["body"]).as_bytes()),
                text(&case["bodySha256"])
            );
            let request = DeviceRequestInput {
                host: text(&input["host"]).into(),
                method: text(&input["method"]).into(),
                path: text(&input["path"]).into(),
                seq: input["seq"].as_u64().unwrap(),
                body_sha256: text(&case["bodySha256"]).into(),
                issued_at: text(&input["issuedAt"]).into(),
            };
            let signed = device_request(
                &device,
                text(&v["device"]["principalId"]),
                text(&v["device"]["deviceId"]),
                &request,
            )
            .unwrap();
            assert_eq!(signed.payload, text(&case["payload"]));
            assert_eq!(signed.signature, text(&case["signature"]));
        }
    }

    #[test]
    fn the_host_response_vector_answers_the_vector_request_only() {
        let v = vectors();
        let r = &v["hostResponse"];
        let response =
            HostResponse::read(&b64(text(&r["payload"]).as_bytes()), text(&r["signature"]))
                .unwrap();
        assert_eq!(response.key_seq(), 0);
        let expected = ResponseExpectation {
            host: text(&v["host"]["serverId"]).into(),
            request_payload: text(&v["deviceRequest"]["payload"]).into(),
            status: 200,
            body_sha256: sha256_text(text(&r["body"]).as_bytes()),
        };
        let host_key = text(&v["host"]["serverKey"]);
        verify_host_response(&response, host_key, &expected).unwrap();
        let other_request = ResponseExpectation {
            request_payload: expected
                .request_payload
                .replace("1791504000000000", "1791504000000001"),
            ..expected.clone()
        };
        assert!(verify_host_response(&response, host_key, &other_request).is_err());
        let other_status = ResponseExpectation {
            status: 500,
            ..expected.clone()
        };
        assert!(verify_host_response(&response, host_key, &other_status).is_err());
        let other_body = ResponseExpectation {
            body_sha256: sha256_text(b"{}"),
            ..expected.clone()
        };
        assert!(verify_host_response(&response, host_key, &other_body).is_err());
        let relay_key = text(&v["relay"]["serverKey"]);
        assert!(verify_host_response(&response, relay_key, &expected).is_err());
    }

    #[test]
    fn the_host_event_vector_reads_and_verifies() {
        let v = vectors();
        let envelope = statement(&v["hostEvent"]);
        let event = read_host_event(&envelope).unwrap();
        assert_eq!(event.seq, Some(42));
        assert_eq!(event.stream, "c:0199d1a0-0000-7000-8000-000000000003");
        assert_eq!(event.event["type"], "MessageDeleted");
        assert!(verify_host_event(&envelope, text(&v["host"]["serverKey"])));
        assert!(!verify_host_event(
            &envelope,
            text(&v["relay"]["serverKey"])
        ));
        let mut altered = envelope.clone();
        altered.payload = altered.payload.replace("\"seq\":42", "\"seq\":43");
        assert!(!verify_host_event(&altered, text(&v["host"]["serverKey"])));
        let mut extra = envelope;
        extra.payload = extra.payload.replace("{\"v\":2,", "{\"v\":2,\"x\":1,");
        assert!(read_host_event(&extra).is_err());
    }

    fn delegation_input(value: &serde_json::Value) -> DelegationInput {
        serde_json::from_value(value.clone()).expect("a delegation input")
    }

    fn device_key() -> SecretKey {
        SecretKey::from_seed(Zeroizing::new([20u8; 32]))
    }

    #[test]
    fn the_delegation_vector_signs_byte_for_byte() {
        let v = vectors();
        let signed = delegation(
            &device_key(),
            text(&v["device"]["principalId"]),
            text(&v["device"]["deviceId"]),
            &delegation_input(&v["delegation"]["input"]),
        )
        .unwrap();
        assert_eq!(signed.payload, text(&v["delegation"]["payload"]));
        assert_eq!(signed.signature, text(&v["delegation"]["signature"]));
    }

    #[test]
    fn the_delegation_conformance_cases_sign_what_the_web_app_signs() {
        let v = vectors();
        let cases = v["delegationConformance"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let signed = delegation(
                &device_key(),
                text(&v["device"]["principalId"]),
                text(&v["device"]["deviceId"]),
                &delegation_input(&case["input"]),
            )
            .unwrap();
            assert_eq!(signed.payload, text(&case["payload"]));
            assert_eq!(signed.signature, text(&case["signature"]));
        }
    }

    #[test]
    fn a_delegation_a_host_would_refuse_is_not_signed() {
        let v = vectors();
        let input = delegation_input(&v["delegation"]["input"]);
        let sign = |input: &DelegationInput| {
            delegation(
                &device_key(),
                "rimp1_x",
                "00000000-0000-0000-0000-000000000001",
                input,
            )
        };
        let longer = DelegationInput {
            expires_at: "2026-10-10T00:00:01Z".into(),
            ..input.clone()
        };
        assert!(sign(&longer).is_err());
        let backwards = DelegationInput {
            expires_at: input.issued_at.clone(),
            ..input.clone()
        };
        assert!(sign(&backwards).is_err());
        let short_nonce = DelegationInput {
            nonce: "cHFyc3R1dnd4eXp7fH1-".into(),
            ..input.clone()
        };
        assert!(sign(&short_nonce).is_err());
        let fractional = DelegationInput {
            issued_at: "2026-10-09T00:00:00.5Z".into(),
            ..input.clone()
        };
        assert!(sign(&fractional).is_err());
        let not_a_server = DelegationInput {
            relay: "https://relay.example".into(),
            ..input.clone()
        };
        assert!(sign(&not_a_server).is_err());
        let bad_workspace = DelegationInput {
            workspace_id: "workspace".into(),
            ..input
        };
        assert!(sign(&bad_workspace).is_err());
    }

    #[test]
    fn the_revocation_ack_vector_verifies_for_its_revocation_only() {
        let v = vectors();
        let ack = statement(&v["revocationAck"]);
        let host_key = text(&v["host"]["serverKey"]);
        let expected = AckExpectation {
            host: text(&v["host"]["serverId"]).into(),
            revocation_payload: text(&v["revocation"]["payload"]).into(),
        };
        assert_eq!(read_revocation_ack(&ack).unwrap().key_seq, 0);
        let entry = verify_revocation_ack(&ack, host_key, &expected).unwrap();
        assert_eq!(entry.device_id, text(&v["device"]["deviceId"]));
        assert_eq!(
            entry.revocation_sha256,
            sha256_text(expected.revocation_payload.as_bytes())
        );

        let other_revocation = AckExpectation {
            revocation_payload: expected
                .revocation_payload
                .replace("09T00:00:00Z", "09T00:00:01Z"),
            ..expected.clone()
        };
        assert!(verify_revocation_ack(&ack, host_key, &other_revocation).is_err());
        let other_host = AckExpectation {
            host: text(&v["relay"]["serverId"]).into(),
            ..expected.clone()
        };
        assert!(verify_revocation_ack(&ack, host_key, &other_host).is_err());
        let relay_key = text(&v["relay"]["serverKey"]);
        assert!(verify_revocation_ack(&ack, relay_key, &expected).is_err());
        let mut extra = ack;
        extra.payload = extra.payload.replace("{\"v\":2,", "{\"v\":2,\"x\":1,");
        assert!(read_revocation_ack(&extra).is_err());
    }

    #[test]
    fn the_revocation_vector_is_signed_by_the_device() {
        let v = vectors();
        let revocation = statement(&v["revocation"]);
        let device = device_key().public_key();
        assert!(verify(
            &revocation,
            crate::key_identity::statement::context::DEVICE_REVOKE,
            &device,
            VERSION
        ));
    }
}
