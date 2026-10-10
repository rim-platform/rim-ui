//! Spaces hosted on another server, reached through this app's relay: checking what servers
//! sign (their key logs and descriptors, host responses and events, revocation
//! acknowledgements), direct connections to a server when the relay is unreachable, and the
//! proof-of-work a relay in `pow` registration mode asks of a key-only signup. The device
//! statements the app signs for such a space live with the device key in `key_identity`.

pub(crate) mod commands;
pub(crate) mod direct;
pub(crate) mod pow;
pub(crate) mod server;
