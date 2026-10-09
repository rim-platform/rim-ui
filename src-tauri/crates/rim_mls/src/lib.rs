//! End-to-end encryption of RIM DMs and groups with MLS (RFC 9420).
//!
//! This crate is the only code that names OpenMLS types. Everything it exposes is in RIM's terms:
//! conversations and incarnations ([`ConversationGroup`]), devices ([`DeviceRef`]), message
//! content ([`MessageContent`]), and `MLSMessage` bytes as the server stores them.
//!
//! - Every operation runs on one [`Store`]: a [`SqliteStore`] over a transaction the caller owns
//!   (the app's encrypted cache database), or a [`MemoryStore`]. The crate never commits: the
//!   caller commits after storing what the operation produced, so decrypting a message, storing
//!   its plaintext and advancing the ratchet happen together or not at all.
//! - Groups use suite 0x004F (X25519 + ML-KEM-768 hybrid KEM, AES-128-GCM, SHA-256, Ed25519)
//!   through the libcrux provider.
//! - A device signs MLS messages with its own MLS signature key, which its device key certifies
//!   in an `mls-key` statement; the device key stays with the app.

mod error;
mod provider;
mod storage;

pub use error::{Error, Result};
pub use storage::{Change, MemoryStore, Store};
#[cfg(feature = "sqlite")]
pub use storage::{SqliteStore, SCHEMA};
