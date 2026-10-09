//! Test devices: an engine, a memory store, a device key, and the directory that vouches for them.

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use ed25519_dalek::{Signer as _, SigningKey};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::codec::b64;
use crate::{
    ClaimedKeyPackage, DeviceDirectory, DeviceRef, DeviceStatus, MemoryStore, Mls, SignedStatement,
};

/// Which crypto provider a test device runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Provider {
    Libcrux,
    RustCrypto,
}

pub(crate) fn engine(provider: Provider) -> Mls {
    match provider {
        Provider::Libcrux => Mls::new().unwrap(),
        Provider::RustCrypto => Mls::rust_crypto(),
    }
}

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// A principal id for test user `n`.
pub(crate) fn principal(n: u8) -> String {
    format!("rimp1_{}", b64(&Sha256::digest([b'p', n])))
}

/// Device `d` of user `n`.
pub(crate) fn device_ref(n: u8, d: u8) -> DeviceRef {
    DeviceRef {
        principal_id: principal(n),
        device_id: Uuid::from_u128(((n as u128) << 64) | d as u128),
    }
}

pub(crate) fn device_signing_key(device: &DeviceRef) -> SigningKey {
    SigningKey::from_bytes(&Sha256::digest(device.device_id.as_bytes()).into())
}

pub(crate) fn tagged_public(key: &SigningKey) -> String {
    format!("ed25519:{}", b64(key.verifying_key().as_bytes()))
}

pub(crate) fn sign(key: &SigningKey, context: &[u8], payload: String) -> SignedStatement {
    let mut message = context.to_vec();
    message.extend_from_slice(payload.as_bytes());
    SignedStatement {
        signature: format!("ed25519:{}", b64(&key.sign(&message).to_bytes())),
        payload,
    }
}

/// One device: its engine and store, and its device key.
pub(crate) struct TestDevice {
    pub(crate) mls: Mls,
    pub(crate) store: MemoryStore,
    pub(crate) device: DeviceRef,
    pub(crate) device_key: SigningKey,
}

impl TestDevice {
    pub(crate) fn new(provider: Provider, n: u8, d: u8) -> Self {
        let device = device_ref(n, d);
        let device_key = device_signing_key(&device);
        let this = Self {
            mls: engine(provider),
            store: MemoryStore::new(),
            device,
            device_key,
        };
        this.enroll();
        this
    }

    /// Generate an MLS key and install a statement for it, as after lost state.
    pub(crate) fn enroll(&self) {
        let key = self.device_key.clone();
        self.mls
            .ensure_identity(
                &self.store,
                &self.device,
                &tagged_public(&self.device_key),
                |context, payload| sign(&key, context, payload),
            )
            .unwrap();
        self.store.commit();
    }

    /// A one-time key package as the server would hand it out.
    pub(crate) fn key_package(&self) -> ClaimedKeyPackage {
        let generated = self
            .mls
            .generate_key_packages(&self.store, 1, false, now())
            .unwrap()
            .remove(0);
        self.store.commit();
        ClaimedKeyPackage {
            device: self.device.clone(),
            key_package: generated.message,
        }
    }
}

/// A directory that knows a set of certified devices and the conversation's members.
#[derive(Default)]
pub(crate) struct Directory {
    pub(crate) devices: HashMap<(String, Uuid), DeviceStatus>,
    pub(crate) members: HashSet<String>,
}

impl Directory {
    pub(crate) fn with(devices: &[&TestDevice]) -> Self {
        let mut directory = Self::default();
        for device in devices {
            directory.add(device);
        }
        directory
    }

    pub(crate) fn add(&mut self, device: &TestDevice) {
        self.devices.insert(
            (device.device.principal_id.clone(), device.device.device_id),
            DeviceStatus::Certified {
                device_key: tagged_public(&device.device_key),
            },
        );
        self.members.insert(device.device.principal_id.clone());
    }
}

impl DeviceDirectory for Directory {
    fn device(&self, principal_id: &str, device_id: &Uuid) -> DeviceStatus {
        self.devices
            .get(&(principal_id.to_string(), *device_id))
            .cloned()
            .unwrap_or(DeviceStatus::Unknown)
    }

    fn is_member(&self, principal_id: &str) -> bool {
        self.members.contains(principal_id)
    }
}
