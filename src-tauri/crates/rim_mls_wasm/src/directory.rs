//! Who a group's leaves are: a [`DeviceDirectory`] over what the page found out (it replays key
//! logs and checks device certificates with WebCrypto) and the devices it verified before.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use rim_mls::{DeviceDirectory, DeviceStatus, Leaf, LeafError, LeafProblem};
use serde::{Deserialize, Serialize};

/// What the page knows about one device of a fetched principal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceAnswer {
    principal_id: String,
    device_id: String,
    /// `certified` (with `deviceKey`) or `revoked`.
    status: String,
    #[serde(default)]
    device_key: Option<String>,
}

/// A device verified before, with its certified key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnownDevice {
    principal_id: String,
    device_id: String,
    device_key: String,
}

/// The page's answers: the conversation's members, the principals it fetched (and those whose
/// key log does not replay), their devices, and devices verified before. A device of a
/// principal that was not fetched is answered from `remembered`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryInput {
    members: Vec<String>,
    #[serde(default)]
    fetched: Vec<String>,
    #[serde(default)]
    invalid_logs: Vec<String>,
    #[serde(default)]
    devices: Vec<DeviceAnswer>,
    #[serde(default)]
    remembered: Vec<KnownDevice>,
}

pub(crate) struct Directory {
    members: HashSet<String>,
    fetched: HashSet<String>,
    invalid_logs: HashSet<String>,
    answers: HashMap<(String, String), DeviceStatus>,
    remembered: HashMap<(String, String), String>,
    /// Principals asked about that were neither fetched nor remembered.
    missing: RefCell<HashSet<String>>,
}

fn device_key(principal_id: &str, device_id: &str) -> (String, String) {
    (principal_id.to_string(), device_id.to_lowercase())
}

impl Directory {
    pub(crate) fn new(input: &DirectoryInput) -> Self {
        let answers = input
            .devices
            .iter()
            .filter_map(|d| {
                let status = match (d.status.as_str(), &d.device_key) {
                    ("certified", Some(key)) => DeviceStatus::Certified {
                        device_key: key.clone(),
                    },
                    ("revoked", _) => DeviceStatus::Revoked,
                    _ => return None,
                };
                Some((device_key(&d.principal_id, &d.device_id), status))
            })
            .collect();
        Self {
            members: input.members.iter().cloned().collect(),
            fetched: input.fetched.iter().cloned().collect(),
            invalid_logs: input.invalid_logs.iter().cloned().collect(),
            answers,
            remembered: input
                .remembered
                .iter()
                .map(|d| {
                    (
                        device_key(&d.principal_id, &d.device_id),
                        d.device_key.clone(),
                    )
                })
                .collect(),
            missing: RefCell::new(HashSet::new()),
        }
    }

    fn lookup(&self, principal_id: &str, device_id: &str) -> DeviceStatus {
        if self.invalid_logs.contains(principal_id) {
            return DeviceStatus::KeyLogInvalid;
        }
        let key = device_key(principal_id, device_id);
        if self.fetched.contains(principal_id) {
            return self
                .answers
                .get(&key)
                .cloned()
                .unwrap_or(DeviceStatus::Unknown);
        }
        match self.remembered.get(&key) {
            Some(device_key) => DeviceStatus::Certified {
                device_key: device_key.clone(),
            },
            None => {
                self.missing.borrow_mut().insert(principal_id.to_string());
                DeviceStatus::Unknown
            }
        }
    }
}

impl DeviceDirectory for Directory {
    fn device(&self, principal_id: &str, device_id: &uuid::Uuid) -> DeviceStatus {
        self.lookup(principal_id, &device_id.hyphenated().to_string())
    }

    fn is_member(&self, principal_id: &str) -> bool {
        self.members.contains(principal_id)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnverifiedWire {
    principal_id: String,
    device_id: String,
    reason: &'static str,
}

/// The result of checking a group's leaves. With `missing` set, nothing else is: fetch those
/// principals and check again.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyOutcome {
    missing: Vec<String>,
    unverified: Vec<UnverifiedWire>,
    /// Devices of fetched principals that passed, to remember.
    verified: Vec<KnownDevice>,
}

fn reason(error: &LeafError) -> &'static str {
    match error {
        LeafError::BadCredential(_) => "badCredential",
        LeafError::KeyLogInvalid => "keyLogInvalid",
        LeafError::UnknownDevice => "unknownDevice",
        LeafError::RevokedDevice => "revokedDevice",
        LeafError::BadStatementSignature => "badStatementSignature",
        LeafError::KeyMismatch => "keyMismatch",
        LeafError::NotMember => "notMember",
        LeafError::DuplicateDevice => "duplicateDevice",
    }
}

impl VerifyOutcome {
    pub(crate) fn new(directory: &Directory, leaves: &[Leaf], problems: &[LeafProblem]) -> Self {
        let mut missing: Vec<String> = directory.missing.borrow().iter().cloned().collect();
        if !missing.is_empty() {
            missing.sort();
            return Self {
                missing,
                unverified: vec![],
                verified: vec![],
            };
        }
        let failed: HashSet<u32> = problems.iter().map(|p| p.leaf.index).collect();
        let verified = leaves
            .iter()
            .filter(|leaf| !failed.contains(&leaf.index))
            .filter_map(|leaf| leaf.device())
            .filter(|device| directory.fetched.contains(&device.principal_id))
            .filter_map(|device| {
                let device_id = device.device_id.hyphenated().to_string();
                match directory.lookup(&device.principal_id, &device_id) {
                    DeviceStatus::Certified { device_key } => Some(KnownDevice {
                        principal_id: device.principal_id,
                        device_id,
                        device_key,
                    }),
                    _ => None,
                }
            })
            .collect();
        let unverified = problems
            .iter()
            .map(|problem| {
                let device = problem.leaf.device();
                UnverifiedWire {
                    principal_id: device
                        .as_ref()
                        .map(|d| d.principal_id.clone())
                        .unwrap_or_default(),
                    device_id: device
                        .as_ref()
                        .map(|d| d.device_id.hyphenated().to_string())
                        .unwrap_or_default(),
                    reason: reason(&problem.error),
                }
            })
            .collect();
        Self {
            missing: vec![],
            unverified,
            verified,
        }
    }
}
