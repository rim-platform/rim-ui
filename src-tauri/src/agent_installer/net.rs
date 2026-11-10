//! The installer's downloads: the ACP registry, kept for a while, and archives streamed to a file
//! while they are hashed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::redirect::{Attempt, Policy};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

const MIB: u64 = 1024 * 1024;
/// The ACP registry RIM reads agent versions from.
pub(crate) const REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
/// How long fetching the registry may take.
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(20);
/// Largest registry accepted.
const MAX_REGISTRY: u64 = 8 * MIB;
/// How long a fetched registry is used before it is fetched again.
const REGISTRY_KEPT: Duration = Duration::from_secs(10 * 60);
/// Largest download accepted.
const MAX_DOWNLOAD: u64 = 1024 * MIB;
/// How long a download may go without receiving anything.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// How long connecting to a server may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Most redirects one request follows.
const MAX_REDIRECTS: usize = 10;
/// Least time between two progress reports of one download.
pub(crate) const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// The registry's agents, by id.
#[derive(Debug)]
pub(crate) struct Registry {
    agents: HashMap<String, serde_json::Value>,
}

impl Registry {
    /// Reads a registry document: its `version` must start with `1.`; agents without an `id` are
    /// left out.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the document is not a registry RIM can read.
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, String> {
        let unreadable = || "The list of agents can't be read.".to_owned();
        let document: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| unreadable())?;
        let version = document
            .get("version")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(unreadable)?;
        if !version.starts_with("1.") {
            return Err(format!(
                "The list of agents is in a newer format ({}) than this version of RIM reads.",
                version.chars().take(16).collect::<String>()
            ));
        }
        let agents = document
            .get("agents")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(unreadable)?
            .iter()
            .filter_map(|agent| {
                let id = agent.get("id")?.as_str()?.to_owned();
                Some((id, agent.clone()))
            })
            .collect();
        Ok(Self { agents })
    }

    /// The entry of the agent with registry id `id`.
    pub(crate) fn entry(&self, id: &str) -> Option<&serde_json::Value> {
        self.agents.get(id)
    }
}

/// Where downloads come from and how they are made.
pub(crate) struct Net {
    client: reqwest::Client,
    registry_url: String,
    /// The only scheme downloads and redirects may use.
    scheme: &'static str,
    /// A base URL every `https://` download is fetched under instead, for tests.
    mirror: Option<String>,
    cache: Mutex<Option<(Instant, Arc<Registry>)>>,
}

/// A downloaded file, deleted when this is dropped.
pub(crate) struct Download {
    pub(crate) path: PathBuf,
}

impl Drop for Download {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

impl Net {
    /// Downloads from the real servers over `https://` only.
    ///
    /// # Errors
    ///
    /// A sentence when no HTTP client could be made.
    pub(crate) fn live() -> Result<Self, String> {
        Self::new(REGISTRY_URL.to_owned(), "https", None)
    }

    /// Downloads with the registry at `registry_url`, `scheme` as the only scheme, and every
    /// `https://` URL fetched under `mirror` when it is given.
    ///
    /// # Errors
    ///
    /// A sentence when no HTTP client could be made.
    pub(crate) fn new(
        registry_url: String,
        scheme: &'static str,
        mirror: Option<String>,
    ) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .redirect(redirect_policy(scheme))
            .referer(false)
            .user_agent(concat!("RIM/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| format!("No HTTP client could be made: {error}"))?;
        Ok(Self {
            client,
            registry_url,
            scheme,
            mirror,
            cache: Mutex::new(None),
        })
    }

    /// `url` as it is fetched: under the mirror when there is one.
    fn fetched_url(&self, url: &str) -> String {
        match (&self.mirror, url.strip_prefix("https://")) {
            (Some(mirror), Some(rest)) => format!("{mirror}/{rest}"),
            _ => url.to_owned(),
        }
    }

    /// The registry, fetched again when the one kept is older than [`REGISTRY_KEPT`].
    ///
    /// # Errors
    ///
    /// A sentence for the page when it could not be fetched or read.
    pub(crate) async fn registry(&self) -> Result<Arc<Registry>, String> {
        if let Some((fetched, registry)) = &*self.lock_cache() {
            if fetched.elapsed() < REGISTRY_KEPT {
                return Ok(registry.clone());
            }
        }
        let failed = |why: String| format!("The list of agents could not be fetched: {why}");
        let mut response = self
            .client
            .get(&self.registry_url)
            .timeout(REGISTRY_TIMEOUT)
            .send()
            .await
            .map_err(|error| failed(describe(&error)))?;
        if !response.status().is_success() {
            return Err(failed(format!(
                "the server answered {}.",
                response.status().as_u16()
            )));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| failed(describe(&error)))?
        {
            if bytes.len() as u64 + chunk.len() as u64 > MAX_REGISTRY {
                return Err(failed("it is too large.".to_owned()));
            }
            bytes.extend_from_slice(&chunk);
        }
        let registry = Arc::new(Registry::parse(&bytes)?);
        *self.lock_cache() = Some((Instant::now(), registry.clone()));
        Ok(registry)
    }

    /// Drops the registry kept, so the next call fetches it again.
    #[cfg(test)]
    pub(crate) fn forget_registry(&self) {
        *self.lock_cache() = None;
    }

    fn lock_cache(&self) -> std::sync::MutexGuard<'_, Option<(Instant, Arc<Registry>)>> {
        self.cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Streams `url` to a new file in `dir` while hashing it, and keeps it only when its SHA-256
    /// is `sha256`. `progress` gets the bytes received and the total when the server said it, at
    /// most every [`PROGRESS_EVERY`] and once at the end.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the download fails, is over [`MAX_DOWNLOAD`], or does not
    /// match; the file is then deleted.
    pub(crate) async fn download(
        &self,
        url: &str,
        sha256: &str,
        dir: &Path,
        progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> Result<Download, String> {
        let url = self.fetched_url(url);
        if !url.starts_with(&format!("{}://", self.scheme)) {
            return Err("The download link was refused.".to_owned());
        }
        let failed = |why: String| format!("The download failed: {why}");
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|error| failed(format!("{error}.")))?;
        let download = Download {
            path: dir.join(super::random_name()?),
        };
        let mut response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|error| failed(describe(&error)))?;
        if !response.status().is_success() {
            return Err(failed(format!(
                "the server answered {}.",
                response.status().as_u16()
            )));
        }
        let total = response.content_length();
        if total.is_some_and(|total| total > MAX_DOWNLOAD) {
            return Err(failed("it is too large.".to_owned()));
        }
        let mut file = tokio::fs::File::create(&download.path)
            .await
            .map_err(|error| failed(format!("{error}.")))?;
        let mut hasher = Sha256::new();
        let mut received: u64 = 0;
        let mut reported = Instant::now();
        progress(0, total);
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| failed(describe(&error)))?
        {
            received += chunk.len() as u64;
            if received > MAX_DOWNLOAD {
                return Err(failed("it is too large.".to_owned()));
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|error| failed(format!("{error}.")))?;
            if reported.elapsed() >= PROGRESS_EVERY {
                reported = Instant::now();
                progress(received, total);
            }
        }
        file.flush()
            .await
            .map_err(|error| failed(format!("{error}.")))?;
        drop(file);
        progress(received, total);
        if hex::encode(hasher.finalize()) != sha256 {
            return Err("The download does not match its checksum, so it was deleted.".to_owned());
        }
        Ok(download)
    }
}

/// A reqwest failure in a sentence, without its URL.
fn describe(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "it took too long.".to_owned()
    } else if error.is_redirect() {
        "the server redirected somewhere RIM doesn't follow.".to_owned()
    } else {
        let mut text = String::from("the server could not be reached");
        let mut source = std::error::Error::source(error);
        while let Some(inner) = source {
            text = format!("{text}: {inner}");
            source = inner.source();
        }
        format!("{text}.")
    }
}

/// Follows redirects only to `scheme`, without credentials, at most [`MAX_REDIRECTS`] times.
fn redirect_policy(scheme: &'static str) -> Policy {
    Policy::custom(move |attempt: Attempt| {
        let url = attempt.url();
        if url.scheme() != scheme || !url.username().is_empty() || url.password().is_some() {
            attempt.error("redirect refused")
        } else if attempt.previous().len() > MAX_REDIRECTS {
            attempt.error("too many redirects")
        } else {
            attempt.follow()
        }
    })
}

/// The registry's platform key for this computer, such as `linux-x86_64` or
/// `darwin-aarch64`; on Linux with musl and no glibc, with `-musl` after it. `None` for an
/// operating system or processor the registry has no key for.
pub(crate) fn platform_key() -> Option<String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        _ => return None,
    };
    let arch = match std::env::consts::ARCH {
        arch @ ("x86_64" | "aarch64") => arch,
        _ => return None,
    };
    let key = format!("{os}-{arch}");
    if os == "linux" && is_musl(arch, Path::new("/")) {
        return Some(format!("{key}-musl"));
    }
    Some(key)
}

/// Whether the system under `root` has musl's loader for `arch` and no glibc loader.
fn is_musl(arch: &str, root: &Path) -> bool {
    let musl = root.join(format!("lib/ld-musl-{arch}.so.1"));
    let glibc = [
        root.join("lib64/ld-linux-x86-64.so.2"),
        root.join("lib/ld-linux-aarch64.so.1"),
    ];
    musl.exists() && !glibc.iter().any(|loader| loader.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_registry_must_be_version_one() {
        let registry = Registry::parse(
            br#"{"version":"1.0.0","agents":[{"id":"goose","version":"1"},{"x":1}]}"#,
        )
        .unwrap();
        assert!(registry.entry("goose").is_some());
        assert!(registry.entry("x").is_none());
        assert!(Registry::parse(br#"{"version":"2.0.0","agents":[]}"#)
            .unwrap_err()
            .contains("newer format"));
        assert!(Registry::parse(b"[]").is_err());
        assert!(Registry::parse(br#"{"version":"1.0.0"}"#).is_err());
    }

    #[test]
    fn musl_is_told_apart_from_glibc() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        assert!(!is_musl("x86_64", root));
        std::fs::create_dir_all(root.join("lib")).unwrap();
        std::fs::write(root.join("lib/ld-musl-x86_64.so.1"), "").unwrap();
        assert!(is_musl("x86_64", root));
        std::fs::create_dir_all(root.join("lib64")).unwrap();
        std::fs::write(root.join("lib64/ld-linux-x86-64.so.2"), "").unwrap();
        assert!(!is_musl("x86_64", root));
    }

    #[test]
    fn this_computer_has_a_platform_key() {
        if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            assert!(platform_key().unwrap().starts_with("linux-x86_64"));
        }
    }

    #[test]
    fn https_urls_are_fetched_under_the_mirror() {
        let net = Net::new(
            "http://127.0.0.1:1/r.json".into(),
            "http",
            Some("http://127.0.0.1:1".into()),
        )
        .unwrap();
        assert_eq!(
            net.fetched_url("https://github.com/a/b/releases/download/v1/x.zip"),
            "http://127.0.0.1:1/github.com/a/b/releases/download/v1/x.zip"
        );
        let live = Net::live().unwrap();
        assert_eq!(
            live.fetched_url("https://nodejs.org/x"),
            "https://nodejs.org/x"
        );
    }
}
