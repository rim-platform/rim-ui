//! `.rimbundle` files: a plugin's files in one JSON document.
//!
//! ```json
//! {"format":"rim-plugin-bundle","v":1,"files":[{"path":"main.mjs","text":"…"},{"path":"rim-plugin.json","text":"…"}]}
//! ```
//!
//! A reader takes the bytes exactly as fetched and never re-serializes them:
//! the bundle hash is the SHA-256 of those bytes. A writer sorts `files` by
//! path and writes compact JSON, so the same files always give the same bytes.
//! The desktop installs a bundle by unpacking it into the plugins directory
//! through a staging directory, with the path checks of a local-folder install.

use crate::plugin_host::discovery::MANIFEST_FILE;
use crate::plugin_host::local_install::check_path_safe;
use crate::plugin_host::manifest::{PluginManifest, RuntimeKind};
use crate::plugin_host::validation::is_bundle_path;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// The `format` field of every bundle.
pub const BUNDLE_FORMAT: &str = "rim-plugin-bundle";
/// The only bundle version.
pub const BUNDLE_VERSION: u32 = 1;
/// Largest bundle file, in bytes.
pub const MAX_BUNDLE_BYTES: usize = 8 * 1024 * 1024;
/// Most files a bundle may hold.
pub const MAX_BUNDLE_FILES: usize = 256;
/// Folder every file of a `WebSandboxed` bundle lives in, other than the
/// manifest and the entrypoint.
pub const PANELS_DIR: &str = "panels/";

/// Why bytes are not a bundle this host accepts.
#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    #[error("bundle is {0} bytes, over the {MAX_BUNDLE_BYTES}-byte limit")]
    TooLarge(usize),
    #[error("not a plugin bundle: {0}")]
    Malformed(String),
    #[error("bundle hashes to {actual}, not the expected {expected}")]
    HashMismatch { expected: String, actual: String },
    #[error("bundle manifest: {0}")]
    Manifest(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBundle {
    format: String,
    v: u32,
    files: Vec<RawFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFile {
    path: String,
    #[serde(default, deserialize_with = "present_string")]
    text: Option<String>,
    #[serde(default, deserialize_with = "present_string")]
    base64: Option<String>,
}

/// A field that may be left out but, when present, must be a string (not `null`).
fn present_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}

#[derive(Serialize)]
struct WrittenBundle<'a> {
    format: &'static str,
    v: u32,
    files: Vec<WrittenFile<'a>>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum WrittenFile<'a> {
    Text { path: &'a str, text: &'a str },
    Binary { path: &'a str, base64: String },
}

/// One file of a bundle: its bundle path and its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// A bundle that passed every structural rule, with its manifest parsed.
#[derive(Debug, Clone)]
pub struct Bundle {
    /// Every file, sorted by path.
    pub files: Vec<BundleFile>,
    /// The exact text of `rim-plugin.json`.
    pub manifest_text: String,
    pub manifest: PluginManifest,
}

/// SHA-256 of `bytes` as 64 lowercase hex characters, what `sha256sum` prints.
pub fn bundle_sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Read a bundle file: structure, paths, manifest and the kind's file rules.
/// Install validation of the manifest is the caller's.
pub fn read_bundle(bytes: &[u8]) -> Result<Bundle, BundleError> {
    if bytes.len() > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge(bytes.len()));
    }
    let raw: RawBundle =
        serde_json::from_slice(bytes).map_err(|e| BundleError::Malformed(e.to_string()))?;
    if raw.format != BUNDLE_FORMAT {
        return Err(BundleError::Malformed(format!(
            "format is `{}`, not `{BUNDLE_FORMAT}`",
            raw.format
        )));
    }
    if raw.v != BUNDLE_VERSION {
        return Err(BundleError::Malformed(format!(
            "version {} is not {BUNDLE_VERSION}",
            raw.v
        )));
    }
    let mut files = Vec::with_capacity(raw.files.len());
    for file in raw.files {
        let bytes = match (file.text, file.base64) {
            (Some(text), None) => text.into_bytes(),
            (None, Some(encoded)) => STANDARD.decode(encoded.as_bytes()).map_err(|e| {
                BundleError::Malformed(format!("{} is not standard base64: {e}", file.path))
            })?,
            _ => {
                return Err(BundleError::Malformed(format!(
                    "{} needs exactly one of text and base64",
                    file.path
                )))
            }
        };
        files.push(BundleFile {
            path: file.path,
            bytes,
        });
    }
    check_files(files)
}

/// The rules every bundle's files follow, wherever they came from: 1 to 256
/// files sorted by path with no duplicates, bundle paths, a manifest, its
/// entrypoint, and for `WebSandboxed` nothing else outside `panels/` and an
/// entrypoint with no `#!` line.
pub fn check_files(files: Vec<BundleFile>) -> Result<Bundle, BundleError> {
    let malformed = |reason: String| Err(BundleError::Malformed(reason));
    if files.is_empty() || files.len() > MAX_BUNDLE_FILES {
        return malformed(format!(
            "holds {} files, must hold 1 to {MAX_BUNDLE_FILES}",
            files.len()
        ));
    }
    for (i, file) in files.iter().enumerate() {
        if !is_bundle_path(&file.path) {
            return malformed(format!("`{}` is not a valid bundle path", file.path));
        }
        if i > 0 && files[i - 1].path.as_bytes() >= file.path.as_bytes() {
            return malformed(format!(
                "paths must be sorted and unique: `{}` follows `{}`",
                file.path,
                files[i - 1].path
            ));
        }
    }
    let Some(manifest_file) = files.iter().find(|f| f.path == MANIFEST_FILE) else {
        return malformed(format!("{MANIFEST_FILE} is missing"));
    };
    let manifest_text = String::from_utf8(manifest_file.bytes.clone())
        .map_err(|_| BundleError::Manifest(format!("{MANIFEST_FILE} is not UTF-8")))?;
    let manifest: PluginManifest =
        serde_json::from_str(&manifest_text).map_err(|e| BundleError::Manifest(e.to_string()))?;
    manifest
        .validate()
        .map_err(|e| BundleError::Manifest(e.to_string()))?;
    let Some(entry) = files.iter().find(|f| f.path == manifest.entrypoint) else {
        return malformed(format!(
            "the entrypoint `{}` is missing",
            manifest.entrypoint
        ));
    };
    if manifest.runtime_kind == RuntimeKind::WebSandboxed {
        if entry.bytes.starts_with(b"#!") {
            return malformed("a WebSandboxed entrypoint has no #! line".into());
        }
        if std::str::from_utf8(&entry.bytes).is_err() {
            return malformed("a WebSandboxed entrypoint is UTF-8 JavaScript".into());
        }
        if let Some(stray) = files.iter().find(|f| {
            f.path != MANIFEST_FILE
                && f.path != manifest.entrypoint
                && !f.path.starts_with(PANELS_DIR)
        }) {
            return malformed(format!(
                "`{}` is outside panels/, where a WebSandboxed bundle keeps its other files",
                stray.path
            ));
        }
    }
    Ok(Bundle {
        files,
        manifest_text,
        manifest,
    })
}

/// Write files as a bundle: sorted by path, UTF-8 files as `text` and others as
/// `base64`, compact JSON.
pub fn write_bundle(files: &[BundleFile]) -> Vec<u8> {
    let mut sorted: Vec<&BundleFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
    let written = WrittenBundle {
        format: BUNDLE_FORMAT,
        v: BUNDLE_VERSION,
        files: sorted
            .into_iter()
            .map(|f| match std::str::from_utf8(&f.bytes) {
                Ok(text) => WrittenFile::Text {
                    path: &f.path,
                    text,
                },
                Err(_) => WrittenFile::Binary {
                    path: &f.path,
                    base64: STANDARD.encode(&f.bytes),
                },
            })
            .collect(),
    };
    serde_json::to_vec(&written).unwrap_or_default()
}

/// Every regular file under `dir` as bundle files, sorted by path. Entries
/// whose name starts with `.` (`.git`, `.DS_Store`) are skipped, as are
/// symbolic links that leave `dir`; any other name that is not a bundle path
/// is an error.
pub fn collect_dir(dir: &Path) -> Result<Vec<BundleFile>, BundleError> {
    let root = dir.canonicalize()?;
    let mut files = Vec::new();
    collect_into(&root, &root, &mut files)?;
    files.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
    Ok(files)
}

fn collect_into(root: &Path, dir: &Path, files: &mut Vec<BundleFile>) -> Result<(), BundleError> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(canonical) = entry.path().canonicalize() else {
            continue;
        };
        if !canonical.starts_with(root) {
            continue;
        }
        if canonical.is_dir() {
            collect_into(root, &canonical, files)?;
        } else if canonical.is_file() {
            let relative = canonical
                .strip_prefix(root)
                .map_err(|e| BundleError::Malformed(e.to_string()))?;
            let path = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if !is_bundle_path(&path) {
                return Err(BundleError::Malformed(format!(
                    "`{path}` is not a valid bundle path"
                )));
            }
            files.push(BundleFile {
                path,
                bytes: std::fs::read(&canonical)?,
            });
        }
    }
    Ok(())
}

/// Check a plugin folder against the bundle rules, as if it were bundled:
/// what [`check_files`] checks, and the size of the bundle it would make.
pub fn check_dir(dir: &Path) -> Result<Bundle, BundleError> {
    let bundle = check_files(collect_dir(dir)?)?;
    let size = write_bundle(&bundle.files).len();
    if size > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge(size));
    }
    Ok(bundle)
}

/// Unpack `bundle` into `<plugins_root>/<plugin_id>/` through a staging
/// directory: a `DesktopLocalProcess` entrypoint gets mode 0755 and every other
/// file 0644. With `replace`, an existing directory for the plugin is swapped
/// out; otherwise one is an error.
pub fn unpack(bundle: &Bundle, plugins_root: &Path, replace: bool) -> Result<PathBuf, BundleError> {
    let plugin_id = &bundle.manifest.plugin_id;
    let final_dir = plugins_root.join(plugin_id);
    check_path_safe(&final_dir).map_err(|e| BundleError::Malformed(e.to_string()))?;
    if final_dir.exists() && !replace {
        return Err(BundleError::Manifest(format!(
            "plugin already installed: {plugin_id}"
        )));
    }
    std::fs::create_dir_all(plugins_root)?;
    let staging = plugins_root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let written = write_files(bundle, &staging);
    if let Err(e) = written {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir)?;
    }
    if let Err(e) = std::fs::rename(&staging, &final_dir) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e.into());
    }
    Ok(final_dir)
}

fn write_files(bundle: &Bundle, staging: &Path) -> Result<(), BundleError> {
    std::fs::create_dir_all(staging)?;
    for file in &bundle.files {
        let target = file
            .path
            .split('/')
            .fold(staging.to_path_buf(), |dir, segment| dir.join(segment));
        check_path_safe(&target).map_err(|e| BundleError::Malformed(e.to_string()))?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&target, &file.bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let executable = bundle.manifest.runtime_kind == RuntimeKind::DesktopLocalProcess
                && file.path == bundle.manifest.entrypoint;
            let mode = if executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode))?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tempfile::TempDir;

    /// `main.mjs` of the plugin "A web plugin without the SDK", with its final newline.
    pub(crate) const HELLO_WEB_MAIN: &str = r#"const port = globalThis.rimPluginPort;
const ID = "dev.example.hello-web";
const send = (m) => port.postMessage(JSON.stringify({ jsonrpc: "2.0", ...m }));
let who = null;
port.onmessage = (event) => {
  let m;
  try { m = JSON.parse(event.data); } catch { return; }
  const p = m.params ?? {};
  switch (m.method) {
    case "rim.handshake": {
      const ok = p.supportedVersions?.includes(1) && p.pluginId === ID;
      who = p.principal;
      send({ id: m.id, result: { accepted: ok, protocolVersion: 1, pluginId: ID } });
      break;
    }
    case "rim.heartbeat":
      send({ id: m.id, result: {} });
      break;
    case "rim.principal.changed":
      who = p.principal;
      break;
    case "rim.command.execute":
      if (p.commandId === "greet") send({ id: m.id, result: { payload: `Hello, ${who?.displayName ?? "world"}!` } });
      else send({ id: m.id, error: { code: -32602, message: `unknown command: ${p.commandId}` } });
      break;
    default:
      if (m.id != null && m.method) send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  }
};
"#;

    pub(crate) const HELLO_WEB_MANIFEST: &str = r#"{"manifest_version":1,"plugin_id":"dev.example.hello-web","display_name":"Hello Web","version":"0.1.0","description":"Says hello from a sandboxed frame.","runtime_kind":"WebSandboxed","entrypoint":"main.mjs","commands":[{"id":"greet","title":"Hello Web: Greet","description":"Greets the signed-in user."}]}"#;

    pub(crate) const APPENDIX_A_SHA256: &str =
        "5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85";

    fn file(path: &str, text: &str) -> BundleFile {
        BundleFile {
            path: path.into(),
            bytes: text.as_bytes().to_vec(),
        }
    }

    fn hello_web() -> Vec<BundleFile> {
        vec![
            file("rim-plugin.json", HELLO_WEB_MANIFEST),
            file("main.mjs", HELLO_WEB_MAIN),
        ]
    }

    /// A bundle document with the given `files` JSON, for refusal tests.
    fn doc(files: &str) -> Vec<u8> {
        format!(r#"{{"format":"rim-plugin-bundle","v":1,"files":{files}}}"#).into_bytes()
    }

    fn manifest_entry() -> String {
        format!(
            r#"{{"path":"rim-plugin.json","text":{}}}"#,
            serde_json::to_string(HELLO_WEB_MANIFEST).unwrap()
        )
    }

    fn refusal(bytes: &[u8]) -> String {
        read_bundle(bytes).expect_err("must be refused").to_string()
    }

    #[test]
    fn appendix_a_byte_for_byte() {
        assert_eq!(HELLO_WEB_MAIN.len(), 1101);
        assert_eq!(HELLO_WEB_MANIFEST.len(), 306);
        let bytes = write_bundle(&hello_web());
        assert_eq!(bytes.len(), 1605);
        assert_eq!(bundle_sha256(&bytes), APPENDIX_A_SHA256);
        let expected = format!(
            r#"{{"format":"rim-plugin-bundle","v":1,"files":[{{"path":"main.mjs","text":{}}},{{"path":"rim-plugin.json","text":{}}}]}}"#,
            serde_json::to_string(HELLO_WEB_MAIN).unwrap(),
            serde_json::to_string(HELLO_WEB_MANIFEST).unwrap()
        );
        assert_eq!(String::from_utf8(bytes.clone()).unwrap(), expected);

        let bundle = read_bundle(&bytes).expect("appendix A reads");
        assert_eq!(bundle.manifest.plugin_id, "dev.example.hello-web");
        assert_eq!(bundle.manifest_text, HELLO_WEB_MANIFEST);
        assert_eq!(bundle.files[0].bytes, HELLO_WEB_MAIN.as_bytes());
    }

    #[test]
    fn binary_files_round_trip_as_base64() {
        let mut files = hello_web();
        files.push(BundleFile {
            path: "panels/main/icon.png".into(),
            bytes: vec![0x89, 0x50, 0xff, 0x00],
        });
        let bytes = write_bundle(&files);
        assert!(String::from_utf8_lossy(&bytes).contains(r#""base64":"iVD/AA==""#));
        let bundle = read_bundle(&bytes).unwrap();
        assert_eq!(bundle.files[1].bytes, vec![0x89, 0x50, 0xff, 0x00]);
    }

    #[test]
    fn refuses_unsorted_and_duplicate_paths() {
        let main = r#"{"path":"main.mjs","text":"x"}"#;
        let unsorted = doc(&format!("[{},{main}]", manifest_entry()));
        assert!(refusal(&unsorted).contains("sorted"));
        let duplicate = doc(&format!("[{main},{main},{}]", manifest_entry()));
        assert!(refusal(&duplicate).contains("sorted and unique"));
    }

    #[test]
    fn refuses_bad_paths() {
        for path in [
            "../main.mjs",
            "panels/./a.js",
            "panels/.hidden",
            "a//b",
            "/abs",
            "a b",
        ] {
            let files = format!(
                r#"[{{"path":"main.mjs","text":"x"}},{{"path":"{path}","text":"x"}},{}]"#,
                manifest_entry()
            );
            assert!(
                refusal(&doc(&files)).contains("not a valid bundle path"),
                "{path} must be refused"
            );
        }
    }

    #[test]
    fn refuses_both_or_neither_content_field() {
        let both = doc(&format!(
            r#"[{{"path":"main.mjs","text":"x","base64":"eA=="}},{}]"#,
            manifest_entry()
        ));
        assert!(refusal(&both).contains("exactly one"));
        let neither = doc(&format!(r#"[{{"path":"main.mjs"}},{}]"#, manifest_entry()));
        assert!(refusal(&neither).contains("exactly one"));
        let null = doc(&format!(
            r#"[{{"path":"main.mjs","text":null,"base64":"eA=="}},{}]"#,
            manifest_entry()
        ));
        assert!(refusal(&null).contains("not a plugin bundle"));
    }

    #[test]
    fn refuses_missing_manifest_or_entrypoint() {
        assert!(refusal(&doc(r#"[{"path":"main.mjs","text":"x"}]"#)).contains("missing"));
        let no_entry = doc(&format!("[{}]", manifest_entry()));
        assert!(refusal(&no_entry).contains("entrypoint `main.mjs` is missing"));
    }

    #[test]
    fn refuses_a_web_file_outside_panels() {
        let mut files = hello_web();
        files.push(file("notes.txt", "x"));
        assert!(refusal(&write_bundle(&files)).contains("outside panels/"));
        let mut files = hello_web();
        files.push(file("panels/main/index.html", "<p>hi</p>"));
        assert!(read_bundle(&write_bundle(&files)).is_ok());
    }

    #[test]
    fn refuses_a_web_entrypoint_with_a_hashbang() {
        let files = vec![
            file("rim-plugin.json", HELLO_WEB_MANIFEST),
            file("main.mjs", "#!/usr/bin/env node\n"),
        ];
        assert!(refusal(&write_bundle(&files)).contains("#!"));
    }

    #[test]
    fn refuses_one_byte_over_eight_mib() {
        let mut bytes = write_bundle(&hello_web());
        bytes.resize(MAX_BUNDLE_BYTES + 1, b' ');
        assert!(matches!(read_bundle(&bytes), Err(BundleError::TooLarge(_))));
        bytes.truncate(MAX_BUNDLE_BYTES);
        assert!(
            read_bundle(&bytes).is_ok(),
            "trailing whitespace is valid JSON"
        );
    }

    #[test]
    fn refuses_unknown_fields_and_wrong_format() {
        let extra_top = br#"{"format":"rim-plugin-bundle","v":1,"files":[],"signed":true}"#;
        assert!(refusal(extra_top).contains("unknown field"));
        let extra_file = doc(&format!(
            r#"[{{"path":"main.mjs","text":"x","mode":493}},{}]"#,
            manifest_entry()
        ));
        assert!(refusal(&extra_file).contains("unknown field"));
        assert!(refusal(br#"{"format":"zip","v":1,"files":[]}"#).contains("format"));
        assert!(refusal(br#"{"format":"rim-plugin-bundle","v":2,"files":[]}"#).contains("version"));
        assert!(refusal(&doc("[]")).contains("1 to 256"));
    }

    #[test]
    fn unpacks_through_staging_with_modes() {
        let root = TempDir::new().unwrap();
        let mut files = hello_web();
        files.push(file("panels/main/index.html", "<p>hi</p>"));
        let bundle = read_bundle(&write_bundle(&files)).unwrap();
        let dir = unpack(&bundle, root.path(), false).unwrap();
        assert_eq!(dir, root.path().join("dev.example.hello-web"));
        assert_eq!(
            std::fs::read_to_string(dir.join("panels/main/index.html")).unwrap(),
            "<p>hi</p>"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("main.mjs"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o644, "a web entrypoint is not executable");
        }
        assert!(
            unpack(&bundle, root.path(), false).is_err(),
            "no silent overwrite"
        );
        assert!(unpack(&bundle, root.path(), true).is_ok());
        let leftovers: Vec<_> = std::fs::read_dir(root.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(".staging"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_desktop_entrypoint_is_executable() {
        use std::os::unix::fs::PermissionsExt;
        let manifest = r#"{"manifest_version":1,"plugin_id":"dev.example.greeter","display_name":"Greeter","version":"0.1.0","description":"Says hello.","runtime_kind":"DesktopLocalProcess","entrypoint":"main.mjs"}"#;
        let files = vec![
            file("rim-plugin.json", manifest),
            file("main.mjs", "#!/usr/bin/env node\n"),
            file("lib/util.mjs", "export {}"),
        ];
        let bundle = read_bundle(&write_bundle(&files)).unwrap();
        let root = TempDir::new().unwrap();
        let dir = unpack(&bundle, root.path(), false).unwrap();
        let mode = |p: &str| std::fs::metadata(dir.join(p)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode("main.mjs"), 0o755);
        assert_eq!(mode("lib/util.mjs"), 0o644);
    }

    #[test]
    fn a_folder_is_checked_like_a_bundle() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("rim-plugin.json"), HELLO_WEB_MANIFEST).unwrap();
        std::fs::write(dir.path().join("main.mjs"), HELLO_WEB_MAIN).unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/HEAD"), "ref").unwrap();
        let bundle = check_dir(dir.path()).expect("dotfiles are skipped");
        assert_eq!(
            bundle_sha256(&write_bundle(&bundle.files)),
            APPENDIX_A_SHA256
        );
        std::fs::write(dir.path().join("README.md"), "x").unwrap();
        assert!(check_dir(dir.path()).is_err());
    }
}
