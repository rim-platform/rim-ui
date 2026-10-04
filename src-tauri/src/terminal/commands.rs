use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use super::session::{resolve_cwd, resolve_shell, PtySession, SessionInfo};
use super::{TerminalState, MAX_SESSIONS};

/// Create a terminal session (S-H1 hardened).
///
/// 1. `shell` / `cwd` are validated (`/etc/shells` or the Windows allowlist;
///    an existing directory inside the home directory).
/// 2. On the first call of an app run, a native confirmation dialog — drawn by
///    the OS, not the renderer — must be accepted. The approval is remembered
///    in [`TerminalState`] until the app exits.
/// 3. Only then is the PTY spawned.
#[tauri::command]
pub async fn terminal_create(
    app_handle: tauri::AppHandle,
    state: State<'_, TerminalState>,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let shell_path = resolve_shell(shell.as_deref()).map_err(|e| e.to_string())?;
    let cwd_path = resolve_cwd(cwd.as_deref()).map_err(|e| e.to_string())?;

    let prompt_handle = app_handle.clone();
    let prompt_shell = shell_path.clone();
    let prompt_cwd = cwd_path.display().to_string();
    state
        .approval
        .ensure(|| confirm_terminal(prompt_handle, prompt_shell, prompt_cwd))
        .await?;

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
    let session = PtySession::spawn(app_handle, session_id.clone(), shell_path, cwd_path)
        .map_err(|e| e.to_string())?;

    sessions.insert(session_id.clone(), session);
    Ok(session_id)
}

/// Show the native "allow terminal" confirmation and wait for the answer.
/// Any failure to show or answer the dialog counts as "declined".
async fn confirm_terminal(app_handle: tauri::AppHandle, shell: String, cwd: String) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .message(format!(
            "RIM is about to start an interactive shell:\n\n    {shell}\n    in {cwd}\n\n\
             Anything typed into it runs with your user account's full privileges. \
             Only continue if you opened the terminal yourself.\n\n\
             You will not be asked again until RIM is restarted."
        ))
        .title("Allow terminal access?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open terminal".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    rx.await.unwrap_or(false)
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
