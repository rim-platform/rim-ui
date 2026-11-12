use super::unpack::tests::{tar_bz2, tar_gz, zip_bytes, Item};
use super::*;
use crate::agent_runner::{Confirm, ExitEvent, Limits, LineEvent, RunEvents};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tempfile::TempDir;

/// Serves fixed files by path on a loopback port and records the requests: the paths of the
/// `GET`s in `hits`, of the `HEAD`s in `heads`.
struct FileServer {
    server: Arc<tiny_http::Server>,
    base: String,
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    hits: Arc<Mutex<Vec<String>>>,
    heads: Arc<Mutex<Vec<String>>>,
}

impl FileServer {
    fn start() -> Self {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
        let base = format!("http://{}", server.server_addr().to_ip().unwrap());
        let files: Arc<Mutex<HashMap<String, Vec<u8>>>> = Arc::default();
        let hits: Arc<Mutex<Vec<String>>> = Arc::default();
        let heads: Arc<Mutex<Vec<String>>> = Arc::default();
        let (serving, served, logged, headed) =
            (server.clone(), files.clone(), hits.clone(), heads.clone());
        std::thread::spawn(move || {
            for request in serving.incoming_requests() {
                let path = request.url().to_owned();
                if *request.method() == tiny_http::Method::Head {
                    lock(&headed).push(path.clone());
                } else {
                    lock(&logged).push(path.clone());
                }
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
            heads,
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

/// The fake Node.js `node`: given npm's install arguments, it writes a file into npm's cache
/// folder, fails for a version with `fail` in it, and otherwise writes the package with a `bin`
/// script under `--prefix`.
const FAKE_NODE: &[u8] = b"#!/bin/sh\nprefix=\"$4\"\nmkdir -p \"${12}\" && echo cached > \"${12}/blob\"\nfor last; do :; done\ncase \"$last\" in *fail*) echo 'npm ERR! failed' >&2; exit 1;; esac\npkg=\"${last%@*}\"\nmkdir -p \"$prefix/node_modules/$pkg/bin\"\nprintf '{\"name\":\"%s\",\"bin\":{\"codex-acp\":\"bin/codex-acp.js\"}}' \"$pkg\" > \"$prefix/node_modules/$pkg/package.json\"\necho 'console.log(1)' > \"$prefix/node_modules/$pkg/bin/codex-acp.js\"\n";

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
        self.installer.sizes.clear();
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

    /// Serves npm's metadata of `name` with `versions`, the last one tagged `latest`.
    #[cfg(unix)]
    fn npm_package(&self, name: &str, versions: serde_json::Value) {
        serve_npm(&self.server, name, versions);
    }

    /// The size of the fake Node.js archive.
    fn node_archive_len(&self) -> u64 {
        lock(&self.server.files)["/nodejs.org/dist/v1.0.0/node-v1.0.0-test.tar.gz"].len() as u64
    }

    /// The npm cache folders in the agents folder.
    #[cfg(unix)]
    fn npm_caches(&self) -> Vec<String> {
        std::fs::read_dir(self.root())
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .filter(|name| name.starts_with(NPM_CACHE_PREFIX))
                    .collect()
            })
            .unwrap_or_default()
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

fn installed(outcome: InstallOutcome) -> (InstalledAgent, Option<AllowedProgram>) {
    match outcome {
        InstallOutcome::Installed { agent, replaced } => (agent, replaced),
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
        replaced: Some(AllowedProgram {
            program: "/a/old".into(),
            args: vec!["acp".into()],
        }),
    };
    assert_eq!(
        serde_json::to_value(outcome).unwrap(),
        serde_json::json!({
            "kind": "installed",
            "agent": { "presetId": "goose", "version": "1", "program": "/a/goose", "args": ["acp"], "installedAt": 7 },
            "replaced": { "program": "/a/old", "args": ["acp"] },
        })
    );
    let fresh = InstallOutcome::Installed {
        agent: InstalledAgent {
            preset_id: "goose".into(),
            version: "1".into(),
            program: "/a/goose".into(),
            args: Vec::new(),
            installed_at: 7,
        },
        replaced: None,
    };
    assert_eq!(
        serde_json::to_value(fresh).unwrap()["replaced"],
        serde_json::Value::Null
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
    let catalog = Catalog {
        agents: vec![CatalogEntry {
            preset_id: "codex".into(),
            name: "Codex".into(),
            available: Some(Available {
                version: "2".into(),
                license: "MIT".into(),
                source: "npm package x".into(),
                size: Some(Size {
                    bytes: 460,
                    kind: SizeKind::Installed,
                }),
            }),
            installed: Some(CatalogInstalled {
                agent: InstalledAgent {
                    preset_id: "codex".into(),
                    version: "1".into(),
                    program: "/a/node".into(),
                    args: vec!["/a/x.js".into()],
                    installed_at: 7,
                },
                disk_bytes: Some(433),
            }),
            problem: None,
        }],
        node: Some(CatalogNode {
            version: "26.13.0".into(),
            disk_bytes: None,
        }),
        node_download: None,
        total_bytes: 1200,
    };
    assert_eq!(
        serde_json::to_value(catalog).unwrap(),
        serde_json::json!({
            "agents": [{
                "presetId": "codex",
                "name": "Codex",
                "available": {
                    "version": "2",
                    "license": "MIT",
                    "source": "npm package x",
                    "size": { "bytes": 460, "kind": "installed" },
                },
                "installed": {
                    "presetId": "codex",
                    "version": "1",
                    "program": "/a/node",
                    "args": ["/a/x.js"],
                    "installedAt": 7,
                    "diskBytes": 433,
                },
                "problem": null,
            }],
            "node": { "version": "26.13.0", "diskBytes": null },
            "nodeDownload": null,
            "totalBytes": 1200,
        })
    );
    assert_eq!(
        serde_json::to_value(Size {
            bytes: 1,
            kind: SizeKind::Download
        })
        .unwrap(),
        serde_json::json!({ "bytes": 1, "kind": "download" })
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
    let mut available = Available {
        version: "2.6.0".into(),
        license: "Apache-2.0".into(),
        source: "npm package @agentclientprotocol/codex-acp".into(),
        size: None,
    };
    let node = |download: Option<u64>| {
        Some(NodeOffer {
            version: "26.13.0",
            download,
        })
    };
    let start = "RIM will download Codex 2.6.0 from npm package @agentclientprotocol/codex-acp \
                 (licence: Apache-2.0), check it and install it in RIM's own folder. RIM can then \
                 start it on this computer.";
    let with_node = format!("{start}\n\nIt also downloads Node.js 26.13.0 from nodejs.org, once.");
    assert_eq!(install_message(preset, &available, node(None)), with_node);
    assert_eq!(install_message(preset, &available, None), start);

    available.size = Some(Size {
        bytes: 459_600_000,
        kind: SizeKind::Installed,
    });
    assert_eq!(
        install_message(preset, &available, node(Some(50_400_000))),
        format!(
            "{with_node}\n\nIt takes about 460 MB once installed. Node.js 26.13.0 adds about 50 MB \
             to download."
        )
    );
    assert_eq!(
        install_message(preset, &available, None),
        format!("{start}\n\nIt takes about 460 MB once installed.")
    );
    available.size = None;
    assert_eq!(
        install_message(preset, &available, node(Some(4_240_000))),
        format!("{with_node}\n\nNode.js 26.13.0 adds about 4.2 MB to download.")
    );

    let goose = presets::find("goose").unwrap();
    let offer = Available {
        version: "1.58.0".into(),
        license: "Apache-2.0".into(),
        source: "github.com/block/goose".into(),
        size: Some(Size {
            bytes: 120_000_000,
            kind: SizeKind::Download,
        }),
    };
    assert!(
        install_message(goose, &offer, None).ends_with("this computer.\n\nDownload: about 120 MB.")
    );
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
        .agents
        .iter()
        .map(|entry| entry.preset_id.as_str())
        .collect();
    assert_eq!(
        ids,
        ["claude-code", "opencode", "goose", "codex", "gemini-cli"]
    );
    let goose = &catalog.agents[2];
    assert_eq!(goose.installed.as_ref().unwrap().agent.version, "1.0.0");
    assert_eq!(goose.available.as_ref().unwrap().version, "1.0.0");
    assert_eq!(goose.problem, None);
    assert!(catalog.agents[3]
        .problem
        .as_ref()
        .unwrap()
        .contains("no entry"));

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
    assert!(h.installer.catalog().await.agents[2].installed.is_none());
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
    assert!(catalog.agents[2].available.is_none());
    assert!(catalog.agents[2]
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
    assert_eq!(
        replaced,
        Some(AllowedProgram {
            program: old.program.clone(),
            args: old.args.clone(),
        })
    );
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
    assert!(h.installer.catalog().await.agents[2].installed.is_none());
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
        .agents
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
    assert_eq!(catalog.agents.len(), 5);
    assert!(catalog.agents[2].installed.is_some());
    assert!(catalog.agents.iter().all(|entry| entry.available.is_none()));
    assert!(catalog.agents[2]
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

/// The registry entry of Codex at `version`.
#[cfg(unix)]
fn codex_entry(version: &str) -> serde_json::Value {
    serde_json::json!({
        "id": "codex-acp",
        "version": version,
        "license": "Apache-2.0",
        "distribution": { "npx": { "package": format!("@agentclientprotocol/codex-acp@{version}") } }
    })
}

/// Installs `preset`, trying again while the fake `node` unpacked a moment ago is still busy
/// for exec in a process another test thread forked.
#[cfg(unix)]
async fn install_retrying(h: &Harness, preset: &str) -> (InstalledAgent, Option<AllowedProgram>) {
    for _ in 0..20 {
        match h.installer.install(preset).await {
            Ok(done) => return installed(done),
            Err(error) if error.contains("busy") => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(error) => panic!("{error}"),
        }
    }
    panic!("the install did not finish");
}

#[cfg(unix)]
#[tokio::test]
async fn an_npm_agent_installs_with_rims_node() {
    let Some(h) = Harness::new() else { return };
    if h.platform.ends_with("-musl") {
        return;
    }
    h.registry(vec![codex_entry("2.6.0")]);
    h.npm_package(
        "@agentclientprotocol/codex-acp",
        serde_json::json!({ "2.6.0": { "dist": { "unpackedSize": 12_000 } } }),
    );
    let (agent, replaced) = install_retrying(&h, "codex").await;
    assert_eq!(replaced, None);
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
    assert!(
        message.ends_with(&format!(
            "It takes about 0.0 MB once installed. Node.js 1.0.0 adds about {} to download.",
            size::size_text(h.node_archive_len())
        )),
        "{message}"
    );
    assert!(h.npm_caches().is_empty());
    let catalog = h.installer.catalog().await;
    let node = catalog.node.as_ref().unwrap();
    assert_eq!(node.version, "1.0.0");
    assert_eq!(
        node.disk_bytes,
        Some((FAKE_NODE.len() + b"// npm".len()) as u64),
        "the link bin/npm is not counted"
    );
    assert_eq!(catalog.node_download, None);
    assert_eq!(
        catalog.agents[3].installed.as_ref().unwrap().disk_bytes,
        Some(folder_size(&h.root().join("codex/2.6.0")))
    );
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

    h.registry(vec![codex_entry("2.7.0")]);
    let (updated, replaced) = install_retrying(&h, "codex").await;
    assert_eq!(updated.program, agent.program);
    assert_eq!(
        replaced,
        Some(AllowedProgram {
            program: agent.program.clone(),
            args: agent.args.clone(),
        })
    );
    let new_script = h
        .root()
        .join("codex/2.7.0/node_modules/@agentclientprotocol/codex-acp/bin/codex-acp.js");
    assert_eq!(
        updated.args,
        vec![new_script.to_string_lossy().into_owned()]
    );
    assert!(!h.allowed(&agent.program, &[&script.to_string_lossy()]));
    assert!(h.allowed(&updated.program, &[&new_script.to_string_lossy()]));
    assert_eq!(h.runner.allowed().len(), 1);
    assert_eq!(h.preset_folder("codex"), vec!["2.7.0".to_owned()]);
    let node_downloads = h
        .server
        .downloads()
        .iter()
        .filter(|path| path.starts_with("/nodejs.org/"))
        .count();
    assert_eq!(node_downloads, 1);

    h.installer.remove("codex").await.unwrap();
    assert!(!h.root().join(NODE_FOLDER).exists());
    assert_eq!(state::read(&h.root().join(state::FILE_NAME)).0.node, None);
}

/// Serves npm's metadata of `name` on `server` with `versions`, the last one tagged `latest`.
fn serve_npm(server: &FileServer, name: &str, versions: serde_json::Value) {
    let latest = versions
        .as_object()
        .unwrap()
        .keys()
        .next_back()
        .unwrap()
        .clone();
    let document = serde_json::json!({
        "name": name,
        "dist-tags": { "latest": latest },
        "versions": versions,
    });
    server.put(
        &format!("/registry.npmjs.org/{}", name.replacen('/', "%2f", 1)),
        serde_json::to_vec(&document).unwrap(),
    );
}

/// A test server and a `Net` that fetches every `https://` URL from it.
fn npm_server() -> (FileServer, Net) {
    let server = FileServer::start();
    let net = Net::new(
        format!("{}/registry.json", server.base),
        "http",
        Some(server.base.clone()),
    )
    .unwrap();
    (server, net)
}

#[tokio::test]
async fn the_npm_size_counts_what_npm_would_install_here() {
    let (server, net) = npm_server();
    serve_npm(
        &server,
        "@agentclientprotocol/codex-acp",
        serde_json::json!({
            "2.6.0": {
                "dist": { "unpackedSize": 1000 },
                "dependencies": { "a": "^1.0.0", "b": "1.x || >=3", "c": "1.0.0" },
                "optionalDependencies": {
                    "@openai/codex-linux-x64": "npm:@openai/codex@0.167.0-linux-x64",
                    "@openai/codex-win32-x64": "npm:@openai/codex@0.167.0-win32-x64"
                }
            },
            "2.7.0": { "dist": { "unpackedSize": 99_999 } }
        }),
    );
    serve_npm(
        &server,
        "a",
        serde_json::json!({
            "1.0.0": { "dist": { "unpackedSize": 10 } },
            "1.2.0": {
                "dist": { "unpackedSize": 20 },
                "dependencies": { "b": "~1.1", "c": "1.0.0", "old": "^1" }
            },
            "2.0.0": { "dist": { "unpackedSize": 40 } }
        }),
    );
    serve_npm(
        &server,
        "b",
        serde_json::json!({
            "1.1.5": { "dist": { "unpackedSize": 100 } },
            "1.9.0": { "dist": { "unpackedSize": 200 } }
        }),
    );
    serve_npm(
        &server,
        "c",
        serde_json::json!({ "1.0.0": { "dist": { "unpackedSize": 5 } } }),
    );
    serve_npm(
        &server,
        "old",
        serde_json::json!({ "1.0.0": { "dist": {} } }),
    );
    serve_npm(
        &server,
        "@openai/codex",
        serde_json::json!({
            "0.167.0-linux-x64": { "os": ["linux"], "cpu": ["x64"], "dist": { "unpackedSize": 3000 } },
            "0.167.0-win32-x64": { "os": ["win32"], "cpu": ["x64"], "dist": { "unpackedSize": 4000 } },
            "0.167.0": { "dist": { "unpackedSize": 1 } }
        }),
    );
    let linux = size::NpmPlatform::from_key("linux-x86_64").unwrap();
    let windows = size::NpmPlatform::from_key("windows-x86_64").unwrap();
    let mac = size::NpmPlatform::from_key("darwin-aarch64").unwrap();
    let package = "@agentclientprotocol/codex-acp";
    assert_eq!(
        size::npm_size(&net, package, "2.6.0", linux).await,
        Some(1000 + 20 + 100 + 200 + 5 + 3000)
    );
    assert_eq!(
        size::npm_size(&net, package, "2.6.0", windows).await,
        Some(1000 + 20 + 100 + 200 + 5 + 4000)
    );
    assert_eq!(
        size::npm_size(&net, package, "2.6.0", mac).await,
        Some(1000 + 20 + 100 + 200 + 5)
    );
    let fetched = lock(&server.hits).len();
    assert_eq!(fetched, 18, "{:?}", lock(&server.hits));
    assert_eq!(size::npm_size(&net, package, "3.0.0", linux).await, None);
    assert_eq!(size::npm_size(&net, "missing", "1.0.0", linux).await, None);
}

#[tokio::test]
async fn the_npm_size_gives_up_past_its_fetch_limit() {
    let (server, net) = npm_server();
    let chain = size::MAX_METADATA_FETCHES + 1;
    for i in 0..chain {
        let mut version = serde_json::json!({ "dist": { "unpackedSize": 1 } });
        if i + 1 < chain {
            version["dependencies"] = serde_json::json!({ format!("p{}", i + 1): "1.0.0" });
        }
        serve_npm(
            &server,
            &format!("p{i}"),
            serde_json::json!({ "1.0.0": version }),
        );
    }
    let linux = size::NpmPlatform::from_key("linux-x86_64").unwrap();
    assert_eq!(size::npm_size(&net, "p1", "1.0.0", linux).await, Some(80));
    assert_eq!(size::npm_size(&net, "p0", "1.0.0", linux).await, None);
}

#[tokio::test]
async fn the_catalog_says_how_big_each_offer_is_and_what_is_used() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    let archive_len = lock(&h.server.files)
        ["/github.com/block/goose/releases/download/v1.0.0/goose.tar.bz2"]
        .len() as u64;
    let catalog = h.installer.catalog().await;
    assert_eq!(
        catalog.agents[2].available.as_ref().unwrap().size,
        Some(Size {
            bytes: archive_len,
            kind: SizeKind::Download,
        })
    );
    assert_eq!(catalog.node_download, Some(h.node_archive_len()));
    assert_eq!(catalog.node, None);
    assert_eq!(catalog.total_bytes, 0);
    assert!(h.server.downloads().is_empty());

    installed(h.installer.install("goose").await.unwrap());
    let (_, message, _) = lock(&h.answers.last).clone().unwrap();
    assert!(
        message.ends_with(&format!(
            "Download: about {}.",
            size::size_text(archive_len)
        )),
        "{message}"
    );
    let heads = lock(&h.server.heads).len();
    let catalog = h.installer.catalog().await;
    assert_eq!(lock(&h.server.heads).len(), heads, "the sizes are kept");
    let goose = catalog.agents[2].installed.as_ref().unwrap();
    assert_eq!(goose.disk_bytes, Some(FAKE_AGENT.len() as u64));
    let record = std::fs::metadata(h.root().join(state::FILE_NAME))
        .unwrap()
        .len();
    assert_eq!(catalog.total_bytes, FAKE_AGENT.len() as u64 + record);

    std::fs::remove_dir_all(h.root().join("goose/1.0.0")).unwrap();
    let catalog = h.installer.catalog().await;
    assert_eq!(
        catalog.agents[2].installed.as_ref().unwrap().disk_bytes,
        None
    );
    assert_eq!(catalog.total_bytes, record);
}

#[tokio::test]
async fn an_unknown_size_is_left_out() {
    let Some(h) = Harness::new() else { return };
    h.registry(vec![h.goose("1.0.0")]);
    lock(&h.server.files).retain(|path, _| !path.starts_with("/nodejs.org/"));
    let mut entry = h.goose("1.0.0");
    entry["distribution"]["binary"][&h.platform]["archive"] =
        serde_json::json!("https://github.com/block/goose/releases/download/v1.0.0/gone.tar.bz2");
    h.registry(vec![entry]);
    let catalog = h.installer.catalog().await;
    assert_eq!(catalog.agents[2].available.as_ref().unwrap().size, None);
    assert_eq!(catalog.node_download, None);
}

#[cfg(unix)]
#[tokio::test]
async fn npm_caches_are_deleted_after_each_install() {
    let Some(h) = Harness::new() else { return };
    if h.platform.ends_with("-musl") {
        return;
    }
    std::fs::create_dir_all(h.root().join(".npm-cache/_cacache")).unwrap();
    std::fs::write(h.root().join(".npm-cache/_cacache/blob"), "old").unwrap();
    std::fs::create_dir_all(h.root().join(".npm-cache-0123")).unwrap();
    h.registry(vec![h.goose("1.0.0")]);
    installed(h.installer.install("goose").await.unwrap());
    assert!(h.npm_caches().is_empty());

    h.registry(vec![codex_entry("9.9.9-fail")]);
    let mut error = String::new();
    for _ in 0..20 {
        match h.installer.install("codex").await {
            Err(failed) if failed.contains("busy") => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(failed) => {
                error = failed;
                break;
            }
            Ok(_) => panic!("the install should fail"),
        }
    }
    assert!(error.contains("npm could not install"), "{error}");
    assert!(h.npm_caches().is_empty());
    assert!(h.preset_folder("codex").is_empty());

    h.registry(vec![codex_entry("2.6.0")]);
    install_retrying(&h, "codex").await;
    assert!(h.npm_caches().is_empty());
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

/// Prints the sizes the catalog gives for the five agents and RIM's Node.js from the real
/// registry, npm and nodejs.org, installing nothing. Run alone:
/// `cargo test --lib agent_installer::tests::prints_the_real_sizes -- --ignored --exact --nocapture`.
#[tokio::test]
#[ignore = "reads the real registry, npm and nodejs.org"]
async fn prints_the_real_sizes() {
    let home = TempDir::new().unwrap();
    for name in ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "USERPROFILE"] {
        let dir = home.path().join(name.to_ascii_lowercase());
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var(name, &dir);
    }
    let data = TempDir::new().unwrap();
    let answers = Arc::new(Answers {
        answer: AtomicBool::new(false),
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
    let installer = AgentInstaller::new(
        runner,
        Arc::new(Recorder::default()),
        Some(data.path().join(AGENTS_FOLDER)),
        Sources::live().unwrap(),
    );
    let started = std::time::Instant::now();
    let catalog = installer.catalog().await;
    println!(
        "SIZES catalog seconds={:.1}",
        started.elapsed().as_secs_f64()
    );
    for entry in &catalog.agents {
        let offer = entry.available.as_ref();
        println!(
            "SIZES {} version={:?} size={:?} text={:?} problem={:?}",
            entry.preset_id,
            offer.map(|offer| offer.version.as_str()),
            offer.and_then(|offer| offer.size),
            offer
                .and_then(|offer| offer.size)
                .map(|size| size::size_text(size.bytes)),
            entry.problem,
        );
    }
    println!(
        "SIZES node download={:?} text={:?}",
        catalog.node_download,
        catalog.node_download.map(size::size_text)
    );
}
