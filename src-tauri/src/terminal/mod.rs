pub mod commands;
pub mod session;

use std::collections::HashMap;
use std::sync::Mutex;

use session::PtySession;

pub const MAX_SESSIONS: usize = 10;

/// Managed state for all terminal sessions.
pub struct TerminalState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        // Recover data even from a poisoned mutex — cleanup must happen regardless
        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Drain all sessions — Drop on PtySession handles cleanup
        sessions.drain();
    }
}

pub fn init() -> TerminalState {
    TerminalState::new()
}
