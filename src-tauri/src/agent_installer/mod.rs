//! The agent installer: downloads, checks and installs the ACP agents RIM supports into the app's
//! own folder, and allows the installed program for the agent runner.
//!
//! Each agent's source is fixed in [`presets`]; the ACP registry only chooses the version. One
//! native dialog, which a script in the page can neither draw nor answer, comes before any
//! download.

mod net;
mod node;
mod presets;
mod size;
mod state;
#[cfg(test)]
mod tests;
mod unpack;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Webview};

use crate::agent_runner::{AgentRunner, AllowedProgram};
use crate::desktop_shell::MAIN_WINDOW;
use net::Net;
use node::NodeRelease;
use presets::{Available, Preset, Resolved, Target, NOT_AVAILABLE};
use size::{NpmPlatform, Size, SizeCache, SizeKind};
use state::Installed;
pub use state::InstalledAgent;

/// The event that reports an install's progress, with a [`ProgressEvent`].
pub(crate) const PROGRESS_EVENT: &str = "agent-installer://progress";
/// The folder in the app's data directory that holds the installed agents.
const AGENTS_FOLDER: &str = "agents";
/// The folder in the agents folder downloads are written to.
const DOWNLOADS_FOLDER: &str = ".downloads";
/// The folder in the agents folder that holds RIM's Node.js versions.
const NODE_FOLDER: &str = "node";
/// The start of the name of the folder in the agents folder an npm install keeps its cache in,
/// deleted after the install.
const NPM_CACHE_PREFIX: &str = ".npm-cache";
/// The start of the name of a folder an install is unpacked into before it is moved in place.
const STAGING_PREFIX: &str = ".staging-";
/// The start of the name a replaced version's folder is moved to until the new one is in place.
const OLD_PREFIX: &str = ".old-";

/// The refusal while another install or removal runs.
const BUSY: &str = "Another install is running.";
/// The refusal to remove an agent that is running.
const STOP_FIRST: &str = "Stop its sessions first.";
/// The refusal of a preset id RIM does not know.
const UNKNOWN_PRESET: &str = "RIM can't install that agent.";
/// The refusal when the app has no data directory.
const NO_FOLDER: &str = "RIM has no folder to install agents in.";

/// One agent the page can install, with what the registry offers and what is installed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    preset_id: String,
    name: String,
    available: Option<Available>,
    installed: Option<CatalogInstalled>,
    problem: Option<String>,
}

/// An installed agent as the page lists it: its record and what its version's folder uses on
/// disk, `None` when that could not be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInstalled {
    #[serde(flatten)]
    agent: InstalledAgent,
    disk_bytes: Option<u64>,
}

/// RIM's installed Node.js and what its folder uses on disk, `None` when that could not be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogNode {
    version: String,
    disk_bytes: Option<u64>,
}

/// What the page lists: every supported agent, RIM's Node.js when it is installed, what Node.js
/// would download when it is not, and what the whole agents folder uses on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    agents: Vec<CatalogEntry>,
    node: Option<CatalogNode>,
    node_download: Option<u64>,
    total_bytes: u64,
}

/// What the agents folder uses on disk.
struct DiskUse {
    /// By preset id, each installed agent's version folder.
    agents: HashMap<String, Option<u64>>,
    /// RIM's recorded Node.js folder.
    node: Option<u64>,
    /// The whole agents folder.
    total: u64,
}

impl DiskUse {
    /// Measures what `installed` records in the agents folder `root`; nothing without a folder.
    fn measure(root: Option<&Path>, installed: &Installed) -> Self {
        let Some(root) = root else {
            return Self {
                agents: HashMap::new(),
                node: None,
                total: 0,
            };
        };
        Self {
            agents: installed
                .agents
                .iter()
                .map(|agent| {
                    let dir = root.join(&agent.preset_id).join(&agent.version);
                    (agent.preset_id.clone(), size::disk_size(&dir))
                })
                .collect(),
            node: installed
                .node
                .as_ref()
                .and_then(|version| size::disk_size(&AgentInstaller::node_dir(root, version))),
            total: size::disk_size_readable(root),
        }
    }
}

/// A folder deleted, with everything in it, when this is dropped.
struct ScratchFolder(PathBuf);

impl Drop for ScratchFolder {
    fn drop(&mut self) {
        remove_all(&self.0);
    }
}

/// What came of an install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallOutcome {
    /// The agent was installed and allowed; `replaced` is the program and arguments of the
    /// version it replaced, when either differs. npm agents share RIM's `node` as their program
    /// and differ by their arguments.
    #[serde(rename_all = "camelCase")]
    Installed {
        agent: InstalledAgent,
        replaced: Option<AllowedProgram>,
    },
    /// The person chose Cancel; nothing was downloaded.
    Declined,
}

/// A step of an install.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Stage {
    /// Downloading, checking and unpacking RIM's Node.js.
    Node,
    Downloading,
    Checking,
    Unpacking,
    /// npm installing the package.
    Installing,
    Done,
}

/// An install's progress: its stage and, while downloading, the bytes received and the total
/// when the server said it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgressEvent {
    preset_id: String,
    stage: Stage,
    received: Option<u64>,
    total: Option<u64>,
}

/// Where progress goes.
pub(crate) trait InstallEvents: Send + Sync + 'static {
    fn progress(&self, event: ProgressEvent);
}

/// The events of the real app: emitted to the main window only.
struct PageEvents<R: Runtime>(AppHandle<R>);

impl<R: Runtime> InstallEvents for PageEvents<R> {
    fn progress(&self, event: ProgressEvent) {
        let _ = self.0.emit_to(MAIN_WINDOW, PROGRESS_EVENT, event);
    }
}

/// Where the installer downloads from and what it installs for.
pub(crate) struct Sources {
    net: Net,
    node: NodeRelease,
    /// The registry platform key of this computer.
    platform: Option<String>,
}

impl Sources {
    /// The real registry, Node.js release and platform.
    ///
    /// # Errors
    ///
    /// A sentence when no HTTP client could be made.
    pub(crate) fn live() -> Result<Self, String> {
        Ok(Self {
            net: Net::live()?,
            node: NodeRelease::pinned(),
            platform: net::platform_key(),
        })
    }
}

/// The installer, kept in the app's state.
pub struct AgentInstaller {
    runner: AgentRunner,
    events: Arc<dyn InstallEvents>,
    /// The agents folder.
    root: Option<PathBuf>,
    sources: Sources,
    installed: Mutex<Installed>,
    /// The sizes of the versions the registry offers and of RIM's Node.js download.
    sizes: SizeCache,
    /// Held by the one install or removal that runs.
    busy: tokio::sync::Mutex<()>,
}

/// Locks `mutex`, going on with its contents if another thread panicked while holding it.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A random name for a download or a scratch folder: 24 hex characters.
fn random_name() -> Result<String, String> {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).map_err(|error| format!("No file name could be made: {error}."))?;
    Ok(hex::encode(bytes))
}

/// `path` as text.
fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The agent's folder is not valid text.".to_owned())
}

/// Removes the folder or file at `path`, saying in the log when that failed.
fn remove_all(path: &Path) {
    let removed = if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir()) {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match removed {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!(
            "[agent_installer] cannot remove {}: {error}",
            path.display()
        ),
    }
}

/// Removes everything in `dir` but `keep`.
fn remove_all_but(dir: &Path, keep: &[&Path]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !keep.contains(&path.as_path()) {
            remove_all(&path);
        }
    }
}

/// What a build left in its staging folder.
struct Built {
    /// The program's path relative to the staging folder: the agent itself, or for npm the
    /// script `node` runs.
    relative: PathBuf,
}

impl AgentInstaller {
    /// An installer that allows what it installs on `runner`, reports to `events`, installs into
    /// `root` and downloads from `sources`.
    pub(crate) fn new(
        runner: AgentRunner,
        events: Arc<dyn InstallEvents>,
        root: Option<PathBuf>,
        sources: Sources,
    ) -> Self {
        let installed = match &root {
            Some(root) => {
                let (installed, warning) = state::read(&root.join(state::FILE_NAME));
                if let Some(warning) = warning {
                    log::warn!("[agent_installer] {warning}");
                }
                installed
            }
            None => Installed::default(),
        };
        let installer = Self {
            runner,
            events,
            root,
            sources,
            installed: Mutex::new(installed),
            sizes: SizeCache::default(),
            busy: tokio::sync::Mutex::new(()),
        };
        installer.share_node_bin();
        installer
    }

    fn root(&self) -> Result<&Path, String> {
        self.root.as_deref().ok_or_else(|| NO_FOLDER.to_owned())
    }

    /// The folder of RIM's Node.js `version`.
    fn node_dir(root: &Path, version: &str) -> PathBuf {
        root.join(NODE_FOLDER).join(version)
    }

    /// Tells the runner which Node.js `bin` folder to put first on `PATH`: the recorded one,
    /// when it is there.
    fn share_node_bin(&self) {
        let bin = match (&self.root, &lock(&self.installed).node) {
            (Some(root), Some(version)) => {
                let dir = Self::node_dir(root, version);
                node::node_program(&dir)
                    .is_file()
                    .then(|| node::node_bin(&dir))
            }
            _ => None,
        };
        self.runner.set_node_bin(bin);
    }

    fn progress(&self, preset: &Preset, stage: Stage, received: Option<u64>, total: Option<u64>) {
        self.events.progress(ProgressEvent {
            preset_id: preset.id.to_owned(),
            stage,
            received,
            total,
        });
    }

    /// Saves `installed` and makes it the record.
    fn save(&self, installed: Installed) -> Result<(), String> {
        state::write(&self.root()?.join(state::FILE_NAME), &installed)?;
        *lock(&self.installed) = installed;
        Ok(())
    }

    /// Every supported agent, in table order, with the registry's offer for this computer and its
    /// size, and what is installed with what it uses on disk; RIM's Node.js; and what the agents
    /// folder uses. When the registry cannot be fetched, each entry says why. The registry, the
    /// sizes and the disk are read at once.
    pub(crate) async fn catalog(&self) -> Catalog {
        let installed = lock(&self.installed).clone();
        let root = self.root.clone();
        let recorded = installed.clone();
        let disk =
            tokio::task::spawn_blocking(move || DiskUse::measure(root.as_deref(), &recorded));
        let offers = async {
            let (registry, node_download) =
                tokio::join!(self.sources.net.registry(), self.node_download());
            let offers: Vec<Result<Resolved, String>> = presets::PRESETS
                .iter()
                .map(|preset| {
                    registry
                        .as_ref()
                        .map_err(Clone::clone)
                        .and_then(|registry| {
                            presets::resolve(
                                preset,
                                registry.entry(preset.registry_id),
                                self.sources.platform.as_deref(),
                                &self.sources.node,
                            )
                        })
                })
                .collect();
            let sizes = futures_util::future::join_all(presets::PRESETS.iter().zip(&offers).map(
                |(preset, offer)| async move {
                    match offer {
                        Ok(resolved) => self.size(preset, resolved).await,
                        Err(_) => None,
                    }
                },
            ))
            .await;
            (offers, sizes, node_download)
        };
        let (disk, (offers, sizes, node_download)) = tokio::join!(disk, offers);
        let disk = disk.unwrap_or_else(|_| DiskUse::measure(None, &installed));
        let agents = presets::PRESETS
            .iter()
            .zip(offers)
            .zip(sizes)
            .map(|((preset, offer), size)| {
                let (available, problem) = match offer {
                    Ok(resolved) => (
                        Some(Available {
                            size,
                            ..resolved.available
                        }),
                        None,
                    ),
                    Err(problem) => (None, Some(problem)),
                };
                CatalogEntry {
                    preset_id: preset.id.to_owned(),
                    name: preset.name.to_owned(),
                    available,
                    installed: installed
                        .agent(preset.id)
                        .cloned()
                        .map(|agent| CatalogInstalled {
                            disk_bytes: disk.agents.get(preset.id).copied().flatten(),
                            agent,
                        }),
                    problem,
                }
            })
            .collect();
        Catalog {
            agents,
            node: installed.node.clone().map(|version| CatalogNode {
                version,
                disk_bytes: disk.node,
            }),
            node_download,
            total_bytes: disk.total,
        }
    }

    /// How big `resolved`, the registry's offer for `preset`, is: its archive's download, or for
    /// npm what it takes once installed. Kept by version.
    async fn size(&self, preset: &Preset, resolved: &Resolved) -> Option<Size> {
        let key = format!("{}@{}", preset.id, resolved.available.version);
        match &resolved.target {
            Target::Binary { url, .. } => {
                let bytes = self
                    .sizes
                    .get_or(key, self.sources.net.head_size(url))
                    .await?;
                Some(Size {
                    bytes,
                    kind: SizeKind::Download,
                })
            }
            Target::Npm { package } => {
                let platform = self
                    .sources
                    .platform
                    .as_deref()
                    .and_then(NpmPlatform::from_key)?;
                let work = size::npm_size(
                    &self.sources.net,
                    package,
                    &resolved.available.version,
                    platform,
                );
                let bytes = self.sizes.get_or(key, work).await?;
                Some(Size {
                    bytes,
                    kind: SizeKind::Installed,
                })
            }
        }
    }

    /// What RIM's Node.js downloads, when it is not installed yet and has a build here. Kept by
    /// version.
    async fn node_download(&self) -> Option<u64> {
        let root = self.root.as_deref()?;
        if self.node_ready(root) {
            return None;
        }
        let release = &self.sources.node;
        let archive = release.archive_for(self.sources.platform.as_deref()?)?;
        self.sizes
            .get_or(
                format!("node@{}", release.version),
                self.sources.net.head_size(&release.url(archive)),
            )
            .await
    }

    /// Whether RIM's pinned Node.js is installed and recorded.
    fn node_ready(&self, root: &Path) -> bool {
        let version = &self.sources.node.version;
        lock(&self.installed).node.as_ref() == Some(version)
            && node::node_program(&Self::node_dir(root, version)).is_file()
    }

    /// Installs preset `preset_id` at the registry's version, or updates it to that version,
    /// after the person agreed in a native dialog, and allows the installed program with its
    /// arguments. An update takes the old pair off the allow list and deletes the old version.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the preset is unknown, another install runs, the registry or
    /// its entry is not usable, the allow list is full, or a step of the install failed. Nothing
    /// is left behind then, except RIM's Node.js once it was installed.
    pub(crate) async fn install(&self, preset_id: &str) -> Result<InstallOutcome, String> {
        let preset = presets::find(preset_id).ok_or(UNKNOWN_PRESET)?;
        let root = self.root()?;
        let _busy = self.busy.try_lock().map_err(|_| BUSY)?;
        let registry = self.sources.net.registry().await?;
        let resolved = presets::resolve(
            preset,
            registry.entry(preset.registry_id),
            self.sources.platform.as_deref(),
            &self.sources.node,
        )?;
        let old = lock(&self.installed).agent(preset.id).cloned();
        let old_pair = old.as_ref().map(|agent| AllowedProgram {
            program: agent.program.clone(),
            args: agent.args.clone(),
        });
        self.runner.check_allow_room(old_pair.as_ref())?;
        let needs_node = preset.is_npm() && !self.node_ready(root);
        let size = self.size(preset, &resolved).await;
        let node = if needs_node {
            Some(NodeOffer {
                version: &self.sources.node.version,
                download: self.node_download().await,
            })
        } else {
            None
        };
        let available = Available {
            size,
            ..resolved.available.clone()
        };
        let message = install_message(preset, &available, node);
        if !self
            .runner
            .ask(&format!("Install {}?", preset.name), message, "Install")
            .await?
        {
            return Ok(InstallOutcome::Declined);
        }
        log::info!(
            "[agent_installer] installing {} {}",
            preset.id,
            resolved.available.version
        );

        let preset_dir = root.join(preset.id);
        remove_all(&root.join(DOWNLOADS_FOLDER));
        remove_npm_caches(root);
        self.remove_scratch(&preset_dir);
        let node_dir = if preset.is_npm() {
            Some(self.ensure_node(root, preset).await?)
        } else {
            None
        };
        std::fs::create_dir_all(&preset_dir)
            .map_err(|error| format!("The agent's folder could not be made: {error}."))?;
        let staging = preset_dir.join(format!("{STAGING_PREFIX}{}", random_name()?));
        let built = match self
            .build(root, preset, &resolved, &staging, node_dir.as_deref())
            .await
        {
            Ok(built) => built,
            Err(error) => {
                remove_all(&staging);
                return Err(error);
            }
        };

        let version_dir = preset_dir.join(&resolved.available.version);
        let aside = if version_dir.exists() {
            let aside = preset_dir.join(format!("{OLD_PREFIX}{}", random_name()?));
            if let Err(error) = std::fs::rename(&version_dir, &aside) {
                remove_all(&staging);
                return Err(format!("The old version could not be moved: {error}."));
            }
            Some(aside)
        } else {
            None
        };
        let undo_files = |aside: &Option<PathBuf>| {
            remove_all(&version_dir);
            if let Some(aside) = aside {
                let _ = std::fs::rename(aside, &version_dir);
            }
        };
        if let Err(error) = std::fs::rename(&staging, &version_dir) {
            remove_all(&staging);
            undo_files(&aside);
            return Err(format!("The agent could not be put in place: {error}."));
        }

        let finished = self.finish(
            preset,
            &resolved,
            &version_dir,
            &built,
            node_dir.as_deref(),
            old_pair.as_ref(),
        );
        let agent = match finished {
            Ok(agent) => agent,
            Err(error) => {
                undo_files(&aside);
                return Err(error);
            }
        };
        if let Some(aside) = &aside {
            remove_all(aside);
        }
        remove_all_but(&preset_dir, &[version_dir.as_path()]);
        self.prune_node(root);
        self.progress(preset, Stage::Done, None, None);
        log::info!(
            "[agent_installer] installed {} {}",
            preset.id,
            agent.version
        );
        let replaced =
            old_pair.filter(|old| old.program != agent.program || old.args != agent.args);
        Ok(InstallOutcome::Installed { agent, replaced })
    }

    /// Removes leftover staging and old folders of an install that did not finish.
    fn remove_scratch(&self, preset_dir: &Path) {
        let Ok(entries) = std::fs::read_dir(preset_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(STAGING_PREFIX) || name.starts_with(OLD_PREFIX) {
                remove_all(&entry.path());
            }
        }
    }

    /// Fetches and unpacks the agent into `staging`, or installs its npm package there.
    async fn build(
        &self,
        root: &Path,
        preset: &Preset,
        resolved: &Resolved,
        staging: &Path,
        node_dir: Option<&Path>,
    ) -> Result<Built, String> {
        std::fs::create_dir(staging)
            .map_err(|error| format!("The agent's folder could not be made: {error}."))?;
        match &resolved.target {
            Target::Binary {
                url,
                sha256,
                format,
                cmd,
            } => {
                self.fetch_and_unpack(
                    root,
                    preset,
                    Stage::Downloading,
                    url,
                    sha256,
                    *format,
                    staging,
                )
                .await?;
                let relative = PathBuf::from(cmd);
                make_runnable(&checked_program(staging, &relative)?)?;
                Ok(Built { relative })
            }
            Target::Npm { package } => {
                let node_dir = node_dir.ok_or(NOT_AVAILABLE)?;
                self.progress(preset, Stage::Installing, None, None);
                let cache =
                    ScratchFolder(root.join(format!("{NPM_CACHE_PREFIX}-{}", random_name()?)));
                let installed = node::npm_install(
                    node_dir,
                    staging,
                    &cache.0,
                    package,
                    &resolved.available.version,
                )
                .await;
                drop(cache);
                installed?;
                let script = node::package_bin(staging, package)?;
                let relative = script
                    .strip_prefix(staging)
                    .map_err(|_| format!("{package} was installed without a program to start."))?
                    .to_path_buf();
                Ok(Built { relative })
            }
        }
    }

    /// Downloads `url`, checks it against `sha256` and unpacks it in `format` into `dest`,
    /// reporting progress under `stage`. The download is deleted on every path.
    #[allow(clippy::too_many_arguments)]
    async fn fetch_and_unpack(
        &self,
        root: &Path,
        preset: &Preset,
        stage: Stage,
        url: &str,
        sha256: &str,
        format: unpack::Format,
        dest: &Path,
    ) -> Result<(), String> {
        let events = self.events.clone();
        let preset_id = preset.id.to_owned();
        let mut report = move |received: u64, total: Option<u64>| {
            events.progress(ProgressEvent {
                preset_id: preset_id.clone(),
                stage,
                received: Some(received),
                total,
            });
        };
        let download = self
            .sources
            .net
            .download(url, sha256, &root.join(DOWNLOADS_FOLDER), &mut report)
            .await?;
        let later = |next: Stage| {
            if stage == Stage::Node {
                Stage::Node
            } else {
                next
            }
        };
        self.progress(preset, later(Stage::Checking), None, None);
        self.progress(preset, later(Stage::Unpacking), None, None);
        let archive = download.path.clone();
        let dest = dest.to_path_buf();
        let unpacked = tokio::task::spawn_blocking(move || unpack::unpack(&archive, format, &dest))
            .await
            .map_err(|_| "The download could not be unpacked.".to_owned())?;
        drop(download);
        unpacked
    }

    /// Installs RIM's pinned Node.js when it is not installed yet, records it and tells the
    /// runner, and returns its folder.
    async fn ensure_node(&self, root: &Path, preset: &Preset) -> Result<PathBuf, String> {
        let release = &self.sources.node;
        let dir = Self::node_dir(root, &release.version);
        if self.node_ready(root) {
            return Ok(dir);
        }
        let platform = self.sources.platform.as_deref().ok_or(NOT_AVAILABLE)?;
        let archive = release.archive_for(platform).ok_or(NOT_AVAILABLE)?;
        let node_root = root.join(NODE_FOLDER);
        std::fs::create_dir_all(&node_root)
            .map_err(|error| format!("Node.js's folder could not be made: {error}."))?;
        self.remove_scratch(&node_root);
        let staging = node_root.join(format!("{STAGING_PREFIX}{}", random_name()?));
        std::fs::create_dir(&staging)
            .map_err(|error| format!("Node.js's folder could not be made: {error}."))?;
        let placed = async {
            self.fetch_and_unpack(
                root,
                preset,
                Stage::Node,
                &release.url(archive),
                &archive.sha256,
                archive.format(),
                &staging,
            )
            .await?;
            let unpacked = staging.join(archive.top_folder());
            if !node::node_program(&unpacked).is_file() || !node::npm_cli(&unpacked).is_file() {
                return Err("The Node.js download does not hold node and npm.".to_owned());
            }
            remove_all(&dir);
            std::fs::rename(&unpacked, &dir)
                .map_err(|error| format!("Node.js could not be put in place: {error}."))
        }
        .await;
        remove_all(&staging);
        placed?;
        let mut installed = lock(&self.installed).clone();
        installed.node = Some(release.version.clone());
        self.save(installed)?;
        self.share_node_bin();
        log::info!("[agent_installer] installed Node.js {}", release.version);
        Ok(dir)
    }

    /// Records the agent in `version_dir`, swaps its pair on the allow list for `old_pair`, and
    /// returns its record. On failure the list and the record are as they were.
    fn finish(
        &self,
        preset: &Preset,
        resolved: &Resolved,
        version_dir: &Path,
        built: &Built,
        node_dir: Option<&Path>,
        old_pair: Option<&AllowedProgram>,
    ) -> Result<InstalledAgent, String> {
        let target = version_dir.join(&built.relative);
        checked_program(version_dir, &built.relative)?;
        let expected: Vec<String> = preset.args.iter().map(|arg| (*arg).to_owned()).collect();
        let (program, args) = match node_dir {
            Some(node_dir) => {
                let mut args = vec![path_text(&target)?];
                args.extend(expected);
                (path_text(&node::node_program(node_dir))?, args)
            }
            None => (path_text(&target)?, expected),
        };
        let agent = InstalledAgent {
            preset_id: preset.id.to_owned(),
            version: resolved.available.version.clone(),
            program,
            args,
            installed_at: chrono::Utc::now().timestamp_millis(),
        };
        let pair = AllowedProgram {
            program: agent.program.clone(),
            args: agent.args.clone(),
        };
        self.runner.replace_allowed(old_pair, Some(pair.clone()))?;
        let mut installed = lock(&self.installed).clone();
        installed.set_agent(agent.clone());
        if let Err(error) = self.save(installed) {
            let _ = self.runner.replace_allowed(Some(&pair), old_pair.cloned());
            return Err(error);
        }
        Ok(agent)
    }

    /// Deletes Node.js versions no installed agent uses; with no npm agent left, all of them,
    /// and records that none is installed.
    fn prune_node(&self, root: &Path) {
        let mut installed = lock(&self.installed).clone();
        let node_root = root.join(NODE_FOLDER);
        let any_npm = installed
            .agents
            .iter()
            .any(|agent| presets::find(&agent.preset_id).is_some_and(Preset::is_npm));
        if !any_npm {
            remove_all(&node_root);
            if installed.node.is_some() {
                installed.node = None;
                if let Err(error) = self.save(installed) {
                    log::warn!("[agent_installer] {error}");
                }
                self.share_node_bin();
            }
            return;
        }
        let Ok(entries) = std::fs::read_dir(&node_root) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let current = installed
                .node
                .as_ref()
                .is_some_and(|version| path == Self::node_dir(root, version));
            let used = installed
                .agents
                .iter()
                .any(|agent| Path::new(&agent.program).starts_with(&path));
            if !current && !used {
                remove_all(&path);
            }
        }
    }

    /// Removes preset `preset_id`'s files and its pair on the allow list, without asking.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the preset is unknown, an install runs, the agent is
    /// running, or the list or the record could not be saved.
    pub(crate) async fn remove(&self, preset_id: &str) -> Result<(), String> {
        let preset = presets::find(preset_id).ok_or(UNKNOWN_PRESET)?;
        let root = self.root()?;
        let _busy = self.busy.try_lock().map_err(|_| BUSY)?;
        let agent = lock(&self.installed).agent(preset.id).cloned();
        if let Some(agent) = agent {
            if self.runner.is_running(&agent.program, &agent.args) {
                return Err(STOP_FIRST.to_owned());
            }
            let pair = AllowedProgram {
                program: agent.program.clone(),
                args: agent.args.clone(),
            };
            self.runner.replace_allowed(Some(&pair), None)?;
            let mut installed = lock(&self.installed).clone();
            installed.remove_agent(preset.id);
            if let Err(error) = self.save(installed) {
                let _ = self.runner.replace_allowed(None, Some(pair));
                return Err(error);
            }
        }
        let preset_dir = root.join(preset.id);
        let removed = match std::fs::remove_dir_all(&preset_dir) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(format!(
                "Some of {}'s files could not be deleted: {error}.",
                preset.name
            )),
            _ => Ok(()),
        };
        self.prune_node(root);
        log::info!("[agent_installer] removed {}", preset.id);
        removed
    }
}

/// The program at `relative` in `dir`, once it resolves inside `dir` to a file.
fn checked_program(dir: &Path, relative: &Path) -> Result<PathBuf, String> {
    let missing = || "The download does not hold the agent's program.".to_owned();
    let program = std::fs::canonicalize(dir.join(relative)).map_err(|_| missing())?;
    let dir = std::fs::canonicalize(dir).map_err(|_| missing())?;
    if !program.starts_with(&dir) || !program.is_file() {
        return Err(missing());
    }
    Ok(program)
}

/// Sets `program`'s permission bits to 0o755 on Unix; elsewhere a file runs as it is.
fn make_runnable(program: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(program, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("The program could not be made runnable: {error}."))
    }
    #[cfg(not(unix))]
    {
        let _ = program;
        Ok(())
    }
}

/// Removes the npm cache folders an install left in the agents folder `root`.
fn remove_npm_caches(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(NPM_CACHE_PREFIX)
        {
            remove_all(&entry.path());
        }
    }
}

/// RIM's Node.js as an install downloads it: its version and its archive's size when known.
#[derive(Debug, Clone, Copy)]
struct NodeOffer<'a> {
    version: &'a str,
    download: Option<u64>,
}

/// The install dialog's message: what is downloaded, from where and under which licence; when
/// `node` is given, that Node.js at that version is downloaded too; and the sizes that are
/// known.
fn install_message(preset: &Preset, available: &Available, node: Option<NodeOffer<'_>>) -> String {
    let mut message = format!(
        "RIM will download {} {} from {} (licence: {}), check it and install it in RIM's own \
         folder. RIM can then start it on this computer.",
        preset.name, available.version, available.source, available.license
    );
    if let Some(node) = node {
        message.push_str(&format!(
            "\n\nIt also downloads Node.js {} from nodejs.org, once.",
            node.version
        ));
    }
    let mut sizes = Vec::new();
    match available.size {
        Some(Size {
            bytes,
            kind: SizeKind::Download,
        }) => sizes.push(format!("Download: about {}.", size::size_text(bytes))),
        Some(Size {
            bytes,
            kind: SizeKind::Installed,
        }) => sizes.push(format!(
            "It takes about {} once installed.",
            size::size_text(bytes)
        )),
        None => {}
    }
    if let Some(NodeOffer {
        version,
        download: Some(bytes),
    }) = node
    {
        sizes.push(format!(
            "Node.js {version} adds about {} to download.",
            size::size_text(bytes)
        ));
    }
    if !sizes.is_empty() {
        message.push_str("\n\n");
        message.push_str(&sizes.join(" "));
    }
    message
}

/// Refuses a call that does not come from the main window.
fn from_main_window<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    if webview.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err("Agents can be installed only from the main window.".to_owned())
    }
}

/// Puts the installer in the app's state, with its folder in the app's data directory. Runs after
/// the agent runner's setup, whose allow list it shares.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) {
    let Some(runner) = app.try_state::<AgentRunner>() else {
        log::warn!("[agent_installer] no agent runner, installing agents is off");
        return;
    };
    let sources = match Sources::live() {
        Ok(sources) => sources,
        Err(error) => {
            log::warn!("[agent_installer] installing agents is off: {error}");
            return;
        }
    };
    let root = match app.path().app_data_dir() {
        Ok(dir) => Some(dir.join(AGENTS_FOLDER)),
        Err(error) => {
            log::warn!("[agent_installer] no data directory, agents can't be installed: {error}");
            None
        }
    };
    app.manage(AgentInstaller::new(
        runner.inner().clone(),
        Arc::new(PageEvents(app.clone())),
        root,
        sources,
    ));
}

/// Every agent RIM can install, with the registry's version for this computer and its size, what
/// is installed and what it uses on disk, RIM's Node.js, and what the agents folder uses.
///
/// # Errors
///
/// A sentence for the page when the call does not come from the main window.
#[tauri::command]
pub async fn agent_installer_catalog<R: Runtime>(
    webview: Webview<R>,
    installer: State<'_, AgentInstaller>,
) -> Result<Catalog, String> {
    from_main_window(&webview)?;
    Ok(installer.catalog().await)
}

/// Installs or updates the agent of preset `preset_id`, after a native dialog.
///
/// # Errors
///
/// A sentence for the page saying why it was not installed.
#[tauri::command]
pub async fn agent_installer_install<R: Runtime>(
    webview: Webview<R>,
    installer: State<'_, AgentInstaller>,
    preset_id: String,
) -> Result<InstallOutcome, String> {
    from_main_window(&webview)?;
    installer.install(&preset_id).await
}

/// Removes the agent of preset `preset_id` and its allowed pair.
///
/// # Errors
///
/// A sentence for the page saying why it was not removed.
#[tauri::command]
pub async fn agent_installer_remove<R: Runtime>(
    webview: Webview<R>,
    installer: State<'_, AgentInstaller>,
    preset_id: String,
) -> Result<(), String> {
    from_main_window(&webview)?;
    installer.remove(&preset_id).await
}
