//! The plaintext of an encrypted message: the content JSON and the application data that wraps
//! it with the franking key.

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::codec::{b64, is_principal_id, parse_uuid, required, strict_json, to_json, unb64_32};
use crate::error::{Error, Result};

/// Largest content, in bytes.
pub const MAX_CONTENT_BYTES: usize = 64 * 1024;
/// Longest body, in characters (Unicode scalar values).
pub const MAX_BODY_CHARS: usize = 10_000;
/// Most mentioned principals in one message.
pub const MAX_MENTIONS: usize = 100;
/// Most attachments in one message.
pub const MAX_ATTACHMENTS: usize = 10;
/// Most link previews in one message.
pub const MAX_LINK_PREVIEWS: usize = 3;
/// Longest link preview field, in characters.
const MAX_PREVIEW_FIELD_CHARS: usize = 2_000;
/// Largest attachment plaintext: the blob limit minus the AES-GCM tag.
pub const MAX_ATTACHMENT_PLAINTEXT: u64 = 25 * 1024 * 1024 - 16;

/// The application data format version byte.
const APPLICATION_DATA_VERSION: u8 = 0x01;

/// One message as its sender wrote it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageContent {
    pub id: Uuid,
    /// 0 when sent, +1 per edit.
    pub rev: u32,
    pub thread_root_id: Option<Uuid>,
    pub body: String,
    /// The distinct principal ids of the body's `<@…>` tokens, in order of first appearance.
    pub mentions: Vec<String>,
    /// Whether the body notifies everyone (`@here`, `@channel`).
    pub mention_all: bool,
    /// The timeline message this one replies to.
    pub reply_to: Option<Uuid>,
    pub forwarded_from: Option<ForwardedFrom>,
    pub attachments: Vec<AttachmentEntry>,
    pub link_previews: Vec<LinkPreview>,
}

/// The forwarder's claim about where a forwarded message came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardedFrom {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub author_principal_id: String,
    pub sent_at: String,
}

/// An encrypted attachment as a message carries it.
#[derive(Clone, PartialEq, Eq)]
pub struct AttachmentEntry {
    /// SHA-256 of the uploaded blob.
    pub blob_sha256: [u8; 32],
    /// The per-file secret the key and nonce derive from.
    pub secret: Zeroizing<[u8; 32]>,
    pub name: String,
    pub mime: String,
    /// The plaintext size in bytes.
    pub size: u64,
}

impl std::fmt::Debug for AttachmentEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AttachmentEntry")
            .field("blob_sha256", &b64(&self.blob_sha256))
            .field("name", &self.name)
            .field("mime", &self.mime)
            .field("size", &self.size)
            .finish_non_exhaustive()
    }
}

/// A link preview the sender's client fetched.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LinkPreview {
    pub url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
}

// ─── Wire format, fields in their fixed order ────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContentWire {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    id: String,
    rev: u32,
    #[serde(deserialize_with = "required")]
    thread_root_id: Option<String>,
    body: String,
    mentions: Vec<String>,
    mention_all: bool,
    #[serde(deserialize_with = "required")]
    reply_to: Option<ReplyToWire>,
    #[serde(deserialize_with = "required")]
    forwarded_from: Option<ForwardedFromWire>,
    attachments: Vec<AttachmentWire>,
    link_previews: Vec<LinkPreviewWire>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplyToWire {
    message_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForwardedFromWire {
    message_id: String,
    conversation_id: String,
    author_principal_id: String,
    sent_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttachmentWire {
    blob_sha256: String,
    secret: String,
    name: String,
    mime: String,
    size: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LinkPreviewWire {
    #[serde(deserialize_with = "required")]
    url: Option<String>,
    #[serde(deserialize_with = "required")]
    title: Option<String>,
    #[serde(deserialize_with = "required")]
    description: Option<String>,
    #[serde(deserialize_with = "required")]
    site_name: Option<String>,
}

fn uuid_text(id: &Uuid) -> String {
    id.hyphenated().to_string()
}

impl MessageContent {
    /// A new message (revision 0) with `body`; its mentions are read from the body.
    pub fn new(id: Uuid, body: impl Into<String>) -> Self {
        let body = body.into();
        Self {
            id,
            rev: 0,
            thread_root_id: None,
            mentions: mentions_in(&body),
            mention_all: mentions_everyone(&body),
            body,
            reply_to: None,
            forwarded_from: None,
            attachments: vec![],
            link_previews: vec![],
        }
    }

    /// The content JSON, fields in their fixed order and no spaces.
    pub fn to_bytes(&self) -> Vec<u8> {
        to_json(&ContentWire {
            v: 1,
            kind: "message".into(),
            id: uuid_text(&self.id),
            rev: self.rev,
            thread_root_id: self.thread_root_id.as_ref().map(uuid_text),
            body: self.body.clone(),
            mentions: self.mentions.clone(),
            mention_all: self.mention_all,
            reply_to: self.reply_to.as_ref().map(|id| ReplyToWire {
                message_id: uuid_text(id),
            }),
            forwarded_from: self.forwarded_from.as_ref().map(|f| ForwardedFromWire {
                message_id: uuid_text(&f.message_id),
                conversation_id: uuid_text(&f.conversation_id),
                author_principal_id: f.author_principal_id.clone(),
                sent_at: f.sent_at.clone(),
            }),
            attachments: self
                .attachments
                .iter()
                .map(|a| AttachmentWire {
                    blob_sha256: b64(&a.blob_sha256),
                    secret: b64(a.secret.as_ref()),
                    name: a.name.clone(),
                    mime: a.mime.clone(),
                    size: a.size,
                })
                .collect(),
            link_previews: self
                .link_previews
                .iter()
                .map(|p| LinkPreviewWire {
                    url: p.url.clone(),
                    title: p.title.clone(),
                    description: p.description.clone(),
                    site_name: p.site_name.clone(),
                })
                .collect(),
        })
        .into_bytes()
    }

    /// Read content strictly and check every rule ([`MessageContent::check`]).
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_CONTENT_BYTES {
            return Err(Error::malformed("content", "larger than 64 KiB"));
        }
        let wire: ContentWire = strict_json(bytes, "content")?;
        if wire.v != 1 || wire.kind != "message" {
            return Err(Error::malformed("content", "wrong version or type"));
        }
        let content = Self {
            id: parse_uuid(&wire.id, "content id")?,
            rev: wire.rev,
            thread_root_id: wire
                .thread_root_id
                .map(|id| parse_uuid(&id, "thread root id"))
                .transpose()?,
            body: wire.body,
            mentions: wire.mentions,
            mention_all: wire.mention_all,
            reply_to: wire
                .reply_to
                .map(|r| parse_uuid(&r.message_id, "reply id"))
                .transpose()?,
            forwarded_from: wire
                .forwarded_from
                .map(|f| -> Result<ForwardedFrom> {
                    Ok(ForwardedFrom {
                        message_id: parse_uuid(&f.message_id, "forwarded message id")?,
                        conversation_id: parse_uuid(
                            &f.conversation_id,
                            "forwarded conversation id",
                        )?,
                        author_principal_id: f.author_principal_id,
                        sent_at: f.sent_at,
                    })
                })
                .transpose()?,
            attachments: wire
                .attachments
                .into_iter()
                .map(|a| -> Result<AttachmentEntry> {
                    Ok(AttachmentEntry {
                        blob_sha256: unb64_32(&a.blob_sha256, "attachment hash")?,
                        secret: Zeroizing::new(unb64_32(&a.secret, "attachment secret")?),
                        name: a.name,
                        mime: a.mime,
                        size: a.size,
                    })
                })
                .collect::<Result<_>>()?,
            link_previews: wire
                .link_previews
                .into_iter()
                .map(|p| LinkPreview {
                    url: p.url,
                    title: p.title,
                    description: p.description,
                    site_name: p.site_name,
                })
                .collect(),
        };
        content.check()?;
        Ok(content)
    }

    /// The content rules: body length, mentions and `mentionAll` as the body says, attachment
    /// and link preview limits.
    pub fn check(&self) -> Result<()> {
        let invalid = |reason: &str| Err(Error::Invalid(format!("content: {reason}")));
        if self.body.chars().count() > MAX_BODY_CHARS {
            return invalid("the body is longer than 10,000 characters");
        }
        if self.mentions.len() > MAX_MENTIONS {
            return invalid("more than 100 mentions");
        }
        if self.mentions != mentions_in(&self.body) {
            return invalid("the mentions are not the body's");
        }
        if self.mention_all != mentions_everyone(&self.body) {
            return invalid("mentionAll does not match the body");
        }
        if let Some(forwarded) = &self.forwarded_from {
            if !is_principal_id(&forwarded.author_principal_id) {
                return invalid("the forwarded author is not a principal id");
            }
        }
        if self.attachments.len() > MAX_ATTACHMENTS {
            return invalid("more than 10 attachments");
        }
        for attachment in &self.attachments {
            let name_chars = attachment.name.chars().count();
            if !(1..=255).contains(&name_chars) {
                return invalid("an attachment name is not 1 to 255 characters");
            }
            if attachment.size > MAX_ATTACHMENT_PLAINTEXT {
                return invalid("an attachment is larger than 25 MiB");
            }
        }
        if self.link_previews.len() > MAX_LINK_PREVIEWS {
            return invalid("more than 3 link previews");
        }
        let too_long = |field: &Option<String>| {
            field
                .as_ref()
                .is_some_and(|text| text.chars().count() > MAX_PREVIEW_FIELD_CHARS)
        };
        for preview in &self.link_previews {
            if too_long(&preview.url)
                || too_long(&preview.title)
                || too_long(&preview.description)
                || too_long(&preview.site_name)
            {
                return invalid("a link preview field is longer than 2,000 characters");
            }
        }
        if self.to_bytes().len() > MAX_CONTENT_BYTES {
            return invalid("larger than 64 KiB");
        }
        Ok(())
    }
}

/// The distinct principal ids of `body`'s `<@principalId>` tokens, in order of first appearance.
/// A `<@…>` whose inside is not a principal id is plain text.
pub fn mentions_in(body: &str) -> Vec<String> {
    let mut mentions: Vec<String> = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("<@") {
        let after = &rest[start + 2..];
        match after.find('>') {
            Some(end) => {
                let candidate = &after[..end];
                if is_principal_id(candidate) && !mentions.iter().any(|m| m == candidate) {
                    mentions.push(candidate.to_string());
                }
                rest = &after[end + 1..];
            }
            None => break,
        }
    }
    mentions
}

/// Whether `body` notifies everyone: `@channel` or `@here` as a whole word, case-insensitively,
/// outside `<@…>` tokens. The server's rule for plaintext messages.
pub fn mentions_everyone(body: &str) -> bool {
    let plain = strip_mention_tokens(body).to_lowercase();
    ["@channel", "@here"]
        .iter()
        .any(|token| contains_whole_word(&plain, token))
}

fn strip_mention_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<@") {
        out.push_str(&rest[..start]);
        match rest[start..].find('>') {
            Some(end) => {
                out.push(' ');
                rest = &rest[start + end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn contains_whole_word(haystack: &str, needle: &str) -> bool {
    let mut from = 0;
    while let Some(position) = haystack[from..].find(needle) {
        let start = from + position;
        let end = start + needle.len();
        let before_ok = haystack[..start]
            .chars()
            .next_back()
            .is_none_or(|c| !is_word_char(c));
        let after_ok = haystack[end..]
            .chars()
            .next()
            .is_none_or(|c| !is_word_char(c));
        if before_ok && after_ok {
            return true;
        }
        from = start + haystack[start..].chars().next().map_or(1, char::len_utf8);
        if from >= haystack.len() {
            break;
        }
    }
    false
}

/// An MLS application message's plaintext: the format byte, the 32-byte franking key, the
/// content bytes.
pub(crate) fn application_data(franking_key: &[u8; 32], content: &[u8]) -> Zeroizing<Vec<u8>> {
    let mut data = Zeroizing::new(Vec::with_capacity(1 + 32 + content.len()));
    data.push(APPLICATION_DATA_VERSION);
    data.extend_from_slice(franking_key);
    data.extend_from_slice(content);
    data
}

/// Split application data into its franking key and content bytes.
pub(crate) fn split_application_data(data: &[u8]) -> Result<(Zeroizing<[u8; 32]>, &[u8])> {
    let malformed = || Error::malformed("application data", "not 0x01, a franking key and content");
    let (&version, rest) = data.split_first().ok_or_else(malformed)?;
    if version != APPLICATION_DATA_VERSION || rest.len() < 32 {
        return Err(malformed());
    }
    let (key, content) = rest.split_at(32);
    let mut franking_key = Zeroizing::new([0u8; 32]);
    franking_key.copy_from_slice(key);
    Ok((franking_key, content))
}

#[cfg(test)]
mod tests {
    use super::*;

    const P1: &str = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
    const P2: &str = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";

    #[test]
    fn mentions_are_distinct_principal_tokens_in_order() {
        let body = format!("<@{P2}> hi <@{P1}> and <@{P2}> <@nobody> <@{P1}");
        assert_eq!(mentions_in(&body), vec![P2.to_string(), P1.to_string()]);
        assert!(mentions_in("no tokens <@").is_empty());
    }

    #[test]
    fn everyone_mentions_are_whole_words_outside_tokens() {
        for body in ["heads up @channel", "@HERE: standup", "(@channel)"] {
            assert!(mentions_everyone(body), "{body}");
        }
        for body in ["mail me@channel.example", "@channels are fun", "<@here>"] {
            assert!(!mentions_everyone(body), "{body}");
        }
    }

    #[test]
    fn parse_refuses_unknown_duplicate_and_missing_fields() {
        let content = MessageContent::new(Uuid::nil(), format!("hi <@{P1}>"));
        let text = String::from_utf8(content.to_bytes()).unwrap();
        assert_eq!(MessageContent::parse(text.as_bytes()).unwrap(), content);

        let unknown = text.replacen("{", r#"{"extra":1,"#, 1);
        assert!(MessageContent::parse(unknown.as_bytes()).is_err());
        let duplicate = text.replacen(r#""rev":0"#, r#""rev":0,"rev":1"#, 1);
        assert!(MessageContent::parse(duplicate.as_bytes()).is_err());
        let missing = text.replacen(r#""threadRootId":null,"#, "", 1);
        assert!(MessageContent::parse(missing.as_bytes()).is_err());
        let missing_preview_field = MessageContent {
            link_previews: vec![LinkPreview::default()],
            ..content.clone()
        };
        let preview_text = String::from_utf8(missing_preview_field.to_bytes())
            .unwrap()
            .replacen(r#""siteName":null"#, r#""other":null"#, 1);
        assert!(MessageContent::parse(preview_text.as_bytes()).is_err());
    }

    #[test]
    fn the_rules_make_a_message_invalid() {
        let base = MessageContent::new(Uuid::nil(), format!("hi <@{P1}> @here"));
        assert!(base.check().is_ok());

        let wrong_mentions = MessageContent {
            mentions: vec![P2.to_string()],
            ..base.clone()
        };
        assert!(wrong_mentions.check().is_err());
        let no_everyone = MessageContent {
            mention_all: false,
            ..base.clone()
        };
        assert!(no_everyone.check().is_err());
        let long = MessageContent::new(Uuid::nil(), "x".repeat(MAX_BODY_CHARS + 1));
        assert!(long.check().is_err());
        assert!(MessageContent::new(Uuid::nil(), "é".repeat(MAX_BODY_CHARS))
            .check()
            .is_ok());
        let attachment = AttachmentEntry {
            blob_sha256: [0; 32],
            secret: Zeroizing::new([0; 32]),
            name: String::new(),
            mime: "text/plain".into(),
            size: 1,
        };
        let unnamed = MessageContent {
            attachments: vec![attachment],
            ..base.clone()
        };
        assert!(unnamed.check().is_err());
        let previews = MessageContent {
            link_previews: vec![LinkPreview::default(); 4],
            ..base
        };
        assert!(previews.check().is_err());
    }

    #[test]
    fn application_data_round_trips() {
        let data = application_data(&[7; 32], b"{}");
        assert_eq!(data[0], 1);
        let (key, content) = split_application_data(&data).unwrap();
        assert_eq!(*key, [7; 32]);
        assert_eq!(content, b"{}");
        assert!(split_application_data(&[2; 40]).is_err());
        assert!(split_application_data(&[1; 20]).is_err());
    }
}
