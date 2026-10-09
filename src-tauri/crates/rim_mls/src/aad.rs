//! The authenticated data of a PrivateMessage: cleartext the server reads, signed by the sender
//! inside the encryption.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::codec::{b64, is_principal_id, parse_uuid, strict_json, to_json, unb64, unb64_32};
use crate::error::{Error, Result};
use crate::identity::DeviceRef;

/// Largest authenticated data of an application message.
pub const MAX_APPLICATION_AAD: usize = 8 * 1024;
/// Largest authenticated data of a Commit.
pub const MAX_COMMIT_AAD: usize = 256 * 1024;

/// What an application message tells the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationAad {
    pub message_id: Uuid,
    /// The franking commitment.
    pub franking: [u8; 32],
    pub mentions: Vec<String>,
    pub mention_all: bool,
}

/// The membership a Commit changes, as it tells the server.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommitSummary {
    pub adds: Vec<AddedDevice>,
    pub removes: Vec<DeviceRef>,
}

/// A device a Commit adds, and the key package it adds it with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddedDevice {
    pub device: DeviceRef,
    pub key_package_ref: Vec<u8>,
}

/// Authenticated data of either kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthenticatedData {
    Application(ApplicationAad),
    Commit(CommitSummary),
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Wire {
    #[serde(rename_all = "camelCase")]
    Application {
        v: u8,
        message_id: String,
        franking: String,
        mentions: Vec<String>,
        mention_all: bool,
    },
    #[serde(rename_all = "camelCase")]
    Commit {
        v: u8,
        adds: Vec<AddWire>,
        removes: Vec<RemoveWire>,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddWire {
    principal_id: String,
    device_id: String,
    key_package_ref: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveWire {
    principal_id: String,
    device_id: String,
}

impl ApplicationAad {
    /// The JSON, `v` and `type` first and then the fields in their fixed order.
    pub fn to_bytes(&self) -> Vec<u8> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Out<'a> {
            v: u8,
            #[serde(rename = "type")]
            kind: &'a str,
            message_id: String,
            franking: String,
            mentions: &'a [String],
            mention_all: bool,
        }
        to_json(&Out {
            v: 1,
            kind: "application",
            message_id: self.message_id.hyphenated().to_string(),
            franking: b64(&self.franking),
            mentions: &self.mentions,
            mention_all: self.mention_all,
        })
        .into_bytes()
    }
}

impl CommitSummary {
    /// The JSON, `v` and `type` first and then the fields in their fixed order.
    pub fn to_bytes(&self) -> Vec<u8> {
        #[derive(Serialize)]
        struct Out<'a> {
            v: u8,
            #[serde(rename = "type")]
            kind: &'a str,
            adds: Vec<AddWire>,
            removes: Vec<RemoveWire>,
        }
        to_json(&Out {
            v: 1,
            kind: "commit",
            adds: self
                .adds
                .iter()
                .map(|add| AddWire {
                    principal_id: add.device.principal_id.clone(),
                    device_id: add.device.device_id.hyphenated().to_string(),
                    key_package_ref: b64(&add.key_package_ref),
                })
                .collect(),
            removes: self
                .removes
                .iter()
                .map(|device| RemoveWire {
                    principal_id: device.principal_id.clone(),
                    device_id: device.device_id.hyphenated().to_string(),
                })
                .collect(),
        })
        .into_bytes()
    }
}

fn device(principal_id: String, device_id: &str) -> Result<DeviceRef> {
    if !is_principal_id(&principal_id) {
        return Err(Error::malformed("authenticated data", "bad principal id"));
    }
    Ok(DeviceRef {
        principal_id,
        device_id: parse_uuid(device_id, "device id")?,
    })
}

impl AuthenticatedData {
    /// Read authenticated data strictly, with its size cap.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_COMMIT_AAD {
            return Err(Error::malformed("authenticated data", "too large"));
        }
        match strict_json::<Wire>(bytes, "authenticated data")? {
            Wire::Application {
                v,
                message_id,
                franking,
                mentions,
                mention_all,
            } => {
                if v != 1 || bytes.len() > MAX_APPLICATION_AAD {
                    return Err(Error::malformed(
                        "authenticated data",
                        "wrong version or size",
                    ));
                }
                if !mentions.iter().all(|m| is_principal_id(m)) {
                    return Err(Error::malformed("authenticated data", "bad mention"));
                }
                Ok(Self::Application(ApplicationAad {
                    message_id: parse_uuid(&message_id, "message id")?,
                    franking: unb64_32(&franking, "franking commitment")?,
                    mentions,
                    mention_all,
                }))
            }
            Wire::Commit { v, adds, removes } => {
                if v != 1 {
                    return Err(Error::malformed("authenticated data", "wrong version"));
                }
                Ok(Self::Commit(CommitSummary {
                    adds: adds
                        .into_iter()
                        .map(|add| -> Result<AddedDevice> {
                            Ok(AddedDevice {
                                device: device(add.principal_id, &add.device_id)?,
                                key_package_ref: unb64(&add.key_package_ref)?,
                            })
                        })
                        .collect::<Result<_>>()?,
                    removes: removes
                        .into_iter()
                        .map(|remove| device(remove.principal_id, &remove.device_id))
                        .collect::<Result<_>>()?,
                }))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P1: &str = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";

    #[test]
    fn both_kinds_round_trip_and_are_strict() {
        let app = ApplicationAad {
            message_id: Uuid::nil(),
            franking: [1; 32],
            mentions: vec![P1.into()],
            mention_all: false,
        };
        let bytes = app.to_bytes();
        assert!(bytes.starts_with(br#"{"v":1,"type":"application","messageId""#));
        assert_eq!(
            AuthenticatedData::parse(&bytes).unwrap(),
            AuthenticatedData::Application(app)
        );

        let commit = CommitSummary {
            adds: vec![AddedDevice {
                device: DeviceRef {
                    principal_id: P1.into(),
                    device_id: Uuid::nil(),
                },
                key_package_ref: vec![9; 32],
            }],
            removes: vec![],
        };
        let bytes = commit.to_bytes();
        assert_eq!(
            AuthenticatedData::parse(&bytes).unwrap(),
            AuthenticatedData::Commit(commit)
        );

        let text = String::from_utf8(bytes).unwrap();
        for bad in [
            text.replacen(r#""removes":[]"#, r#""removes":[],"x":1"#, 1),
            text.replacen(r#""removes":[]"#, r#""removes":[],"removes":[]"#, 1),
            text.replacen(r#","removes":[]"#, "", 1),
            text.replacen(r#""v":1"#, r#""v":2"#, 1),
            text.replacen("commit", "proposal", 1),
        ] {
            assert!(AuthenticatedData::parse(bad.as_bytes()).is_err(), "{bad}");
        }
    }
}
