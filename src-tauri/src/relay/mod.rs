//! Spaces hosted on another server, reached through this app's relay: checking what servers
//! sign (their key logs and descriptors, host responses and host events). The device request
//! the app signs for such a space lives with the device key in `key_identity`.

pub(crate) mod commands;
pub(crate) mod server;
