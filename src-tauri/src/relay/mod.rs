//! Spaces hosted on another server, reached through this app's relay: checking what servers
//! sign (their key logs and descriptors, host responses and events, revocation
//! acknowledgements), and direct connections to a server when the relay is unreachable. The
//! device statements the app signs for such a space live with the device key in
//! `key_identity`.

pub(crate) mod commands;
pub(crate) mod direct;
pub(crate) mod server;
