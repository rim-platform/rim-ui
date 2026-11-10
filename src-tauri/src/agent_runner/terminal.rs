//! Opening the computer's terminal running an allowed program, for an agent's sign-in: after a
//! native dialog that shows the exact command and environment. The terminal is not tracked.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;

use serde::Serialize;

use super::{lookup, shown, AgentRunner, MAX_ALLOW_ARGS, MAX_ALLOW_ARG_LEN};

/// Most environment variables a terminal can be given.
const MAX_ENV: usize = 16;
/// Longest environment variable name, in characters.
const MAX_ENV_NAME: usize = 64;
/// Longest environment variable value, in characters.
const MAX_ENV_VALUE: usize = 1024;
/// The refusal when the program is not on the allow list.
const NOT_ALLOWED_PROGRAM: &str = "Only an allowed program can be opened in a terminal.";
/// The last paragraph of the dialog.
const TERMINAL_WARNING: &str =
    "RIM opens a terminal window that runs this command as you. RIM doesn't sandbox it.";
/// The characters `cmd.exe` gives a meaning to, refused in a command for it.
#[cfg(any(windows, test))]
const CMD_SPECIAL: &[char] = &['"', '%', '^', '&', '|', '<', '>', '\n', '\r'];
/// How long the script a macOS terminal runs is kept before it is deleted.
#[cfg(target_os = "macos")]
const SCRIPT_KEPT: std::time::Duration = std::time::Duration::from_secs(120);

/// What came of asking to open a terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalOutcome {
    /// A terminal was opened.
    Opened,
    /// The person chose Cancel.
    Declined,
    /// No terminal was found: the command line for the person to run themselves.
    #[serde(rename_all = "camelCase")]
    NoTerminal { command_line: String },
}

impl AgentRunner {
    /// Asks the person, in a native dialog, whether to open a terminal running `program` with
    /// `args` and `env`, then opens the computer's terminal with it. `program` must be the
    /// program of an entry on the allow list, exactly; its arguments may differ.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the program is not allowed, the arguments or variables are
    /// too many, too long or not valid, or the question could not be shown.
    pub(crate) async fn open_terminal(
        &self,
        program: &str,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    ) -> Result<TerminalOutcome, String> {
        if !self.allowed().iter().any(|entry| entry.program == program) {
            return Err(NOT_ALLOWED_PROGRAM.to_owned());
        }
        check_terminal_args(&args)?;
        check_env(&env)?;
        #[cfg(windows)]
        check_cmd_safe(program, &args)?;
        let file_name = Path::new(program)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| program.to_owned());
        let title = format!("Open a terminal for {}?", shown(&file_name));
        if !self
            .ask(&title, terminal_message(program, &args, &env), "Open")
            .await?
        {
            return Ok(TerminalOutcome::Declined);
        }
        let dirs = lookup::search_dirs().await;
        let mut vars: Vec<(String, OsString)> = env
            .iter()
            .map(|(name, value)| (name.clone(), OsString::from(value)))
            .collect();
        if let Some(path) = self.run_path(&dirs) {
            vars.push(("PATH".to_owned(), path));
        }
        if launch(program, &args, &vars, &dirs).await {
            log::info!("[agent_runner] a terminal was opened for an allowed program");
            Ok(TerminalOutcome::Opened)
        } else {
            Ok(TerminalOutcome::NoTerminal {
                command_line: command_line(program, &args, &env),
            })
        }
    }
}

/// Refuses more than [`MAX_ALLOW_ARGS`] arguments, one over [`MAX_ALLOW_ARG_LEN`] characters or
/// one holding a NUL.
fn check_terminal_args(args: &[String]) -> Result<(), String> {
    if args.len() > MAX_ALLOW_ARGS
        || args
            .iter()
            .any(|arg| arg.chars().count() > MAX_ALLOW_ARG_LEN || arg.contains('\0'))
    {
        return Err(format!(
            "A terminal can be opened with at most {MAX_ALLOW_ARGS} arguments of at most \
             {MAX_ALLOW_ARG_LEN} characters each."
        ));
    }
    Ok(())
}

/// Refuses more than [`MAX_ENV`] variables, a name that is not capital letters, digits and `_`
/// starting with a letter or `_`, a name that changes how programs are found or loaded, and a
/// value over [`MAX_ENV_VALUE`] characters or holding a NUL or a line break.
fn check_env(env: &BTreeMap<String, String>) -> Result<(), String> {
    if env.len() > MAX_ENV {
        return Err(format!(
            "A terminal can be given at most {MAX_ENV} environment variables."
        ));
    }
    for (name, value) in env {
        if !is_env_name(name) {
            return Err(format!(
                "{} is not a valid environment variable name.",
                shown(name)
            ));
        }
        if is_loader_variable(name) {
            return Err(format!("{name} cannot be set for a terminal."));
        }
        if value.chars().count() > MAX_ENV_VALUE || value.contains(['\0', '\n', '\r']) {
            return Err(format!(
                "The value of {name} must be one line of at most {MAX_ENV_VALUE} characters."
            ));
        }
    }
    Ok(())
}

/// Whether `name` matches `^[A-Z_][A-Z0-9_]{0,63}$`.
fn is_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    name.len() <= MAX_ENV_NAME
        && (first.is_ascii_uppercase() || first == '_')
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Whether `name` decides which program or library runs: `PATH`, the dynamic loader's variables
/// and `NODE_OPTIONS`.
fn is_loader_variable(name: &str) -> bool {
    name == "PATH" || name == "NODE_OPTIONS" || name.starts_with("LD_") || name.starts_with("DYLD_")
}

/// Refuses a program or an argument holding a character `cmd.exe` gives a meaning to.
#[cfg(any(windows, test))]
fn check_cmd_safe(program: &str, args: &[String]) -> Result<(), String> {
    if program.contains(CMD_SPECIAL) || args.iter().any(|arg| arg.contains(CMD_SPECIAL)) {
        return Err(
            "On Windows, a terminal cannot be opened with \", %, ^, &, |, <, > or a line break \
             in the command."
                .to_owned(),
        );
    }
    Ok(())
}

/// The dialog's message: the program and each argument on its own line, each variable as
/// `NAME=value`, then [`TERMINAL_WARNING`].
fn terminal_message(program: &str, args: &[String], env: &BTreeMap<String, String>) -> String {
    let mut lines = vec![shown(program)];
    lines.extend(args.iter().map(|arg| shown(arg)));
    let mut message = lines.join("\n");
    if !env.is_empty() {
        let vars: Vec<String> = env
            .iter()
            .map(|(name, value)| format!("{name}={}", shown(value)))
            .collect();
        message.push_str("\n\nWith:\n");
        message.push_str(&vars.join("\n"));
    }
    format!("{message}\n\n{TERMINAL_WARNING}")
}

/// The command as the person would type it in this computer's shell, the variables first.
fn command_line(program: &str, args: &[String], env: &BTreeMap<String, String>) -> String {
    #[cfg(windows)]
    {
        let mut line = String::new();
        for (name, value) in env {
            line.push_str(&format!("set \"{name}={value}\" && "));
        }
        line.push_str(&windows_command_line(program, args));
        line
    }
    #[cfg(not(windows))]
    {
        let mut parts: Vec<String> = env
            .iter()
            .map(|(name, value)| format!("{name}={}", sh_quote(value)))
            .collect();
        parts.push(sh_quote(program));
        parts.extend(args.iter().map(|arg| sh_quote(arg)));
        parts.join(" ")
    }
}

/// `text` as one word for a POSIX shell: as it is when it holds only safe characters, otherwise
/// in single quotes.
#[cfg(any(unix, test))]
fn sh_quote(text: &str) -> String {
    let plain = !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./:=@%+,-".contains(c));
    if plain {
        text.to_owned()
    } else {
        format!("'{}'", text.replace('\'', "'\\''"))
    }
}

/// `program` and `args` as one Windows command line, each part quoted when it is empty or holds
/// a space or a tab, with the backslashes before a closing quote doubled. The parts hold no `"`.
#[cfg(any(windows, test))]
fn windows_command_line(program: &str, args: &[String]) -> String {
    std::iter::once(program)
        .chain(args.iter().map(String::as_str))
        .map(windows_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

/// One part of [`windows_command_line`].
#[cfg(any(windows, test))]
fn windows_quote(part: &str) -> String {
    if !part.is_empty() && !part.contains([' ', '\t']) {
        return part.to_owned();
    }
    let trailing = part.len() - part.trim_end_matches('\\').len();
    format!("\"{part}{}\"", "\\".repeat(trailing))
}

/// Opens Terminal running a script that sets `vars` and runs the command.
#[cfg(target_os = "macos")]
async fn launch(
    program: &str,
    args: &[String],
    vars: &[(String, OsString)],
    _: &[std::path::PathBuf],
) -> bool {
    match write_command_script(program, args, vars) {
        Ok(dir) => {
            let script = dir.join("rim-sign-in.command");
            let opened = tokio::process::Command::new("/usr/bin/open")
                .arg("-a")
                .arg("Terminal")
                .arg(&script)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await
                .is_ok_and(|status| status.success());
            tokio::spawn(async move {
                tokio::time::sleep(SCRIPT_KEPT).await;
                let _ = std::fs::remove_dir_all(dir);
            });
            opened
        }
        Err(error) => {
            log::warn!("[agent_runner] the terminal script could not be written: {error}");
            false
        }
    }
}

/// Writes `rim-sign-in.command`, runnable by this user only, into a new private folder in the
/// temporary directory, and returns the folder.
///
/// # Errors
///
/// The error of creating the folder or writing the file.
#[cfg(target_os = "macos")]
fn write_command_script(
    program: &str,
    args: &[String],
    vars: &[(String, OsString)],
) -> std::io::Result<std::path::PathBuf> {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).map_err(std::io::Error::other)?;
    let dir = std::env::temp_dir().join(format!("rim-terminal-{}", hex::encode(bytes)));
    std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
    let mut script = String::from("#!/bin/sh\n");
    for (name, value) in vars {
        script.push_str(&format!(
            "export {name}={}\n",
            sh_quote(&value.to_string_lossy())
        ));
    }
    let mut command = vec![sh_quote(program)];
    command.extend(args.iter().map(|arg| sh_quote(arg)));
    script.push_str(&format!("exec {}\n", command.join(" ")));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o700)
        .open(dir.join("rim-sign-in.command"))?;
    file.write_all(script.as_bytes())?;
    Ok(dir)
}

/// Opens a new console running `cmd.exe /k` with the command, through `start`.
#[cfg(windows)]
async fn launch(
    program: &str,
    args: &[String],
    vars: &[(String, OsString)],
    _: &[std::path::PathBuf],
) -> bool {
    use std::os::windows::process::CommandExt;
    // The outer quotes are the pair `cmd.exe /k` strips when its command starts with a quote.
    let line = format!(
        "/c start \"RIM\" cmd.exe /k \"{}\"",
        windows_command_line(program, args)
    );
    let mut command = std::process::Command::new("cmd.exe");
    command
        .raw_arg(line)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(super::process::CREATE_NO_WINDOW);
    for (name, value) in vars {
        command.env(name, value);
    }
    match command.spawn() {
        Ok(_) => true,
        Err(error) => {
            log::warn!("[agent_runner] cmd.exe could not be started: {error}");
            false
        }
    }
}

/// Starts the first terminal found, running the program with its arguments as separate argv
/// entries, without a shell.
#[cfg(all(unix, not(target_os = "macos")))]
async fn launch(
    program: &str,
    args: &[String],
    vars: &[(String, OsString)],
    dirs: &[std::path::PathBuf],
) -> bool {
    let terminal = std::env::var("TERMINAL").ok();
    for argv in terminal_commands(terminal.as_deref(), dirs, program, args) {
        let mut command = tokio::process::Command::new(&argv[0]);
        crate::host_env::restore_host_env(&mut command);
        command
            .args(&argv[1..])
            .envs(vars.iter().map(|(name, value)| (name, value)))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0);
        match command.spawn() {
            Ok(mut child) => {
                tokio::spawn(async move {
                    let _ = child.wait().await;
                });
                return true;
            }
            Err(error) => {
                log::warn!("[agent_runner] a terminal could not be started: {error}");
            }
        }
    }
    false
}

/// The terminals tried on Linux and the BSDs, in order, each with the arguments that come before
/// the command.
#[cfg(any(all(unix, not(target_os = "macos")), test))]
const TERMINALS: &[(&str, &[&str])] = &[
    ("x-terminal-emulator", &["-e"]),
    ("gnome-terminal", &["--"]),
    ("konsole", &["-e"]),
    ("xfce4-terminal", &["-x"]),
    ("kitty", &[]),
    ("alacritty", &["-e"]),
    ("foot", &[]),
    ("wezterm", &["start", "--"]),
    ("xterm", &["-e"]),
];

/// The full command of each terminal found in `dirs`, in the order they are tried: first
/// `terminal` (the `TERMINAL` variable, a bare name), with the arguments of the known terminal
/// of that name or `-e`, then [`TERMINALS`].
#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn terminal_commands(
    terminal: Option<&str>,
    dirs: &[std::path::PathBuf],
    program: &str,
    args: &[String],
) -> Vec<Vec<OsString>> {
    let mut chosen: Vec<(std::path::PathBuf, Vec<&str>)> = Vec::new();
    if let Some(name) = terminal.filter(|name| lookup::is_bare_name(name)) {
        if let Some(path) = lookup::find_in(name, dirs, None) {
            let prefix = TERMINALS
                .iter()
                .find(|(known, _)| *known == name)
                .map_or_else(|| vec!["-e"], |(_, prefix)| prefix.to_vec());
            chosen.push((path, prefix));
        }
    }
    for (name, prefix) in TERMINALS {
        if let Some(path) = lookup::find_in(name, dirs, None) {
            if !chosen.iter().any(|(found, _)| *found == path) {
                chosen.push((path, prefix.to_vec()));
            }
        }
    }
    chosen
        .into_iter()
        .map(|(path, prefix)| {
            let mut argv = vec![path.into_os_string()];
            argv.extend(prefix.into_iter().map(OsString::from));
            argv.push(OsString::from(program));
            argv.extend(args.iter().map(OsString::from));
            argv
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn environment_names_follow_the_pattern() {
        assert!(is_env_name("ACP_INTERACTIVE_LOGIN"));
        assert!(is_env_name("_X1"));
        assert!(!is_env_name(""));
        assert!(!is_env_name("1X"));
        assert!(!is_env_name("lower"));
        assert!(!is_env_name("A-B"));
        assert!(!is_env_name(&"A".repeat(65)));
        assert!(is_env_name(&"A".repeat(64)));
    }

    #[test]
    fn bad_variables_are_refused() {
        let env = |pairs: &[(&str, &str)]| -> BTreeMap<String, String> {
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect()
        };
        assert!(check_env(&env(&[("ACP_LOGIN", "1")])).is_ok());
        for bad in [
            env(&[("lower", "1")]),
            env(&[("PATH", "/tmp")]),
            env(&[("LD_PRELOAD", "/tmp/x.so")]),
            env(&[("DYLD_INSERT_LIBRARIES", "/tmp/x")]),
            env(&[("NODE_OPTIONS", "--require x")]),
            env(&[("A", "two\nlines")]),
            env(&[("A", &"x".repeat(MAX_ENV_VALUE + 1))]),
        ] {
            assert!(check_env(&bad).is_err(), "{bad:?}");
        }
        let many: BTreeMap<String, String> = (0..=MAX_ENV)
            .map(|i| (format!("V{i}"), String::new()))
            .collect();
        assert!(check_env(&many).is_err());
    }

    #[test]
    fn too_many_or_too_long_arguments_are_refused() {
        assert!(check_terminal_args(&strings(&["--cli", "auth", "login"])).is_ok());
        assert!(check_terminal_args(&vec![String::new(); MAX_ALLOW_ARGS + 1]).is_err());
        assert!(check_terminal_args(&["x".repeat(MAX_ALLOW_ARG_LEN + 1)]).is_err());
        assert!(check_terminal_args(&strings(&["a\0b"])).is_err());
    }

    #[test]
    fn windows_command_lines_are_quoted_by_its_rules() {
        assert_eq!(
            windows_command_line(
                r"C:\Users\A B\node.exe",
                &strings(&["--acp", "", r"C:\dir with space\"])
            ),
            r#""C:\Users\A B\node.exe" --acp "" "C:\dir with space\\""#
        );
        assert!(check_cmd_safe(r"C:\a.exe", &strings(&["ok"])).is_ok());
        for bad in ["a\"b", "%PATH%", "a^b", "a&b", "a|b", "<x", ">x", "a\nb"] {
            assert!(
                check_cmd_safe(r"C:\a.exe", &strings(&[bad])).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn shell_words_are_quoted_when_needed() {
        assert_eq!(sh_quote("/usr/bin/claude"), "/usr/bin/claude");
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
        assert_eq!(sh_quote(""), "''");
    }

    #[test]
    fn the_dialog_shows_every_part_and_variable() {
        let env: BTreeMap<String, String> = [("ACP_LOGIN".to_owned(), "1".to_owned())].into();
        let message = terminal_message("/opt/agent", &strings(&["--cli", "a\nb"]), &env);
        assert!(message.starts_with("/opt/agent\n--cli\n\"a\\nb\"\n\nWith:\nACP_LOGIN=1\n\n"));
        assert!(message.ends_with(TERMINAL_WARNING));
    }

    #[cfg(unix)]
    #[test]
    fn terminals_are_tried_terminal_variable_first() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::TempDir::new().unwrap();
        for name in ["xterm", "kitty", "myterm"] {
            let path = dir.path().join(name);
            std::fs::write(&path, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let dirs = vec![dir.path().to_path_buf()];
        let args = strings(&["auth", "login"]);
        let found = terminal_commands(Some("myterm"), &dirs, "/opt/opencode", &args);
        let text: Vec<Vec<String>> = found
            .iter()
            .map(|argv| {
                argv.iter()
                    .map(|part| part.to_string_lossy().into_owned())
                    .collect()
            })
            .collect();
        let at = |name: &str| dir.path().join(name).to_string_lossy().into_owned();
        assert_eq!(
            text,
            vec![
                vec![
                    at("myterm"),
                    "-e".into(),
                    "/opt/opencode".into(),
                    "auth".into(),
                    "login".into()
                ],
                vec![
                    at("kitty"),
                    "/opt/opencode".into(),
                    "auth".into(),
                    "login".into()
                ],
                vec![
                    at("xterm"),
                    "-e".into(),
                    "/opt/opencode".into(),
                    "auth".into(),
                    "login".into()
                ],
            ]
        );
        assert_eq!(
            terminal_commands(Some("../evil"), &dirs, "/opt/x", &[]).len(),
            2
        );
        assert!(terminal_commands(None, &[], "/opt/x", &[]).is_empty());
    }
}
