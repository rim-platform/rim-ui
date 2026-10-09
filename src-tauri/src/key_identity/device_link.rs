//! Device linking (`rim-server/docs/specs/device-linking-v1.md`): giving a new device its own
//! certified device key with a code shown on a device that holds the identity key.
//!
//! The code carries a 32-byte secret the server never sees. Both devices derive one AES-256-GCM
//! key per direction from it and seal exactly one message each through the server: the new
//! device's **offer** (its device id, device key and name) and the old device's **answer** (the
//! certificate it signed for that key). The secret, the device key and the identity key stay on
//! this side; the webview sees the code text, the fingerprint, names and the sealed bytes.
//!
//! - **Old device** ([`KeyIdentityState::begin_link`] …): holds the secret in memory, opens and
//!   checks the offer against the replayed key log, signs the certificate once the person
//!   confirms, and writes a [`PendingLink`] to the keyring before `addDeviceKey`, so a restart
//!   can finish the link or revoke a device nobody used.
//! - **New device** ([`KeyIdentityState::offer_link`] …): creates its device key in memory and
//!   writes nothing to the keyring until the answer's certificate verifies against the log.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::statement::{self, b64, SecretKey, Statement};
use super::store::{same_endpoint, AccountLink, KeyRecord, PendingLink};
use super::{device_name, KeyIdentityError, KeyIdentityState, Result};

/// The code version, and the version of the offer, the answer, the `info` and the AAD.
pub(crate) const VERSION: u32 = 1;
const SCHEME: &str = "rim-link:";
/// 78 fixed characters plus a 256-byte endpoint.
const MAX_CODE_LEN: usize = 334;
const MAX_ENDPOINT_LEN: usize = 256;
const LINK_ID_LEN: usize = 16;
const LINK_ID_TEXT_LEN: usize = 22;
const SECRET_LEN: usize = 32;
const SECRET_TEXT_LEN: usize = 43;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const AAD_LABEL: &[u8] = b"rim.device-link.v1\0";
const FINGERPRINT_DOMAIN: &[u8] = b"rim.device-link.v1 fingerprint\0";

/// The wording of a message that failed to open, or opened to a plaintext that breaks the
/// rules: both mean someone without the secret wrote it, or wrote it wrong.
const NOT_OPENED: &str = "the message could not be opened";

// ─── Link code ───────────────────────────────────────────────────────────────

/// A parsed link code: `rim-link:1:<link id>:<secret>:<endpoint>`.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct LinkCode {
    pub(crate) link_id: [u8; LINK_ID_LEN],
    secret: Zeroizing<[u8; SECRET_LEN]>,
    pub(crate) endpoint: String,
}

impl std::fmt::Debug for LinkCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LinkCode")
            .field("link_id", &self.link_id_text())
            .field("endpoint", &self.endpoint)
            .finish_non_exhaustive()
    }
}

fn not_a_code() -> KeyIdentityError {
    KeyIdentityError::Invalid("this is not a device link code; copy the whole code again".into())
}

/// Decode unpadded base64url strictly (no padding, canonical trailing bits) to exactly `N` bytes.
fn decode_exact<const N: usize>(text: &str, text_len: usize) -> Option<Zeroizing<[u8; N]>> {
    if text.len() != text_len {
        return None;
    }
    let bytes = Zeroizing::new(URL_SAFE_NO_PAD.decode(text).ok()?);
    let mut out = Zeroizing::new([0u8; N]);
    if bytes.len() != N {
        return None;
    }
    out.copy_from_slice(&bytes);
    Some(out)
}

/// A link id from its 22-character text.
pub(crate) fn parse_link_id(text: &str) -> Result<[u8; LINK_ID_LEN]> {
    decode_exact::<LINK_ID_LEN>(text, LINK_ID_TEXT_LEN)
        .map(|id| *id)
        .ok_or_else(|| KeyIdentityError::Invalid("the server's link id is malformed".into()))
}

/// Reader rule 5: `http://` or `https://`, 1 to 256 bytes of printable ASCII, no `?`, `#`, `@`.
fn valid_endpoint(endpoint: &str) -> bool {
    (endpoint.starts_with("http://") || endpoint.starts_with("https://"))
        && (1..=MAX_ENDPOINT_LEN).contains(&endpoint.len())
        && endpoint
            .bytes()
            .all(|b| (0x21..=0x7e).contains(&b) && !matches!(b, b'?' | b'#' | b'@'))
}

impl LinkCode {
    /// A new code for `link_id` (from `startDeviceLink`) with a fresh secret. `endpoint` is the
    /// app's configured GraphQL endpoint; its trailing `/` is dropped.
    pub(crate) fn generate(link_id: [u8; LINK_ID_LEN], endpoint: &str) -> Result<Self> {
        let endpoint = endpoint.trim().trim_end_matches('/').to_string();
        if !valid_endpoint(&endpoint) {
            return Err(KeyIdentityError::Invalid(format!(
                "this server's address cannot go into a link code: {endpoint}"
            )));
        }
        let mut secret = Zeroizing::new([0u8; SECRET_LEN]);
        getrandom::fill(secret.as_mut())
            .map_err(|e| KeyIdentityError::Crypto(format!("random generation failed: {e}")))?;
        Ok(Self {
            link_id,
            secret,
            endpoint,
        })
    }

    /// Read a code as typed or pasted (the spec's reader rules 1 to 5).
    pub(crate) fn parse(text: &str) -> Result<Self> {
        let compact: Zeroizing<String> =
            Zeroizing::new(text.chars().filter(|c| !c.is_ascii_whitespace()).collect());
        if compact.len() > MAX_CODE_LEN {
            return Err(not_a_code());
        }
        let scheme = compact.get(..SCHEME.len()).ok_or_else(not_a_code)?;
        if !scheme.eq_ignore_ascii_case(SCHEME) {
            return Err(not_a_code());
        }
        let mut parts = compact[SCHEME.len()..].splitn(4, ':');
        let (Some(version), Some(link_id), Some(secret), Some(endpoint)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(not_a_code());
        };
        if version.is_empty() || !version.bytes().all(|b| b.is_ascii_digit()) {
            return Err(not_a_code());
        }
        if version != VERSION.to_string() {
            return Err(KeyIdentityError::Invalid(
                "this code was made by a newer app; update this device".into(),
            ));
        }
        let link_id =
            decode_exact::<LINK_ID_LEN>(link_id, LINK_ID_TEXT_LEN).ok_or_else(not_a_code)?;
        let secret = decode_exact::<SECRET_LEN>(secret, SECRET_TEXT_LEN).ok_or_else(not_a_code)?;
        if !valid_endpoint(endpoint) {
            return Err(not_a_code());
        }
        Ok(Self {
            link_id: *link_id,
            secret,
            endpoint: endpoint.to_string(),
        })
    }

    /// The code as shown and encoded in the QR code.
    pub(crate) fn format(&self) -> Zeroizing<String> {
        let secret = Zeroizing::new(b64(self.secret.as_ref()));
        Zeroizing::new(format!(
            "{SCHEME}{VERSION}:{}:{}:{}",
            self.link_id_text(),
            secret.as_str(),
            self.endpoint
        ))
    }

    pub(crate) fn link_id_text(&self) -> String {
        b64(&self.link_id)
    }

    fn secret_text(&self) -> Zeroizing<String> {
        Zeroizing::new(b64(self.secret.as_ref()))
    }

    fn from_pending(link: &PendingLink) -> Result<Self> {
        let unreadable = || KeyIdentityError::Keyring("a pending device link is unreadable".into());
        Ok(Self {
            link_id: *decode_exact::<LINK_ID_LEN>(&link.link_id, LINK_ID_TEXT_LEN)
                .ok_or_else(unreadable)?,
            secret: decode_exact::<SECRET_LEN>(&link.secret, SECRET_TEXT_LEN)
                .ok_or_else(unreadable)?,
            endpoint: link.endpoint.clone(),
        })
    }
}

// ─── Channel ─────────────────────────────────────────────────────────────────

/// Which way a sealed message goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    /// New device to old device.
    Offer,
    /// Old device to new device.
    Answer,
}

impl Direction {
    fn label(self) -> &'static str {
        match self {
            Self::Offer => "offer",
            Self::Answer => "answer",
        }
    }

    fn info(self) -> &'static [u8] {
        match self {
            Self::Offer => b"rim.device-link.v1 offer",
            Self::Answer => b"rim.device-link.v1 answer",
        }
    }

    fn max_plaintext(self) -> usize {
        match self {
            Self::Offer => 16 * 1024,
            Self::Answer => 64 * 1024,
        }
    }
}

/// `K_offer` or `K_answer`: HKDF-SHA256 of the secret, salted with the raw link id.
pub(crate) fn channel_key(code: &LinkCode, direction: Direction) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    // 32 bytes is far below HKDF-SHA256's 8160-byte limit, so expansion cannot fail.
    let _ = Hkdf::<Sha256>::new(Some(&code.link_id), code.secret.as_ref())
        .expand(direction.info(), key.as_mut());
    key
}

/// `rim.device-link.v1\0<direction>\0<link id text>`.
pub(crate) fn aad(link_id_text: &str, direction: Direction) -> Vec<u8> {
    let mut aad = AAD_LABEL.to_vec();
    aad.extend_from_slice(direction.label().as_bytes());
    aad.push(0);
    aad.extend_from_slice(link_id_text.as_bytes());
    aad
}

/// A sealed message as it travels (`SealedMessage` / `SealedMessageInput`): the 12-byte nonce
/// and the ciphertext with its 16-byte tag appended, both unpadded base64url.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Sealed {
    pub(crate) nonce: String,
    pub(crate) ciphertext: String,
}

fn cipher(code: &LinkCode, direction: Direction) -> Aes256Gcm {
    let key = channel_key(code, direction);
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_slice()))
}

pub(crate) fn seal_with_nonce(
    code: &LinkCode,
    direction: Direction,
    plaintext: &[u8],
    nonce: [u8; NONCE_LEN],
) -> Result<Sealed> {
    if plaintext.is_empty() || plaintext.len() > direction.max_plaintext() {
        return Err(KeyIdentityError::Invalid(format!(
            "the link {} is too large",
            direction.label()
        )));
    }
    let aad = aad(&code.link_id_text(), direction);
    let ciphertext = cipher(code, direction)
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| KeyIdentityError::Crypto("sealing failed".into()))?;
    Ok(Sealed {
        nonce: b64(&nonce),
        ciphertext: b64(&ciphertext),
    })
}

/// Seal `plaintext` under a random nonce. Each side seals one plaintext per link and resends
/// the same bytes on a retry.
pub(crate) fn seal(code: &LinkCode, direction: Direction, plaintext: &[u8]) -> Result<Sealed> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce)
        .map_err(|e| KeyIdentityError::Crypto(format!("random generation failed: {e}")))?;
    seal_with_nonce(code, direction, plaintext, nonce)
}

/// Open a sealed message. Every failure (encoding, size, tag) reads the same.
pub(crate) fn open(
    code: &LinkCode,
    direction: Direction,
    sealed: &Sealed,
) -> Result<Zeroizing<Vec<u8>>> {
    let failed = || KeyIdentityError::Invalid(NOT_OPENED.into());
    let nonce = URL_SAFE_NO_PAD
        .decode(&sealed.nonce)
        .map_err(|_| failed())?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&sealed.ciphertext)
        .map_err(|_| failed())?;
    if nonce.len() != NONCE_LEN
        || ciphertext.len() <= TAG_LEN
        || ciphertext.len() > direction.max_plaintext() + TAG_LEN
    {
        return Err(failed());
    }
    let aad = aad(&code.link_id_text(), direction);
    cipher(code, direction)
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| failed())
}

/// The 8 characters both screens show, `XXXX-XXXX`: base32 of the first 5 bytes of
/// SHA-256 over the offer plaintext as sealed.
pub(crate) fn fingerprint(offer_plaintext: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_DOMAIN);
    hasher.update(offer_plaintext);
    let text = super::recovery_kit::base32(&hasher.finalize()[..5]);
    format!("{}-{}", &text[..4], &text[4..])
}

// ─── Plaintexts ──────────────────────────────────────────────────────────────

/// The new device's offer. Fields in the spec's order, so the bytes are reproducible. Unknown
/// and duplicate fields are refused (serde's derive refuses a field named twice).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Offer {
    pub(crate) v: u32,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) device_id: String,
    pub(crate) device_key: String,
    pub(crate) name: String,
    pub(crate) platform: String,
    pub(crate) statement_version: u32,
}

const OFFER_TYPE: &str = "link-offer";
const ANSWER_TYPE: &str = "link-answer";

/// The old device's answer: the certificate exactly as sent to `addDeviceKey`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Answer {
    pub(crate) v: u32,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) certificate: AnswerCertificate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AnswerCertificate {
    pub(crate) payload: String,
    pub(crate) signature: String,
}

fn to_json<T: Serialize>(value: &T) -> Zeroizing<Vec<u8>> {
    // Serializing these plain structs cannot fail.
    Zeroizing::new(serde_json::to_vec(value).unwrap_or_default())
}

impl Offer {
    pub(crate) fn new(device_id: &str, device_key: &str, name: &str) -> Self {
        Self {
            v: VERSION,
            kind: OFFER_TYPE.into(),
            device_id: device_id.into(),
            device_key: device_key.into(),
            name: name.into(),
            platform: "desktop".into(),
            statement_version: u32::from(statement::WRITE_VERSION),
        }
    }

    pub(crate) fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        to_json(self)
    }

    /// Read an opened offer. A plaintext that breaks the JSON rules reads like one that did
    /// not open.
    pub(crate) fn parse(plaintext: &[u8]) -> Result<Self> {
        let offer: Self = serde_json::from_slice(plaintext)
            .map_err(|_| KeyIdentityError::Invalid(NOT_OPENED.into()))?;
        if offer.v != VERSION || offer.kind != OFFER_TYPE {
            return Err(KeyIdentityError::Invalid(NOT_OPENED.into()));
        }
        Ok(offer)
    }

    /// The field rules that do not need the account (old device rule 3, first half).
    fn check_fields(&self) -> Result<()> {
        let refuse = |why: &str| Err(KeyIdentityError::Invalid(why.into()));
        let canonical_uuid = uuid::Uuid::parse_str(&self.device_id)
            .is_ok_and(|id| id.hyphenated().to_string() == self.device_id);
        if !canonical_uuid {
            return refuse("the new device sent a malformed device id");
        }
        statement::usable_device_key(&self.device_key)?;
        let chars = self.name.chars().count();
        if self.name.trim() != self.name
            || !(1..=64).contains(&chars)
            || self.name.chars().any(char::is_control)
        {
            return refuse("the new device's name is not a valid device name");
        }
        if !matches!(self.platform.as_str(), "desktop" | "web") {
            return refuse("the new device names an unknown platform");
        }
        if self.statement_version < 2 {
            return refuse("the new device is too old to be linked; update it");
        }
        Ok(())
    }
}

impl Answer {
    pub(crate) fn new(certificate: &Statement) -> Self {
        Self {
            v: VERSION,
            kind: ANSWER_TYPE.into(),
            certificate: AnswerCertificate {
                payload: certificate.payload.clone(),
                signature: certificate.signature.clone(),
            },
        }
    }

    pub(crate) fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        to_json(self)
    }

    pub(crate) fn parse(plaintext: &[u8]) -> Result<Self> {
        let answer: Self = serde_json::from_slice(plaintext)
            .map_err(|_| KeyIdentityError::Invalid(NOT_OPENED.into()))?;
        if answer.v != VERSION || answer.kind != ANSWER_TYPE {
            return Err(KeyIdentityError::Invalid(NOT_OPENED.into()));
        }
        Ok(answer)
    }

    fn certificate(&self) -> Statement {
        Statement {
            payload: self.certificate.payload.clone(),
            signature: self.certificate.signature.clone(),
        }
    }
}

// ─── What the webview sees ───────────────────────────────────────────────────

/// A link the old device started: the code to show (it holds the secret, so it is shown, never
/// logged).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartedLink {
    pub(crate) link_id: String,
    pub(crate) code: Zeroizing<String>,
}

/// An offer the old device opened and checked, for the person to confirm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfferReview {
    pub(crate) device_id: String,
    pub(crate) name: String,
    pub(crate) platform: String,
    /// `XXXX-XXXX`.
    pub(crate) fingerprint: String,
}

/// What the old device sends once the person confirmed: the certificate for `addDeviceKey`,
/// and the sealed answer for `sendDeviceLinkAnswer`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkAnswer {
    pub(crate) device_id: String,
    pub(crate) device_key: String,
    pub(crate) certificate: Statement,
    pub(crate) answer: Sealed,
}

/// A pending link (old device) found at start-up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingLinkView {
    pub(crate) link_id: String,
    pub(crate) principal_id: String,
    pub(crate) device_id: String,
    pub(crate) device_key: String,
}

/// A device of the account as `myKeyIdentity` lists it, revoked ones included.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnownDevice {
    pub(crate) device_id: String,
    pub(crate) public_key: String,
}

/// The new device's sealed offer and the fingerprint to show next to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SentOffer {
    pub(crate) link_id: String,
    pub(crate) fingerprint: String,
    pub(crate) offer: Sealed,
}

/// The account a new device's answer is for, whose key log verifies it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedAnswer {
    pub(crate) principal_id: String,
}

/// The device a verified answer made of this computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedDevice {
    pub(crate) principal_id: String,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
}

// ─── Links held in memory ────────────────────────────────────────────────────

/// A link this run is part of. Its secret, and on the new device its key, live only here.
#[derive(Clone)]
pub(crate) enum LiveLink {
    Old(OldLink),
    New(NewLink),
}

#[derive(Clone)]
pub(crate) struct OldLink {
    principal_id: String,
    code: LinkCode,
    /// The offer, once opened and checked.
    offer: Option<Offer>,
    /// Set once the person confirmed; a retry sends these same bytes.
    answer: Option<LinkAnswer>,
}

#[derive(Clone)]
pub(crate) struct NewLink {
    endpoint: String,
    code: LinkCode,
    device_seed: SecretKey,
    offer: Offer,
    /// The answer's certificate, once opened and found to name this offer's device.
    certificate: Option<(Statement, statement::CertificateClaim)>,
}

#[cfg(test)]
impl NewLink {
    pub(crate) fn offer(&self) -> &Offer {
        &self.offer
    }
}

impl KeyIdentityState {
    pub(crate) fn live_links(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, std::collections::HashMap<String, LiveLink>>> {
        self.links
            .lock()
            .map_err(|_| KeyIdentityError::Keyring("link lock poisoned".into()))
    }

    fn old_link(&self, link_id: &str) -> Result<OldLink> {
        match self.live_links()?.get(link_id) {
            Some(LiveLink::Old(link)) => Ok(link.clone()),
            _ => Err(KeyIdentityError::NoLink),
        }
    }

    fn new_link(&self, link_id: &str) -> Result<NewLink> {
        match self.live_links()?.get(link_id) {
            Some(LiveLink::New(link)) => Ok(link.clone()),
            _ => Err(KeyIdentityError::NoLink),
        }
    }

    fn put_link(&self, link_id: &str, link: LiveLink) -> Result<()> {
        self.live_links()?.insert(link_id.to_string(), link);
        Ok(())
    }

    // ─── Old device ──────────────────────────────────────────────────────────

    /// Make the code for a link `startDeviceLink` opened for `principal_id`. The secret stays
    /// in memory.
    pub(crate) fn begin_link(
        &self,
        principal_id: &str,
        endpoint: &str,
        link_id: &str,
    ) -> Result<StartedLink> {
        let link_id_bytes = parse_link_id(link_id)?;
        {
            let _guard = self.guard()?;
            self.record(principal_id)?;
        }
        let code = LinkCode::generate(link_id_bytes, endpoint)?;
        let started = StartedLink {
            link_id: link_id.to_string(),
            code: code.format(),
        };
        self.put_link(
            link_id,
            LiveLink::Old(OldLink {
                principal_id: principal_id.to_string(),
                code,
                offer: None,
                answer: None,
            }),
        )?;
        Ok(started)
    }

    /// Open the offer `deviceLink` returned and check it against the account (old device rules
    /// 2 and 3): `key_log` and `devices` are `myKeyIdentity`'s. Any error means the link must be
    /// cancelled.
    pub(crate) fn review_offer(
        &self,
        link_id: &str,
        key_log: &[Statement],
        devices: &[KnownDevice],
        sealed: &Sealed,
    ) -> Result<OfferReview> {
        let mut link = self.old_link(link_id)?;
        let head = Self::head(&link.principal_id, key_log)?;
        {
            let _guard = self.guard()?;
            self.identity(&link.principal_id, &head)?;
        }
        let someone_else = || {
            KeyIdentityError::Invalid(
                "someone other than your new device used this code, so the link was cancelled. \
                 Start again and keep the code to yourself"
                    .into(),
            )
        };
        let plaintext = open(&link.code, Direction::Offer, sealed).map_err(|_| someone_else())?;
        let offer = Offer::parse(&plaintext).map_err(|_| someone_else())?;
        offer.check_fields()?;

        let refuse = |why: &str| Err(KeyIdentityError::Invalid(why.into()));
        if head.identity_keys.contains(&offer.device_key) || head.recovery_key == offer.device_key {
            return refuse("the new device offered one of this account's own keys");
        }
        let same_key = |d: &KnownDevice| {
            statement::canonical_key(&d.public_key, statement::WRITE_VERSION)
                .map_or(d.public_key == offer.device_key, |k| k == offer.device_key)
        };
        if devices.iter().any(same_key) {
            return refuse("the new device's key is already used by a device of this account");
        }
        if devices.iter().any(|d| d.device_id == offer.device_id) {
            return refuse("the new device's id is already used by a device of this account");
        }

        let review = OfferReview {
            device_id: offer.device_id.clone(),
            name: offer.name.clone(),
            platform: offer.platform.clone(),
            fingerprint: fingerprint(&plaintext),
        };
        link.offer = Some(offer);
        self.put_link(link_id, LiveLink::Old(link))?;
        Ok(review)
    }

    /// The person confirmed the offer as `name`: sign its certificate at the head's `keySeq`,
    /// seal the answer, and write the pending link record before the webview sends
    /// `addDeviceKey` (old device rule 5). A retry returns the same certificate and bytes.
    pub(crate) fn confirm_link(
        &self,
        link_id: &str,
        key_log: &[Statement],
        name: &str,
    ) -> Result<LinkAnswer> {
        let mut link = self.old_link(link_id)?;
        if let Some(answer) = &link.answer {
            return Ok(answer.clone());
        }
        let Some(offer) = &link.offer else {
            return Err(KeyIdentityError::Invalid(
                "there is no offer to confirm yet".into(),
            ));
        };
        let name = device_name(name)?;
        let head = Self::head(&link.principal_id, key_log)?;
        let _guard = self.guard()?;
        let (_, identity) = self.identity(&link.principal_id, &head)?;
        let certificate = statement::device_cert(
            &identity,
            &statement::DeviceCertInput {
                principal_id: &link.principal_id,
                device_id: &offer.device_id,
                device_key: &offer.device_key,
                name: &name,
                key_seq: head.seq,
                issued_at: &statement::now(),
            },
        );
        let answer = LinkAnswer {
            device_id: offer.device_id.clone(),
            device_key: offer.device_key.clone(),
            answer: seal(
                &link.code,
                Direction::Answer,
                &Answer::new(&certificate).to_bytes(),
            )?,
            certificate,
        };
        self.keys().put_pending_link(&PendingLink {
            v: 1,
            link_id: link_id.to_string(),
            secret: link.code.secret_text(),
            endpoint: link.code.endpoint.clone(),
            principal_id: link.principal_id.clone(),
            device_id: answer.device_id.clone(),
            device_key: answer.device_key.clone(),
            certificate: answer.certificate.clone(),
        })?;
        link.answer = Some(answer.clone());
        self.put_link(link_id, LiveLink::Old(link))?;
        Ok(answer)
    }

    /// Pending links on `endpoint` that this run is not already carrying on (old device rule 8).
    pub(crate) fn pending_links(&self, endpoint: &str) -> Result<Vec<PendingLinkView>> {
        let pending = {
            let _guard = self.guard()?;
            self.keys().pending_links()?
        };
        let live = self.live_links()?;
        Ok(pending
            .into_iter()
            .filter(|p| same_endpoint(&p.endpoint, endpoint) && !live.contains_key(&p.link_id))
            .map(|p| PendingLinkView {
                link_id: p.link_id,
                principal_id: p.principal_id,
                device_id: p.device_id,
                device_key: p.device_key,
            })
            .collect())
    }

    /// Carry on a pending link after a restart: its certificate, and its answer sealed again
    /// (the server never stored the first one, or the link would not still need it). Later calls
    /// in this run return the same bytes.
    pub(crate) fn resume_link(&self, link_id: &str) -> Result<LinkAnswer> {
        if let Ok(OldLink {
            answer: Some(answer),
            ..
        }) = self.old_link(link_id)
        {
            return Ok(answer);
        }
        let pending = {
            let _guard = self.guard()?;
            self.keys()
                .pending_links()?
                .into_iter()
                .find(|p| p.link_id == link_id)
                .ok_or(KeyIdentityError::NoLink)?
        };
        let code = LinkCode::from_pending(&pending)?;
        let answer = LinkAnswer {
            device_id: pending.device_id.clone(),
            device_key: pending.device_key.clone(),
            answer: seal(
                &code,
                Direction::Answer,
                &Answer::new(&pending.certificate).to_bytes(),
            )?,
            certificate: pending.certificate,
        };
        self.put_link(
            link_id,
            LiveLink::Old(OldLink {
                principal_id: pending.principal_id,
                code,
                offer: None,
                answer: Some(answer.clone()),
            }),
        )?;
        Ok(answer)
    }

    /// Forget a link on this side: its secret, a new device's unsaved key, and the pending
    /// record, if any. Ending what is not there is not an error.
    pub(crate) fn end_link(&self, link_id: &str) -> Result<()> {
        self.live_links()?.remove(link_id);
        let _guard = self.guard()?;
        self.keys().delete_pending_link(link_id)
    }

    // ─── New device ──────────────────────────────────────────────────────────

    /// Read a pasted code for this app's server `endpoint`, create this device's key and id in
    /// memory, and seal the offer (new device rules 1 and 2). Nothing is written to the keyring.
    pub(crate) fn offer_link(&self, endpoint: &str, code: &str, name: &str) -> Result<SentOffer> {
        let code = LinkCode::parse(code)?;
        if !same_endpoint(&code.endpoint, endpoint) {
            return Err(KeyIdentityError::Invalid(format!(
                "this code is for another server ({}); this app uses {}",
                code.endpoint,
                endpoint.trim()
            )));
        }
        let name = device_name(name)?;
        let device_seed = SecretKey::generate()?;
        let device_id = uuid::Uuid::now_v7().to_string();
        let offer = Offer::new(&device_id, &device_seed.public_key(), &name);
        let plaintext = offer.to_bytes();
        let link_id = code.link_id_text();
        let sent = SentOffer {
            link_id: link_id.clone(),
            fingerprint: fingerprint(&plaintext),
            offer: seal(&code, Direction::Offer, &plaintext)?,
        };
        self.put_link(
            &link_id,
            LiveLink::New(NewLink {
                endpoint: endpoint.trim().to_string(),
                code,
                device_seed,
                offer,
                certificate: None,
            }),
        )?;
        Ok(sent)
    }

    /// Open the answer and check that its certificate names exactly this offer's device (new
    /// device rule 5, first half). Returns the account whose key log must verify it. A failure
    /// drops the link and its key.
    pub(crate) fn open_link_answer(&self, link_id: &str, sealed: &Sealed) -> Result<OpenedAnswer> {
        let mut link = self.new_link(link_id)?;
        let checked: Result<(Statement, statement::CertificateClaim)> = (|| {
            let plaintext = open(&link.code, Direction::Answer, sealed)?;
            let certificate = Answer::parse(&plaintext)?.certificate();
            let claim = statement::certificate_claim(&certificate)?;
            if claim.device_id != link.offer.device_id || claim.device_key != link.offer.device_key
            {
                return Err(KeyIdentityError::Invalid(
                    "the certificate is for another device".into(),
                ));
            }
            Ok((certificate, claim))
        })();
        let (certificate, claim) = match checked {
            Ok(checked) => checked,
            Err(e) => {
                self.live_links()?.remove(link_id);
                return Err(answer_refused(e));
            }
        };
        let opened = OpenedAnswer {
            principal_id: claim.principal_id.clone(),
        };
        link.certificate = Some((certificate, claim));
        self.put_link(link_id, LiveLink::New(link))?;
        Ok(opened)
    }

    /// Verify the opened certificate against the account's key log at its `keySeq`, and only
    /// then store this device's key, id and name for the account (new device rules 5 and 6),
    /// unconfirmed and with the user id unknown, as after a recovery. The next key sign-in
    /// confirms them. A failure drops the link and its key.
    pub(crate) fn accept_link(&self, link_id: &str, key_log: &[Statement]) -> Result<LinkedDevice> {
        let link = self.new_link(link_id)?;
        let result = Self::verify_linked_device(&link, key_log)
            .map_err(answer_refused)
            .and_then(|claim| self.store_linked_device(&link, claim));
        // Stored or refused, the link is over on this side.
        self.live_links()?.remove(link_id);
        result
    }

    fn verify_linked_device(
        link: &NewLink,
        key_log: &[Statement],
    ) -> Result<statement::CertificateClaim> {
        let (certificate, claim) = link.certificate.as_ref().ok_or(KeyIdentityError::NoLink)?;
        let head = Self::head(&claim.principal_id, key_log)?;
        let device = statement::certified_device(certificate, &head)?;
        if device.device_id != link.offer.device_id || device.device_key != link.offer.device_key {
            return Err(KeyIdentityError::Invalid(
                "the certificate is for another device".into(),
            ));
        }
        Ok(claim.clone())
    }

    fn store_linked_device(
        &self,
        link: &NewLink,
        claim: statement::CertificateClaim,
    ) -> Result<LinkedDevice> {
        let _guard = self.guard()?;
        let keys = self.keys();
        if keys.record(&claim.principal_id)?.is_some() {
            return Err(KeyIdentityError::Invalid(
                "this computer already holds keys for that account: sign in with them, or \
                 remove them from the sign-in screen first"
                    .into(),
            ));
        }
        keys.put_record(&KeyRecord {
            v: 1,
            principal_id: claim.principal_id.clone(),
            device_id: claim.device_id.clone(),
            device_name: claim.name.clone(),
            device_seed: link.device_seed.to_text(),
            identity_seed: None,
            pending_identity_seed: None,
            pending_identity_seq: None,
            confirmed: false,
            replaced: None,
        })?;
        let mut links = keys.links()?;
        links.retain(|l| {
            !(same_endpoint(&l.endpoint, &link.endpoint) && l.principal_id == claim.principal_id)
        });
        links.push(AccountLink {
            endpoint: link.endpoint.clone(),
            principal_id: claim.principal_id.clone(),
            user_id: None,
            username: None,
        });
        keys.put_links(&links)?;
        Ok(LinkedDevice {
            principal_id: claim.principal_id,
            device_id: claim.device_id,
            device_name: claim.name,
        })
    }
}

/// Every refusal of an answer reads the same to the person: the link did not verify.
fn answer_refused(error: KeyIdentityError) -> KeyIdentityError {
    match error {
        KeyIdentityError::Invalid(why) => KeyIdentityError::Invalid(format!(
            "the answer from your other device did not verify ({why}), so this device was not \
             linked. Start again"
        )),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Appendix A of device-linking-v1.md.
    const LINK_ID: &str = "AAECAwQFBgcICQoLDA0ODw";
    const SECRET: &str = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
    const ENDPOINT: &str = "http://localhost:8080/api";
    const CODE: &str = "rim-link:1:AAECAwQFBgcICQoLDA0ODw:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8:http://localhost:8080/api";
    const K_OFFER: &str = "6dff67bf777c3cf073ebc0f8810dae7535d3bdb59c9178183441db3768212fba";
    const K_ANSWER: &str = "d6ec24d3f4380cb2ca50865f95a37f3e6b0ab9c2d74ee31d605768abe6bf56e1";
    const OFFER_AAD: &str = "72696d2e6465766963652d6c696e6b2e7631006f666665720041414543417751464267634943516f4c4441304f4477";
    const ANSWER_AAD: &str = "72696d2e6465766963652d6c696e6b2e763100616e737765720041414543417751464267634943516f4c4441304f4477";
    const OFFER_NONCE: &str = "QEFCQ0RFRkdISUpL";
    const ANSWER_NONCE: &str = "UFFSU1RVVldYWVpb";
    const FINGERPRINT: &str = "QSFX-VHMA";
    const OFFER: &str = r#"{"v":1,"type":"link-offer","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","platform":"desktop","statementVersion":2}"#;
    const OFFER_CIPHERTEXT: &str = "J8-HezTgXKj9OyT7HMBA1zjjB4ZTJEJkqjh4skQfSya0Sxe6uk9qWLSzUqUAQ7QrC4ZIEYlO_dsskNkfhQ_iEVXyyUkGmH2j1gqSNpQTetjmsgmQEXUbEsSs8ciJPmD_o_T8zR_R7k-rjthHmMQYHVfwslbojzQhR7wXQiUJfZtIDm5bfx9wYmPPjvmcA9RYQnV6_3GRGoFbsLE9fGt4mRlidnXDiOweblWqdi0dARTNJHJL7DDAMwmqGHiEIcAVTVu7B4SiHFPrTmVBclEOQUB5SxXIsO1wsQ";
    const ANSWER: &str = r#"{"v":1,"type":"link-answer","certificate":{"payload":"{\"v\":2,\"type\":\"device\",\"principalId\":\"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0\",\"deviceId\":\"00000000-0000-0000-0000-000000000001\",\"deviceKey\":\"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc\",\"name\":\"Laptop\",\"keySeq\":0,\"issuedAt\":\"2026-10-09T00:00:00Z\"}","signature":"ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA"}}"#;
    const ANSWER_CIPHERTEXT: &str = "vkDrDIh3nkBRDHroeH_tmxnHXtoMzfo4grqtAiBG46z7xMsAlJDtvvExm51M7w7G7oglt9YXamu3_qjKYYDPA7b_xGvbPvWGkw98Hc91oL2qQvVYz0MSwIWu5R_FyFwN0SIVdph0xJxLBdXq3E3-iKFd4fdfLRdZvRi7qMMTY7wW8DMw2ItevB1tV2xfMF2_WpZNSUvPuJUF9l8VIdtiIHO1V94Sx-ombzLAvfndFHJfxKhsDwxPB9YSaKoaIvKPZrI_6Z0Mzwdn7RAyepsgjrOz4wDnoEWv5eFOO1zU4RpZvRwOmlhJ2NKwLsG87fEtw16kB3g2qMqvwGLWrQ4VuqygY3JucPE0Gu2H-dkxLEYrEuPMbGxMzD2ROIAlZFKljdgj8zGLrYbkLml1Jh-rJijDswN0ktaw-dCCqd0-Pbt4nXvBKGTV5ZuDJ1W-nIMYs9Py81klr5gBOypP8A3In4OFi7ePsu2FOnZE-LRYfaLeYv2PCPKCFaZnCjJS0asVa-UFXHhmz2sWxVwEi1OnENi11C4bweM6a_9ydUHi4w4QMBkZpfHCyondEdgCtxyq8xZXPsEP6_JX007Y9jm9gGQ8JExrsviYRMpeWFT1pVJ2HJJfbkrHrF1Fq7c";

    fn code() -> LinkCode {
        LinkCode::parse(CODE).unwrap()
    }

    fn nonce(text: &str) -> [u8; NONCE_LEN] {
        URL_SAFE_NO_PAD.decode(text).unwrap().try_into().unwrap()
    }

    fn sealed(nonce: &str, ciphertext: &str) -> Sealed {
        Sealed {
            nonce: nonce.into(),
            ciphertext: ciphertext.into(),
        }
    }

    fn message(result: Result<LinkCode>) -> String {
        result.unwrap_err().to_string()
    }

    #[test]
    fn appendix_a_code_keys_and_aad() {
        let code = code();
        assert_eq!(
            code.link_id,
            *b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f"
        );
        assert_eq!(code.secret_text().as_str(), SECRET);
        assert_eq!(code.endpoint, ENDPOINT);
        assert_eq!(code.format().as_str(), CODE);
        assert_eq!(CODE.len(), 103);
        assert_eq!(hex::encode(*channel_key(&code, Direction::Offer)), K_OFFER);
        assert_eq!(
            hex::encode(*channel_key(&code, Direction::Answer)),
            K_ANSWER
        );
        assert_eq!(hex::encode(aad(LINK_ID, Direction::Offer)), OFFER_AAD);
        assert_eq!(hex::encode(aad(LINK_ID, Direction::Answer)), ANSWER_AAD);
    }

    #[test]
    fn appendix_a_offer_seals_opens_and_fingerprints() {
        let code = code();
        let offer = Offer::new(
            "00000000-0000-0000-0000-000000000001",
            "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc",
            "Laptop",
        );
        assert_eq!(offer.to_bytes().as_slice(), OFFER.as_bytes());
        assert_eq!(OFFER.len(), 201);
        let sealed_offer = seal_with_nonce(
            &code,
            Direction::Offer,
            OFFER.as_bytes(),
            nonce(OFFER_NONCE),
        )
        .unwrap();
        assert_eq!(sealed_offer, sealed(OFFER_NONCE, OFFER_CIPHERTEXT));
        let bytes = URL_SAFE_NO_PAD.decode(OFFER_CIPHERTEXT).unwrap();
        assert_eq!(bytes.len(), 217);
        assert_eq!(
            hex::encode(&bytes[201..]),
            "4e654172510e4140794b15c8b0ed70b1"
        );

        let opened = open(&code, Direction::Offer, &sealed_offer).unwrap();
        assert_eq!(opened.as_slice(), OFFER.as_bytes());
        assert_eq!(Offer::parse(&opened).unwrap(), offer);
        assert_eq!(fingerprint(&opened), FINGERPRINT);
        let digest = Sha256::digest([FINGERPRINT_DOMAIN, OFFER.as_bytes()].concat());
        assert_eq!(
            hex::encode(digest),
            "848b7a9d80a01b87adceab1630b57a452359598c53e4326382d7a236e3ca8629"
        );
    }

    #[test]
    fn appendix_a_answer_seals_and_opens() {
        let code = code();
        let certificate = Statement {
            payload: r#"{"v":2,"type":"device","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}"#.into(),
            signature: "ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA".into(),
        };
        let answer = Answer::new(&certificate);
        assert_eq!(answer.to_bytes().as_slice(), ANSWER.as_bytes());
        assert_eq!(ANSWER.len(), 460);
        let sealed_answer = seal_with_nonce(
            &code,
            Direction::Answer,
            ANSWER.as_bytes(),
            nonce(ANSWER_NONCE),
        )
        .unwrap();
        assert_eq!(sealed_answer, sealed(ANSWER_NONCE, ANSWER_CIPHERTEXT));
        let bytes = URL_SAFE_NO_PAD.decode(ANSWER_CIPHERTEXT).unwrap();
        assert_eq!(bytes.len(), 476);
        assert_eq!(
            hex::encode(&bytes[460..]),
            "54f5a552761c925f6e4ac7ac5d45abb7"
        );

        let opened = open(&code, Direction::Answer, &sealed_answer).unwrap();
        assert_eq!(opened.as_slice(), ANSWER.as_bytes());
        assert_eq!(Answer::parse(&opened).unwrap().certificate(), certificate);
    }

    #[test]
    fn an_offer_never_opens_as_an_answer_or_under_another_link() {
        let offer = sealed(OFFER_NONCE, OFFER_CIPHERTEXT);
        assert!(open(&code(), Direction::Answer, &offer).is_err());
        let answer = sealed(ANSWER_NONCE, ANSWER_CIPHERTEXT);
        assert!(open(&code(), Direction::Offer, &answer).is_err());

        let other_link = LinkCode::parse(&CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0OEA")).unwrap();
        assert!(open(&other_link, Direction::Offer, &offer).is_err());
        let other_secret = LinkCode::parse(&CODE.replace(SECRET, &b64(&[7u8; 32]))).unwrap();
        assert!(open(&other_secret, Direction::Offer, &offer).is_err());
        // The endpoint is not part of the channel.
        let elsewhere = LinkCode::parse(&CODE.replace(ENDPOINT, "https://rim.example")).unwrap();
        assert!(open(&elsewhere, Direction::Offer, &offer).is_ok());
    }

    #[test]
    fn a_flipped_nonce_tag_or_ciphertext_byte_fails() {
        let code = code();
        let flip = |text: &str, at: usize| {
            let mut bytes = URL_SAFE_NO_PAD.decode(text).unwrap();
            bytes[at] ^= 1;
            b64(&bytes)
        };
        let last = URL_SAFE_NO_PAD.decode(OFFER_CIPHERTEXT).unwrap().len() - 1;
        for bad in [
            sealed(&flip(OFFER_NONCE, 0), OFFER_CIPHERTEXT),
            sealed(OFFER_NONCE, &flip(OFFER_CIPHERTEXT, 0)),
            sealed(OFFER_NONCE, &flip(OFFER_CIPHERTEXT, last)),
            sealed("QEFCQ0RFRkdISUo", OFFER_CIPHERTEXT),
            sealed(OFFER_NONCE, "AAAA"),
            sealed(OFFER_NONCE, "not base64!"),
        ] {
            assert_eq!(
                open(&code, Direction::Offer, &bad).unwrap_err().to_string(),
                NOT_OPENED
            );
        }
        // A flipped AAD byte: the same key and nonce under the answer label, or another id.
        let key = channel_key(&code, Direction::Offer);
        let mut aad = aad(LINK_ID, Direction::Offer);
        *aad.last_mut().unwrap() ^= 1;
        let ciphertext = URL_SAFE_NO_PAD.decode(OFFER_CIPHERTEXT).unwrap();
        let result = Aes256Gcm::new(key.as_ref().into()).decrypt(
            Nonce::from_slice(&nonce(OFFER_NONCE)),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn plaintexts_refuse_unknown_duplicate_and_mistyped_fields() {
        assert!(Offer::parse(OFFER.as_bytes()).is_ok());
        let extra = OFFER.replace(r#""v":1,"#, r#""v":1,"extra":true,"#);
        assert!(Offer::parse(extra.as_bytes()).is_err());
        let duplicate = OFFER.replace(r#""name":"Laptop","#, r#""name":"Laptop","name":"Phone","#);
        assert!(Offer::parse(duplicate.as_bytes()).is_err());
        let answer_typed = OFFER.replace("link-offer", "link-answer");
        assert!(Offer::parse(answer_typed.as_bytes()).is_err());
        let v2 = OFFER.replace(r#""v":1"#, r#""v":2"#);
        assert!(Offer::parse(v2.as_bytes()).is_err());

        assert!(Answer::parse(ANSWER.as_bytes()).is_ok());
        let cert_extra = ANSWER.replace(r#""signature":"#, r#""extra":1,"signature":"#);
        assert!(Answer::parse(cert_extra.as_bytes()).is_err());
        assert!(Answer::parse(OFFER.as_bytes()).is_err());
    }

    #[test]
    fn offer_fields_follow_the_rules() {
        let good = Offer::parse(OFFER.as_bytes()).unwrap();
        assert!(good.check_fields().is_ok());
        let with = |f: &dyn Fn(&mut Offer)| {
            let mut offer = good.clone();
            f(&mut offer);
            offer.check_fields()
        };
        assert!(with(&|o| o.device_id = "00000000-0000-0000-0000-00000000000A".into()).is_err());
        assert!(with(&|o| o.device_id = "00000000000000000000000000000001".into()).is_err());
        assert!(with(&|o| o.device_id = "laptop".into()).is_err());
        assert!(with(&|o| o.device_key = "ed25519:AAAA".into()).is_err());
        assert!(with(&|o| o.device_key = good.device_key.replace("ed25519:", "")).is_err());
        assert!(with(&|o| o.device_key = good.device_key.replace("ed25519", "mldsa44")).is_err());
        // The identity point is a weak key.
        let weak = format!(
            "ed25519:{}",
            b64(&{
                let mut b = [0u8; 32];
                b[0] = 1;
                b
            })
        );
        assert!(with(&|o| o.device_key = weak.clone()).is_err());
        assert!(with(&|o| o.name = " Laptop".into()).is_err());
        assert!(with(&|o| o.name = String::new()).is_err());
        assert!(with(&|o| o.name = "a".repeat(65)).is_err());
        assert!(with(&|o| o.name = "Lap\ntop".into()).is_err());
        assert!(with(&|o| o.name = "é".repeat(64)).is_ok());
        assert!(with(&|o| o.platform = "mobile".into()).is_err());
        assert!(with(&|o| o.platform = "web".into()).is_ok());
        assert!(with(&|o| o.statement_version = 1).is_err());
        assert!(with(&|o| o.statement_version = 3).is_ok());
    }

    #[test]
    fn the_code_reader_forgives_whitespace_and_scheme_case() {
        let wrapped = format!(" {}\n{}\t", &CODE[..40], &CODE[40..]);
        assert_eq!(LinkCode::parse(&wrapped).unwrap(), code());
        let upper = CODE.replacen("rim-link:", "RIM-Link:", 1);
        assert_eq!(LinkCode::parse(&upper).unwrap(), code());
        // The endpoint keeps its own colons.
        let ported = CODE.replace(ENDPOINT, "https://[::1]:8443/api");
        assert_eq!(
            LinkCode::parse(&ported).unwrap().endpoint,
            "https://[::1]:8443/api"
        );
    }

    #[test]
    fn the_code_reader_refuses_what_the_spec_refuses() {
        assert!(message(LinkCode::parse(&CODE.replacen(":1:", ":2:", 1))).contains("newer app"));
        assert!(LinkCode::parse(&CODE.replacen(":1:", ":x:", 1)).is_err());
        assert!(LinkCode::parse("rim-link:1").is_err());
        assert!(LinkCode::parse(&CODE.replacen("rim-link:", "rim-lnk:", 1)).is_err());
        // 334 characters pass the length rule; 335 do not.
        let at = |len: usize| {
            let endpoint = format!("https://{}", "a".repeat(len - 78 - 8));
            CODE.replace(ENDPOINT, &endpoint)
        };
        assert_eq!(at(334).len(), 334);
        assert!(LinkCode::parse(&at(334)).is_ok());
        assert_eq!(at(335).len(), 335);
        assert!(LinkCode::parse(&at(335)).is_err());
        // Padded, short or non-canonical link ids and secrets.
        assert!(LinkCode::parse(&CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0ODw==")).is_err());
        assert!(LinkCode::parse(&CODE.replace(LINK_ID, &LINK_ID[..21])).is_err());
        assert!(LinkCode::parse(&CODE.replace(LINK_ID, "AAECAwQFBgcICQoLDA0ODx")).is_err());
        assert!(LinkCode::parse(&CODE.replace(SECRET, &SECRET[..42])).is_err());
        assert!(LinkCode::parse(&CODE.replace(SECRET, &format!("{SECRET}="))).is_err());
        // Endpoints.
        for endpoint in [
            "http://localhost:8080/api?x",
            "http://localhost:8080/api#x",
            "http://user@localhost:8080/api",
            "ftp://localhost/api",
            "localhost:8080/api",
            "http://localhost:8080/ä",
        ] {
            assert!(
                LinkCode::parse(&CODE.replace(ENDPOINT, endpoint)).is_err(),
                "{endpoint}"
            );
        }
    }

    #[test]
    fn a_generated_code_drops_the_trailing_slash_and_reads_back() {
        let code = LinkCode::generate([9u8; 16], " http://localhost:8080/api/ ").unwrap();
        assert_eq!(code.endpoint, ENDPOINT);
        assert_eq!(LinkCode::parse(&code.format()).unwrap(), code);
        assert!(LinkCode::generate([9u8; 16], "http://h/api?x=1").is_err());
        assert!(parse_link_id(LINK_ID).is_ok());
        assert!(parse_link_id("AAAA").is_err());
    }
}
