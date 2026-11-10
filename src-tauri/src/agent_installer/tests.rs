use super::unpack::tests::{tar_bz2, tar_gz, zip_bytes, Item};
use super::*;
use crate::agent_runner::{Confirm, ExitEvent, Limits, LineEvent, RunEvents};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tempfile::TempDir;

/// Serves fixed files by path on a loopback port and counts the requests for each.
struct FileServer {
    server: Arc<tiny_http::Server>,
    base: String,
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    hits: Arc<Mutex<Vec<String>>>,
}

impl FileServer {
    fn start() -> Self {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
        let base = format!("http://{}", server.server_addr().to_ip().unwrap());
        let files: Arc<Mutex<HashMap<String, Vec<u8>>>> = Arc::default();
        let hits: Arc<Mutex<Vec<String>>> = Arc::default();
        let (serving, served, logged) = (server.clone(), files.clone(), hits.clone());
        std::thread::spawn(move || {
            for request in serving.incoming_requests() {
                let path = request.url().to_owned();
                lock(&logged).push(path.clone());
                let body = lock(&served).get(&path).cloned();
                let response = match body {
                    Some(body) => tiny_http::Response::from_data(body),
                    None => tiny_http::Response::from_data(Vec::new()).with_status_code(404),
                };
                let _ = request.respond(response);
            }
        });
        Self {
            server,
            base,
            files,
            hits,
        }
    }

    fn put(&self, path: &str, body: Vec<u8>) {
        lock(&self.files).insert(path.to_owned(), body);
    }

    /// The requests made, other than for the registry.
    fn downloads(&self) -> Vec<String> {
        lock(&self.hits)
            .iter()
            .filter(|path| *path != "/registry.json")
            .cloned()
            .collect()
    }
}

impl Drop for FileServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

struct NoRunEvents;

impl RunEvents for NoRunEvents {
    fn line(&self, _: LineEvent) {}
    fn exit(&self, _: ExitEvent) {}
}

/// Answers every question with `answer` and counts them.
struct Answers {
    answer: AtomicBool,
    asked: AtomicUsize,
    last: Mutex<Option<(String, String, String)>>,
}

impl Confirm for Answers {
    fn confirm(&self, title: &str, message: &str, ok: &str) -> bool {
        self.asked.fetch_add(1, Ordering::SeqCst);
        *lock(&self.last) = Some((title.into(), message.into(), ok.into()));
        self.answer.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<ProgressEvent>>);

impl InstallEvents for Recorder {
    fn progress(&self, event: ProgressEvent) {
        lock(&self.0).push(event);
    }
}

impl Recorder {
    fn stages(&self) -> Vec<Stage> {
        let mut stages: Vec<Stage> = Vec::new();
        for event in lock(&self.0).iter() {
            if stages.last() != Some(&event.stage) {
                stages.push(event.stage);
            }
        }
        stages
    }
}

struct Harness {
    installer: AgentInstaller,
    runner: AgentRunner,
    answers: Arc<Answers>,
    events: Arc<Recorder>,
    server: FileServer,
    data: TempDir,
    platform: String,
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The registry path of a GitHub release download under the test server.
fn github_path(url: &str) -> String {
    format!("/{}", url.strip_prefix("https://").unwrap())
}

/// A shell script that answers ACP's first line, as an agent would.
const FAKE_AGENT: &[u8] = b"#!/bin/sh\nexec cat\n";

/// The fake Node.js `node`: given npm's install arguments, it writes the package with a
/// `bin` script under `--prefix`.
const FAKE_NODE: &[u8] = b"#!/bin/sh\nprefix=\"$4\"\nfor last; do :; done\npkg=\"${last%@*}\"\nmkdir -p \"$prefix/node_modules/$pkg/bin\"\nprintf '{\"name\":\"%s\",\"bin\":{\"codex-acp\":\"bin/codex-acp.js\"}}' \"$pkg\" > \"$prefix/node_modules/$pkg/package.json\"\necho 'console.log(1)' > \"$prefix/node_modules/$pkg/bin/codex-acp.js\"\n";

/// The registry's binary entry of `registry_id` at `version`, with `build`'s fields.
fn binary_agent(
    registry_id: &str,
    version: &str,
    platform: &str,
    build: serde_json::Value,
) -> serde_json::Value {
    let mut binary = serde_json::Map::new();
    binary.insert(platform.to_owned(), build);
    serde_json::json!({
        "id": registry_id,
        "name": registry_id,
        "version": version,
        "license": "MIT",
        "distribution": { "binary": binary }
    })
}

impl Harness {
    /// A harness on this computer's platform, or `None` where the registry has no key for it.
    fn new() -> Option<Self> {
        Self::with_answer(true)
    }

    fn with_answer(answer: bool) -> Option<Self> {
        let platform = net::platform_key()?;
        let server = FileServer::start();
        let data = TempDir::new().unwrap();
        let answers = Arc::new(Answers {
            answer: AtomicBool::new(answer),
            asked: AtomicUsize::new(0),
            last: Mutex::new(None),
        });
        let runner = AgentRunner::new(
            Arc::new(NoRunEvents),
            answers.clone(),
            Some(data.path().join("agent-programs.json")),
            None,
            Limits::default(),
        );
        let events = Arc::new(Recorder::default());
        let installer = Self::installer(&runner, &server, &data, &platform, events.clone());
        Some(Self {
            installer,
            runner,
            answers,
            events,
            server,
            data,
            platform,
        })
    }

    fn installer(
        runner: &AgentRunner,
        server: &FileServer,
        data: &TempDir,
        platform: &str,
        events: Arc<Recorder>,
    ) -> AgentInstaller {
        let fake_node = tar_gz(&[
            Item::Dir("node-v1.0.0-test/"),
            Item::File("node-v1.0.0-test/bin/node", FAKE_NODE, 0o755),
            Item::File(
                "node-v1.0.0-test/lib/node_modules/npm/bin/npm-cli.js",
                b"// npm",
                0o644,
            ),
            Item::Symlink(
                "node-v1.0.0-test/bin/npm",
                "../lib/node_modules/npm/bin/npm-cli.js",
            ),
        ]);
        server.put(
            "/nodejs.org/dist/v1.0.0/node-v1.0.0-test.tar.gz",
            fake_node.clone(),
        );
        let sources = Sources {
            net: Net::new(
                format!("{}/registry.json", server.base),
                "http",
                Some(server.base.clone()),
            )
            .unwrap(),
            node: NodeRelease {
                version: "1.0.0".into(),
                dist_url: "https://nodejs.org/dist".into(),
                archives: vec![node::NodeArchive {
                    platform: platform.to_owned(),
                    file: "node-v1.0.0-test.tar.gz".into(),
                    sha256: sha(&fake_node),
                }],
            },
            platform: Some(platform.to_owned()),
        };
        AgentInstaller::new(
            runner.clone(),
            events,
            Some(data.path().join(AGENTS_FOLDER)),
            sources,
        )
    }

    fn root(&self) -> PathBuf {
        self.data.path().join(AGENTS_FOLDER)
    }

    /// Serves `agents` as the registry and forgets the one fetched before.
    fn registry(&self, agents: Vec<serde_json::Value>) {
        let document = serde_json::json!({ "version": "1.0.0", "agents": agents });
        self.server
            .put("/registry.json", serde_json::to_vec(&document).unwrap());
        self.installer.sources.net.forget_registry();
    }

    /// Serves a goose archive at `version` in `.tar.bz2` and returns its registry entry.
    fn goose(&self, version: &str) -> serde_json::Value {
        let archive = tar_bz2(&[Item::File("./goose", FAKE_AGENT, 0o644)]);
        let url =
            format!("https://github.com/block/goose/releases/download/v{version}/goose.tar.bz2");
        self.server.put(&github_path(&url), archive.clone());
        binary_agent(
            "goose",
            version,
            &self.platform,
            serde_json::json!({ "archive": url, "cmd": "./goose", "args": ["acp"], "sha256": sha(&archive) }),
        )
    }

    fn questions(&self) -> usize {
        self.answers.asked.load(Ordering::SeqCst)
    }

    fn allowed(&self, program: &str, args: &[&str]) -> bool {
        self.runner.allowed().iter().any(|entry| {
            entry.program == program
                && entry
                    .args
                    .iter()
                    .map(String::as_str)
                    .eq(args.iter().copied())
        })
    }

    /// The files left in the downloads folder.
    fn leftover_downloads(&self) -> usize {
        std::fs::read_dir(self.root().join(DOWNLOADS_FOLDER))
            .map(|entries| entries.count())
            .unwrap_or(0)
    }

    /// The names in preset `preset`'s folder.
    fn preset_folder(&self, preset: &str) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(self.root().join(preset))
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }
}

fn installed(outcome: InstallOutcome) -> (InstalledAgent, Option<String>) {
    match outcome {
        InstallOutcome::Installed {
            agent,
            replaced_program,
        } => (agent, replaced_program),
        InstallOutcome::Declined => panic!("the install was declined"),
    }
}

#[test]
fn the_page_types_have_their_field_names() {
    let outcome = InstallOutcome::Installed {
        agent: InstalledAgent {
            preset_id: "goose".into(),
            version: "1".into(),
            program: "/a/goose".into(),
            args: vec!["acp".into()],
            installed_at: 7,
        },
        replaced_program: None,
    };
    assert_eq!(
        serde_json::to_value(outcome).unwrap(),
        serde_json::json!({
            "kind": "installed",
            "agent": { "presetId": "goose", "version": "1", "program": "/a/goose", "args": ["acp"], "installedAt": 7 },
            "replacedProgram": null,
        })
    );
    assert_eq!(
        serde_json::to_value(InstallOutcome::Declined).unwrap(),
        serde_json::json!({ "kind": "declined" })
    );
    let event = ProgressEvent {
        preset_id: "goose".into(),
        stage: Stage::Downloading,
        received: Some(1),
        total: None,
    };
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        serde_json::json!({ "presetId": "goose", "stage": "downloading", "received": 1, "total": null })
    );
    let terminal = crate::agent_runner::TerminalOutcome::NoTerminal {
        command_line: "x".into(),
    };
    assert_eq!(
        serde_json::to_value(terminal).unwrap(),
        serde_json::json!({ "kind": "noTerminal", "commandLine": "x" })
    );
}

#[test]
fn the_dialog_names_the_version_source_licence_and_node() {
    let preset = presets::find("codex").unwrap();
    let available = Available {
        version: "2.6.0".into(),
        license: "Apache-2.0".into(),
        source: "npm package @agentclientprotocol/codex-acp".into(),
    };
    assert_eq!(
        install_message(preset, &available, Some("26.13.0")),
        "RIM will download Codex 2.6.0 from npm package @agentclientprotocol/codex-acp (licence: \
         Apache-2.0), check it and install it in RIM's own folder. RIM can then start it on this \
         computer.\n\nIt also downloads Node.js 26.13.0 from nodejs.org, once."
    );
    assert!(!install_message(preset, &available, None).contains("Node.js"));
}

#[tokio::test]
async fn each_archive_format_installs_and_is_allowed() {
    let Some(h) = Harness::new() else { return };
    let claude = tar_gz(&[
        Item::Dir("./"),
        Item::File("./claude-agent-acp", FAKE_AGENT, 0o644),
    ]);
    let claude_url =
        "https://github.com/agentclientprotocol/claude-agent-acp/releases/download/v0.1.0/c.tar.gz";
    h.server.put(&github_path(claude_url), claude.clone());
    let opencode = zip_bytes(&[
        Item::Dir("bin/"),
        Item::File("bin/opencode", FAKE_AGENT, 0o600),
    ]);
    let opencode_url = "https://github.com/anomalyco/opencode/releases/download/v2.0.0/o.zip";
    h.server.put(&github_path(opencode_url), opencode.clone());
    h.registry(vec![
        binary_agent(
            "claude-acp",
            "0.1.0",
            &h.platform,
            serde_json::json!({ "archive": claude_url, "cmd": "./claude-agent-acp", "sha256": sha(&claude) }),
        ),
        binary_agent(
            "opencode",
            "2.0.0",
            &h.platform,
            serde_json::json!({ "archive": opencode_url, "cmd": ".\\bin\\opencode", "args": ["acp"], "sha256": sha(&opencode) }),
        ),
        h.goose("1.0.0"),
    ]);

    for (preset, version, cmd, args) in [
        ("claude-code", "0.1.0", "claude-agent-acp", &[][..]),
        ("opencode", "2.0.0", "bin/opencode", &["acp"][..]),
        ("goose", "1.0.0", "goose", &["acp"][..]),
    ] {
        let (agent, replaced) = installed(h.installer.install(preset).await.unwrap());
        let program = h.root().join(preset).join(version).join(cmd);
        assert_eq!(agent.program, program.to_string_lossy());
        assert_eq!(
            agent.args,
            args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>()
        );
        assert_eq!(replaced, None);
        assert!(h.allowed(&agent.program, args), "{preset}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&program).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755, "{preset}");
        }
        assert_eq!(h.preset_folder(preset), vec![version.to_owned()]);
    }
    assert_eq!(h.questions(), 3);
    let (title, message, ok) = lock(&h.answers.last).clone().unwrap();
    assert_eq!(title, "Install Goose?");
    assert!(message.contains("Goose 1.0.0 from github.com/block/goose (licence: MIT)"));
    assert_eq!(ok, "Install");
    assert_eq!(h.leftover_downloads(), 0);
    assert_eq!(
        h.events.stages()[..4],
        [
            Stage::Downloading,
            Stage::Checking,
            Stage::Unpacking,
            Stage::Done
        ]
    );

    let catalog = h.installer.catalog().await;
    let ids: Vec<&str> = catalog
        .iter()
        .map(|entry| entry.preset_id.as_str())
        .collect();
    assert_eq!(
        ids,
        ["claude-code", "opencode", "goose", "codex", "gemini-cli"]
    );
    let goose = &catalog[2];
    assert_eq!(goose.installed.as_ref().unwrap().version, "1.0.0");
    assert_eq!(goose.available.as_ref().unwrap().version, "1.0.0");
    assert_eq!(goose.problem, None);
    assert!(catalog[3].problem.as_ref().unwrap().contains("no entry"));

    let (record, warning) = state::read(&h.root().join(state::FILE_NAME));
    assert_eq!(warning, None);
    assert_eq!(record.agents.len(), 3);
    assert_eq!(record.node, None);
}

#[tokio::test]
async fn a_checksum_mismatch_leaves_nothing_behind() {
    let Some(h) = Harness::new() else { return };
    let mut entry = h.goose("1.0.0");
    entry["distribution"]["binary"][&h.platform]["sha256"] = serde_json::json!("0".repeat(64));
    h.registry(vec![entry]);
    let error = h.installer.install("goose").await.unwrap_err();
    assert!(error.contains("checksum"), "{error}");
    assert_eq!(h.leftover_downloads(), 0);
    assert!(h.preset_folder("goose").is_empty());
    assert!(h.runner.allowed().is_empty());
    assert!(h.installer.catalog().await[2].installed.is_none());
}

#[tokio::test]
async fn an_entry_that_breaks_its_rule_downloads_nothing() {
    let Some(h) = Harness::new() else { return };
    let mut entry = h.goose("1.0.0");
    entry["distribution"]["binary"][&h.platform]["archive"] =
        serde_json::json!("https://github.com/evil/goose/releases/download/v1.0.0/goose.tar.bz2");
    h.registry(vec![entry]);
    let error = h.installer.install("goose").await.unwrap_err();
    assert!(error.contains("not from its project"), "{error}");
    assert_eq!(h.questions(), 0);
    assert!(h.server.downloads().is_empty());
    let catalog = h.installer.catalog().await;
    assert!(catalog[2].available.is_none());
    assert!(catalog[2]
        .problem
        .as_ref()
        .unwrap()
        .contains("not from its project"));
}

#[tokio::test]
async fn an_archive_with_an_escaping_entry_is_refused_and_removed() {
    let Some(h) = Harness::new() else { return };
    let archive = tar_bz2(&[
        Item::File("./goose", FAKE_AGENT, 0o755),
        Item::Symlink("./escape", "../../.."),
    ]);
    let url = "https://github.com/block/goose/releases/download/v1.0.0/goose.tar.bz2";
    h.server.put(&github_path(url), archive.clone());
    h.registry(vec![binary_agent(
        "goose",
        "1.0.0",
        &h.platform,
        serde_json::json!({ "archive": url, "cmd": "./goose", "args": ["acp"], "sha256": sha(&archive) }),
    )]);
    let error = h.installer.install("goose").await.unwrap_err();
    assert!(error.contains("outside"), "{error}");
    assert!(h.preset_folder("goose").is_empty());
    assert_eq!(h.leftover_downloads(), 0);
    assert!(h.runner.allowed().is_empty());
}

#[tokio::test]
async fn an_archive_without_the_program_is_refused() {
    let Some(h) = Harness::new() else { return };
    let mut entry = h.goose("1.0.0");
    entry["distribution"]["binary"][&h.platform]["cmd"] = serde_json::json!("./missing");
    h.registry(vec![entry]);
    let error = h.installer.install("goose").await.unwrap_err();
    assert!(
        error.contains("does not hold the agent's program"),
        "{error}"
    );
    assert!(h.preset_folder("goose").is_empty());
}

#[tokio::test]
async fn an_update_moves_the_allowed_pair_and_deletes_the_old_version() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    let (old, _) = installed(h.installer.install("goose").await.unwrap());
    h.registry(vec![h.goose("1.1.0")]);
    let (new, replaced) = installed(h.installer.install("goose").await.unwrap());
    assert_eq!(new.version, "1.1.0");
    assert_eq!(replaced.as_deref(), Some(old.program.as_str()));
    assert!(!h.allowed(&old.program, &["acp"]));
    assert!(h.allowed(&new.program, &["acp"]));
    assert_eq!(h.runner.allowed().len(), 1);
    assert_eq!(h.preset_folder("goose"), vec!["1.1.0".to_owned()]);

    let (same, replaced) = installed(h.installer.install("goose").await.unwrap());
    assert_eq!(same.program, new.program);
    assert_eq!(replaced, None);
    assert_eq!(h.runner.allowed().len(), 1);
    assert_eq!(h.preset_folder("goose"), vec!["1.1.0".to_owned()]);
}

#[tokio::test]
async fn removing_deletes_the_files_and_the_pair() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    let (agent, _) = installed(h.installer.install("goose").await.unwrap());
    h.installer.remove("goose").await.unwrap();
    assert!(!h.root().join("goose").exists());
    assert!(!h.allowed(&agent.program, &["acp"]));
    assert!(h.installer.catalog().await[2].installed.is_none());
    assert!(state::read(&h.root().join(state::FILE_NAME))
        .0
        .agents
        .is_empty());
    h.installer.remove("goose").await.unwrap();
    assert_eq!(
        h.installer.remove("nobody").await.unwrap_err(),
        UNKNOWN_PRESET
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_running_agent_is_not_removed() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    let (agent, _) = installed(h.installer.install("goose").await.unwrap());
    let cwd = TempDir::new().unwrap();
    let mut run = None;
    for _ in 0..20 {
        match h
            .runner
            .start(
                &agent.program,
                agent.args.clone(),
                &cwd.path().to_string_lossy(),
            )
            .await
        {
            Ok(id) => {
                run = Some(id);
                break;
            }
            Err(error) if error.contains("busy") => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(error) => panic!("{error}"),
        }
    }
    let run = run.expect("the agent starts");
    assert_eq!(h.installer.remove("goose").await.unwrap_err(), STOP_FIRST);
    assert!(h.root().join("goose").exists());
    h.runner.stop(&run).await;
    h.installer.remove("goose").await.unwrap();
}

#[tokio::test]
async fn a_corrupt_record_is_read_as_empty() {
    let Some(h) = Harness::new() else { return };
    std::fs::create_dir_all(h.root()).unwrap();
    std::fs::write(h.root().join(state::FILE_NAME), "{ not json").unwrap();
    let installer = Harness::installer(&h.runner, &h.server, &h.data, &h.platform, Arc::default());
    h.registry(vec![h.goose("1.0.0")]);
    installer.sources.net.forget_registry();
    assert!(installer
        .catalog()
        .await
        .iter()
        .all(|entry| entry.installed.is_none()));
    installed(installer.install("goose").await.unwrap());
    assert_eq!(
        state::read(&h.root().join(state::FILE_NAME)).0.agents.len(),
        1
    );
}

#[tokio::test]
async fn a_second_install_at_once_is_refused() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    let held = h.installer.busy.try_lock().unwrap();
    assert_eq!(h.installer.install("goose").await.unwrap_err(), BUSY);
    assert_eq!(h.installer.remove("goose").await.unwrap_err(), BUSY);
    drop(held);
    assert_eq!(h.questions(), 0);
}

#[tokio::test]
async fn a_declined_dialog_downloads_nothing() {
    let Some(h) = Harness::with_answer(false) else {
        return;
    };
    h.registry(vec![h.goose("1.0.0")]);
    assert_eq!(
        h.installer.install("goose").await.unwrap(),
        InstallOutcome::Declined
    );
    assert_eq!(h.questions(), 1);
    assert!(h.server.downloads().is_empty());
    assert!(!h.root().join("goose").exists());
    assert!(h.runner.allowed().is_empty());
}

#[tokio::test]
async fn a_full_allow_list_is_refused_before_asking() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    for i in 0..32 {
        h.runner
            .replace_allowed(
                None,
                Some(AllowedProgram {
                    program: format!("/bin/p{i}"),
                    args: Vec::new(),
                }),
            )
            .unwrap();
    }
    let error = h.installer.install("goose").await.unwrap_err();
    assert!(error.contains("At most"), "{error}");
    assert_eq!(h.questions(), 0);
    assert!(h.server.downloads().is_empty());
}

#[tokio::test]
async fn a_failed_registry_still_lists_what_is_installed() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    installed(h.installer.install("goose").await.unwrap());
    lock(&h.server.files).remove("/registry.json");
    h.installer.sources.net.forget_registry();
    let catalog = h.installer.catalog().await;
    assert_eq!(catalog.len(), 5);
    assert!(catalog[2].installed.is_some());
    assert!(catalog.iter().all(|entry| entry.available.is_none()));
    assert!(catalog[2]
        .problem
        .as_ref()
        .unwrap()
        .contains("could not be fetched"));
    assert!(h
        .installer
        .install("goose")
        .await
        .unwrap_err()
        .contains("could not be fetched"));
}

#[cfg(unix)]
#[tokio::test]
async fn an_npm_agent_installs_with_rims_node() {
    let Some(h) = Harness::new() else { return };
    if h.platform.ends_with("-musl") {
        return;
    }
    h.registry(vec![serde_json::json!({
        "id": "codex-acp",
        "version": "2.6.0",
        "license": "Apache-2.0",
        "distribution": { "npx": { "package": "@agentclientprotocol/codex-acp@2.6.0" } }
    })]);
    let mut outcome = None;
    for _ in 0..20 {
        match h.installer.install("codex").await {
            Ok(done) => {
                outcome = Some(done);
                break;
            }
            Err(error) if error.contains("busy") => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(error) => panic!("{error}"),
        }
    }
    let (agent, _) = installed(outcome.expect("the install finishes"));
    let node_dir = h.root().join(NODE_FOLDER).join("1.0.0");
    assert_eq!(agent.program, node_dir.join("bin/node").to_string_lossy());
    let script = h
        .root()
        .join("codex/2.6.0/node_modules/@agentclientprotocol/codex-acp/bin/codex-acp.js");
    assert_eq!(agent.args, vec![script.to_string_lossy().into_owned()]);
    assert!(script.is_file());
    assert!(h.allowed(&agent.program, &[&script.to_string_lossy()]));
    assert!(node_dir.join("bin/npm").exists());
    let (title, message, _) = lock(&h.answers.last).clone().unwrap();
    assert_eq!(title, "Install Codex?");
    assert!(message.contains("It also downloads Node.js 1.0.0 from nodejs.org, once."));
    let stages = h.events.stages();
    assert_eq!(stages.first(), Some(&Stage::Node));
    assert!(
        stages.ends_with(&[Stage::Installing, Stage::Done]),
        "{stages:?}"
    );
    assert_eq!(
        state::read(&h.root().join(state::FILE_NAME))
            .0
            .node
            .as_deref(),
        Some("1.0.0")
    );

    h.installer.remove("codex").await.unwrap();
    assert!(!h.root().join(NODE_FOLDER).exists());
    assert_eq!(state::read(&h.root().join(state::FILE_NAME)).0.node, None);
}

/// The bytes of every file under `path`, links not followed.
fn folder_size(path: &Path) -> u64 {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if !metadata.is_dir() {
        return metadata.len();
    }
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| folder_size(&entry.path()))
                .sum()
        })
        .unwrap_or(0)
}

/// Starts `agent`'s program with `path` as its `PATH`, sends ACP `initialize` and returns the
/// answer's `result`.
async fn initialize(
    agent: &InstalledAgent,
    path: Option<std::ffi::OsString>,
    cwd: &Path,
) -> serde_json::Value {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let mut command = tokio::process::Command::new(&agent.program);
    command
        .args(&agent.args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    let mut child = command.spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": false, "writeTextFile": false },
                "terminal": false,
                "auth": { "terminal": true }
            }
        }
    });
    stdin
        .write_all(format!("{request}\n").as_bytes())
        .await
        .unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let answer = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        while let Some(line) = lines.next_line().await.unwrap() {
            let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if message.get("id") == Some(&serde_json::json!(1)) {
                return message;
            }
        }
        serde_json::Value::Null
    })
    .await
    .expect("the agent answers initialize");
    let _ = child.kill().await;
    answer
        .get("result")
        .cloned()
        .unwrap_or_else(|| panic!("no result: {answer}"))
}

/// Installs all five agents from the real registry, npm and nodejs.org into a temporary folder,
/// with `HOME` and the configuration folders pointed at temporary folders too, then starts each
/// and checks it answers ACP `initialize`. Run alone:
/// `cargo test --lib agent_installer::tests::installs_all_five_for_real -- --ignored --exact --nocapture`.
#[tokio::test]
#[ignore = "downloads the real agents"]
async fn installs_all_five_for_real() {
    let home = TempDir::new().unwrap();
    for name in [
        "HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "XDG_STATE_HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
    ] {
        let dir = home.path().join(name.to_ascii_lowercase());
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var(name, &dir);
    }
    let data = TempDir::new().unwrap();
    let answers = Arc::new(Answers {
        answer: AtomicBool::new(true),
        asked: AtomicUsize::new(0),
        last: Mutex::new(None),
    });
    let runner = AgentRunner::new(
        Arc::new(NoRunEvents),
        answers,
        Some(data.path().join("agent-programs.json")),
        None,
        Limits::default(),
    );
    let root = data.path().join(AGENTS_FOLDER);
    let installer = AgentInstaller::new(
        runner.clone(),
        Arc::new(Recorder::default()),
        Some(root.clone()),
        Sources::live().unwrap(),
    );
    let cwd = TempDir::new().unwrap();
    let mut failures = Vec::new();
    for preset in presets::PRESETS {
        let started = std::time::Instant::now();
        let agent = match installer.install(preset.id).await {
            Ok(outcome) => installed(outcome).0,
            Err(error) => {
                println!("SMOKE {} install failed: {error}", preset.id);
                failures.push(preset.id);
                continue;
            }
        };
        let seconds = started.elapsed().as_secs_f64();
        let size = folder_size(&root.join(preset.id));
        let node_bin = preset.is_npm().then(|| {
            node::node_bin(&AgentInstaller::node_dir(
                &root,
                &installer.sources.node.version,
            ))
        });
        let path = node_bin.map(|bin| {
            let mut dirs = vec![bin];
            dirs.extend(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            ));
            std::env::join_paths(dirs).unwrap()
        });
        let result = initialize(&agent, path, cwd.path()).await;
        let methods: Vec<serde_json::Value> = result
            .get("authMethods")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|method| {
                serde_json::json!({
                    "id": method.get("id"),
                    "type": method.get("type"),
                    "args": method.get("args"),
                    "env": method.get("env").and_then(serde_json::Value::as_object).map(|env| env.keys().cloned().collect::<Vec<_>>()),
                })
            })
            .collect();
        println!(
            "SMOKE {} version={} size_mib={:.1} seconds={seconds:.1} agentInfo={} authMethods={}",
            preset.id,
            agent.version,
            size as f64 / (1024.0 * 1024.0),
            result.get("agentInfo").cloned().unwrap_or_default(),
            serde_json::Value::Array(methods),
        );
    }
    println!(
        "SMOKE node size_mib={:.1}",
        folder_size(&root.join(NODE_FOLDER)) as f64 / (1024.0 * 1024.0)
    );
    assert!(failures.is_empty(), "failed: {failures:?}");
}
