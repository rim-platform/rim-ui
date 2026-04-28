use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::State;

use super::session::{PtySession, SessionInfo};
use super::{TerminalState, MAX_SESSIONS};

#[tauri::command]
pub fn terminal_create(
    app_handle: tauri::AppHandle,
    state: State<'_, TerminalState>,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    if sessions.len() >= MAX_SESSIONS {
        return Err(format!(
            "maximum number of terminal sessions reached ({MAX_SESSIONS})"
        ));
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let session =
        PtySession::spawn(app_handle, session_id.clone(), shell, cwd).map_err(|e| e.to_string())?;

    sessions.insert(session_id.clone(), session);
    Ok(session_id)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;

    let bytes = BASE64
        .decode(&data)
        .map_err(|e| format!("invalid base64: {e}"))?;

    session.write(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;

    session.resize(cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        sessions
            .remove(&session_id)
            .ok_or_else(|| format!("session not found: {session_id}"))?
        // Lock is released here — other terminal commands are not blocked during shutdown
    };

    session.shutdown();
    Ok(())
}

#[tauri::command]
pub fn terminal_list(state: State<'_, TerminalState>) -> Result<Vec<SessionInfo>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    let infos = sessions
        .values()
        .map(|s| SessionInfo {
            id: s.session_id.clone(),
            shell: s.shell.clone(),
            running: true, // If it's in the map, the PTY was spawned
        })
        .collect();

    Ok(infos)
}
