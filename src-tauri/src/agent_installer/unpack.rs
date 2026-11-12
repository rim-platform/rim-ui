//! Unpacking a downloaded archive into a fresh folder, refusing anything that would land outside
//! it: absolute paths, `..`, devices and pipes, and links that do not resolve inside it.

use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// Most bytes an archive may unpack to.
const MAX_UNPACKED: u64 = 4 * 1024 * 1024 * 1024;
/// Most entries an archive may hold.
const MAX_ENTRIES: usize = 200_000;

/// An archive format, chosen by the download URL's suffix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Zip,
    TarGz,
    TarBz2,
}

/// The format of the archive at `url`: `.zip`, `.tar.gz` or `.tgz`, or `.tar.bz2`.
pub(crate) fn format_of(url: &str) -> Option<Format> {
    let lower = url.to_ascii_lowercase();
    if lower.ends_with(".zip") {
        Some(Format::Zip)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Some(Format::TarGz)
    } else if lower.ends_with(".tar.bz2") {
        Some(Format::TarBz2)
    } else {
        None
    }
}

/// A link to make once every file is in place.
struct Link {
    /// Where the link goes, relative to the root.
    path: PathBuf,
    kind: LinkKind,
}

enum LinkKind {
    /// A symbolic link to this target, as the archive gives it.
    Symbolic(PathBuf),
    /// A hard link to this entry, relative to the root.
    Hard(PathBuf),
}

/// Unpacks the archive at `archive` in `format` into `dest`, an existing empty folder. Regular
/// files and folders are written first, then hard links, then symbolic links, each checked to
/// resolve inside `dest`. On Unix, files keep their permission bits.
///
/// # Errors
///
/// A sentence for the page when the archive cannot be read, holds an entry that is refused, or
/// unpacks to more than [`MAX_UNPACKED`] bytes or [`MAX_ENTRIES`] entries. Whatever was
/// written stays in `dest` for the caller to remove.
pub(crate) fn unpack(archive: &Path, format: Format, dest: &Path) -> Result<(), String> {
    let file =
        fs::File::open(archive).map_err(|error| format!("The download can't be read: {error}."))?;
    let reader = io::BufReader::new(file);
    let mut unpacker = Unpacker {
        root: dest.to_path_buf(),
        written: 0,
        entries: 0,
        links: Vec::new(),
    };
    match format {
        Format::Zip => unpacker.zip(reader)?,
        Format::TarGz => unpacker.tar(flate2::read::GzDecoder::new(reader))?,
        Format::TarBz2 => unpacker.tar(bzip2::read::BzDecoder::new(reader))?,
    }
    unpacker.finish_links()
}

/// The state of one unpack.
struct Unpacker {
    root: PathBuf,
    written: u64,
    entries: usize,
    links: Vec<Link>,
}

/// The refusal of an archive, with why.
fn refused(why: &str) -> String {
    format!("The download was refused: {why}.")
}

/// `path` as a relative path of plain parts, without `.` parts; `None` when it is absolute or
/// has a `..` part, and an empty path for the archive's root.
fn safe_relative(path: &Path) -> Option<PathBuf> {
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(name) => clean.push(name),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(clean)
}

/// `path` with `.` and `..` parts worked out without touching the disk; `None` when a `..`
/// goes above its start.
#[cfg(any(unix, test))]
fn lexical(path: &Path) -> Option<PathBuf> {
    let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
    for part in path.components() {
        match part {
            Component::Normal(name) => parts.push(name),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(parts.iter().collect())
}

/// Whether a folder on the way from `root` to `root/relative` is a symbolic link.
#[cfg(unix)]
fn through_link(root: &Path, relative: &Path) -> bool {
    let mut path = root.to_path_buf();
    relative.components().any(|part| {
        path.push(part);
        fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink())
    })
}

impl Unpacker {
    /// Counts one entry against [`MAX_ENTRIES`].
    fn count(&mut self) -> Result<(), String> {
        self.entries += 1;
        if self.entries > MAX_ENTRIES {
            return Err(refused("it holds too many files"));
        }
        Ok(())
    }

    /// The checked relative path of an entry named `name`; `None` for the archive's root.
    fn entry_path(name: &Path) -> Result<Option<PathBuf>, String> {
        let relative = safe_relative(name)
            .ok_or_else(|| refused("a file in it would land outside its folder"))?;
        Ok((!relative.as_os_str().is_empty()).then_some(relative))
    }

    fn make_dir(&self, relative: &Path) -> Result<(), String> {
        fs::create_dir_all(self.root.join(relative))
            .map_err(|error| format!("A folder could not be made: {error}."))
    }

    /// Writes one regular file from `content`, with `mode`'s permission bits on Unix.
    fn write_file(
        &mut self,
        relative: &Path,
        content: &mut dyn Read,
        mode: Option<u32>,
    ) -> Result<(), String> {
        let path = self.root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("A folder could not be made: {error}."))?;
        }
        let failed = |error: io::Error| format!("A file could not be written: {error}.");
        if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir()) {
            return Err(refused("two of its entries have the same path"));
        }
        let mut file = fs::File::create(&path).map_err(failed)?;
        let room = MAX_UNPACKED - self.written;
        let copied = io::copy(&mut content.take(room + 1), &mut file).map_err(failed)?;
        if copied > room {
            return Err(refused("it unpacks to too much"));
        }
        self.written += copied;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = mode.map_or(0o644, |mode| (mode & 0o777) | 0o600);
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).map_err(failed)?;
        }
        #[cfg(not(unix))]
        let _ = mode;
        Ok(())
    }

    fn tar(&mut self, reader: impl Read) -> Result<(), String> {
        let unreadable =
            |error: io::Error| format!("The download is not a readable archive: {error}.");
        let mut archive = tar::Archive::new(reader);
        for entry in archive.entries().map_err(unreadable)? {
            let mut entry = entry.map_err(unreadable)?;
            let kind = entry.header().entry_type();
            if matches!(
                kind,
                tar::EntryType::XGlobalHeader
                    | tar::EntryType::XHeader
                    | tar::EntryType::GNULongName
                    | tar::EntryType::GNULongLink
            ) {
                continue;
            }
            self.count()?;
            let name = entry.path().map_err(unreadable)?.into_owned();
            let Some(relative) = Self::entry_path(&name)? else {
                continue;
            };
            match kind {
                tar::EntryType::Directory => self.make_dir(&relative)?,
                tar::EntryType::Regular | tar::EntryType::Continuous => {
                    let mode = entry.header().mode().ok();
                    self.write_file(&relative, &mut entry, mode)?;
                }
                tar::EntryType::Symlink | tar::EntryType::Link => {
                    let target = entry
                        .link_name()
                        .map_err(unreadable)?
                        .ok_or_else(|| refused("a link in it has no target"))?
                        .into_owned();
                    let kind = if kind == tar::EntryType::Symlink {
                        LinkKind::Symbolic(target)
                    } else {
                        let target = Self::entry_path(&target)?
                            .ok_or_else(|| refused("a link in it has no target"))?;
                        LinkKind::Hard(target)
                    };
                    self.links.push(Link {
                        path: relative,
                        kind,
                    });
                }
                _ => return Err(refused("it holds a device, a pipe or another special file")),
            }
        }
        Ok(())
    }

    fn zip(&mut self, reader: impl Read + io::Seek) -> Result<(), String> {
        let unreadable = |error: zip::result::ZipError| {
            format!("The download is not a readable archive: {error}.")
        };
        let mut archive = zip::ZipArchive::new(reader).map_err(unreadable)?;
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(unreadable)?;
            self.count()?;
            let name = file.name().map_err(unreadable)?.replace('\\', "/");
            let Some(relative) = Self::entry_path(Path::new(&name))? else {
                continue;
            };
            if file.is_dir() {
                self.make_dir(&relative)?;
            } else if file.is_symlink() {
                let mut target = String::new();
                file.by_ref()
                    .take(4096)
                    .read_to_string(&mut target)
                    .map_err(|error| format!("The download is not a readable archive: {error}."))?;
                self.links.push(Link {
                    path: relative,
                    kind: LinkKind::Symbolic(PathBuf::from(target)),
                });
            } else if file.is_file() {
                let mode = file.unix_mode();
                self.write_file(&relative, &mut file, mode)?;
            } else {
                return Err(refused("it holds a special file"));
            }
        }
        Ok(())
    }

    /// Makes the hard links, then the symbolic links, and checks that every symbolic link
    /// resolves to something inside the root.
    fn finish_links(self) -> Result<(), String> {
        let outside = || refused("a link in it points outside its folder");
        let failed = |error: io::Error| format!("A link could not be made: {error}.");
        let links = self.links;
        for link in links.iter() {
            if let LinkKind::Hard(target) = &link.kind {
                let source = self.root.join(target);
                if !fs::symlink_metadata(&source).is_ok_and(|metadata| metadata.is_file()) {
                    return Err(outside());
                }
                let path = self.root.join(&link.path);
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(failed)?;
                }
                let _ = fs::remove_file(&path);
                fs::hard_link(&source, &path).map_err(failed)?;
            }
        }
        let symbolic: Vec<&Link> = links
            .iter()
            .filter(|link| matches!(link.kind, LinkKind::Symbolic(_)))
            .collect();
        if symbolic.is_empty() {
            return Ok(());
        }
        #[cfg(unix)]
        {
            for link in &symbolic {
                let LinkKind::Symbolic(target) = &link.kind else {
                    continue;
                };
                let parent = link.path.parent().unwrap_or(Path::new(""));
                if target.is_absolute()
                    || lexical(&parent.join(target)).is_none()
                    || through_link(&self.root, parent)
                {
                    return Err(outside());
                }
                let path = self.root.join(&link.path);
                if let Some(dir) = path.parent() {
                    fs::create_dir_all(dir).map_err(failed)?;
                }
                if fs::symlink_metadata(&path).is_ok() {
                    return Err(refused("two of its entries have the same path"));
                }
                std::os::unix::fs::symlink(target, &path).map_err(failed)?;
            }
            let root = fs::canonicalize(&self.root).map_err(failed)?;
            for link in &symbolic {
                let resolved =
                    fs::canonicalize(self.root.join(&link.path)).map_err(|_| outside())?;
                if !resolved.starts_with(&root) {
                    return Err(outside());
                }
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let first = symbolic.iter().find_map(|link| match &link.kind {
                LinkKind::Symbolic(target) => Some((&link.path, target)),
                LinkKind::Hard(_) => None,
            });
            let named = first.map_or_else(String::new, |(path, target)| {
                format!(" ({} to {})", path.display(), target.display())
            });
            Err(refused(&format!(
                "it holds links{named}, which RIM can't unpack on this computer"
            )))
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    /// One entry of a test archive.
    pub(crate) enum Item<'a> {
        File(&'a str, &'a [u8], u32),
        Dir(&'a str),
        Symlink(&'a str, &'a str),
        HardLink(&'a str, &'a str),
        Fifo(&'a str),
    }

    /// A tar archive of `items`, uncompressed. Names are written raw, so `..` and absolute
    /// names reach the archive as they are.
    pub(crate) fn tar_bytes(items: &[Item<'_>]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for item in items {
            let mut header = tar::Header::new_gnu();
            let (name, kind, data, mode, link): (&str, tar::EntryType, &[u8], u32, Option<&str>) =
                match item {
                    Item::File(name, data, mode) => {
                        (name, tar::EntryType::Regular, data, *mode, None)
                    }
                    Item::Dir(name) => (name, tar::EntryType::Directory, &[], 0o755, None),
                    Item::Symlink(name, target) => {
                        (name, tar::EntryType::Symlink, &[], 0o777, Some(target))
                    }
                    Item::HardLink(name, target) => {
                        (name, tar::EntryType::Link, &[], 0o644, Some(target))
                    }
                    Item::Fifo(name) => (name, tar::EntryType::Fifo, &[], 0o644, None),
                };
            let raw = header.as_old_mut();
            raw.name[..name.len()].copy_from_slice(name.as_bytes());
            if let Some(link) = link {
                raw.linkname[..link.len()].copy_from_slice(link.as_bytes());
            }
            header.set_entry_type(kind);
            header.set_mode(mode);
            header.set_size(data.len() as u64);
            header.set_cksum();
            builder.append(&header, data).unwrap();
        }
        builder.into_inner().unwrap()
    }

    /// `tar_bytes` compressed with gzip.
    pub(crate) fn tar_gz(items: &[Item<'_>]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&tar_bytes(items)).unwrap();
        encoder.finish().unwrap()
    }

    /// `tar_bytes` compressed with bzip2.
    pub(crate) fn tar_bz2(items: &[Item<'_>]) -> Vec<u8> {
        let mut encoder = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast());
        encoder.write_all(&tar_bytes(items)).unwrap();
        encoder.finish().unwrap()
    }

    /// A zip archive of the files, folders and symbolic links among `items`.
    pub(crate) fn zip_bytes(items: &[Item<'_>]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(io::Cursor::new(Vec::new()));
        for item in items {
            match item {
                Item::File(name, data, mode) => {
                    let options = zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated)
                        .unix_permissions(*mode);
                    writer.start_file(*name, options).unwrap();
                    writer.write_all(data).unwrap();
                }
                Item::Dir(name) => {
                    writer
                        .add_directory(*name, zip::write::SimpleFileOptions::default())
                        .unwrap();
                }
                Item::Symlink(name, target) => {
                    writer
                        .add_symlink(*name, *target, zip::write::SimpleFileOptions::default())
                        .unwrap();
                }
                Item::HardLink(..) | Item::Fifo(_) => panic!("not in a zip"),
            }
        }
        writer.finish().unwrap().into_inner()
    }

    fn unpack_bytes(bytes: &[u8], format: Format) -> (TempDir, Result<(), String>) {
        let dir = TempDir::new().unwrap();
        let archive = dir.path().join("archive");
        fs::write(&archive, bytes).unwrap();
        let dest = dir.path().join("out");
        fs::create_dir(&dest).unwrap();
        let result = unpack(&archive, format, &dest);
        (dir, result)
    }

    #[test]
    fn formats_come_from_the_suffix() {
        assert_eq!(format_of("https://x/a.zip"), Some(Format::Zip));
        assert_eq!(format_of("https://x/a.tar.gz"), Some(Format::TarGz));
        assert_eq!(format_of("https://x/a.TGZ"), Some(Format::TarGz));
        assert_eq!(format_of("https://x/a.tar.bz2"), Some(Format::TarBz2));
        assert_eq!(format_of("https://x/a.tar.xz"), None);
        assert_eq!(format_of("https://x/a.exe"), None);
    }

    fn sample() -> Vec<Item<'static>> {
        vec![
            Item::Dir("./"),
            Item::Dir("./pkg/"),
            Item::File("./pkg/tool", b"#!/bin/sh\necho hi\n", 0o755),
            Item::File("./pkg/readme.txt", b"hello", 0o644),
        ]
    }

    fn check_sample(dir: &TempDir) {
        let out = dir.path().join("out");
        assert_eq!(fs::read(out.join("pkg/readme.txt")).unwrap(), b"hello");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(out.join("pkg/tool"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o755);
        }
    }

    #[test]
    fn each_format_unpacks() {
        for (bytes, format) in [
            (tar_gz(&sample()), Format::TarGz),
            (tar_bz2(&sample()), Format::TarBz2),
            (zip_bytes(&sample()[1..]), Format::Zip),
        ] {
            let (dir, result) = unpack_bytes(&bytes, format);
            result.unwrap();
            check_sample(&dir);
        }
    }

    #[test]
    fn entries_outside_the_folder_are_refused() {
        for items in [
            vec![Item::File("../evil", b"x", 0o644)],
            vec![Item::File("a/../../evil", b"x", 0o644)],
            vec![Item::File("/tmp/rim-evil", b"x", 0o644)],
            vec![Item::Symlink("link", "../../etc")],
            vec![Item::Symlink("link", "/etc/passwd")],
            vec![Item::Fifo("pipe")],
            vec![Item::HardLink("hard", "../outside")],
            vec![Item::HardLink("hard", "missing")],
        ] {
            let (dir, result) = unpack_bytes(&tar_gz(&items), Format::TarGz);
            let error = result.unwrap_err();
            assert!(error.starts_with("The download was refused"), "{error}");
            assert!(!dir.path().join("evil").exists());
        }
        assert!(!Path::new("/tmp/rim-evil").exists());
    }

    #[cfg(unix)]
    #[test]
    fn links_inside_the_folder_are_kept() {
        let items = vec![
            Item::Dir("node/"),
            Item::Dir("node/bin/"),
            Item::Dir("node/lib/npm/bin/"),
            Item::File("node/lib/npm/bin/npm-cli.js", b"js", 0o755),
            Item::Symlink("node/bin/npm", "../lib/npm/bin/npm-cli.js"),
            Item::HardLink("node/bin/copy", "node/lib/npm/bin/npm-cli.js"),
        ];
        let (dir, result) = unpack_bytes(&tar_gz(&items), Format::TarGz);
        result.unwrap();
        let out = dir.path().join("out");
        assert_eq!(fs::read(out.join("node/bin/npm")).unwrap(), b"js");
        assert_eq!(fs::read(out.join("node/bin/copy")).unwrap(), b"js");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_escapes_through_another_link_is_refused() {
        let items = vec![
            Item::Dir("a/"),
            Item::Symlink("up", "."),
            Item::Symlink("up/escape", ".."),
        ];
        let (_dir, result) = unpack_bytes(&tar_gz(&items), Format::TarGz);
        assert!(result.unwrap_err().contains("outside"));

        let items = vec![Item::Symlink("dangling", "nothing-here")];
        let (_dir, result) = unpack_bytes(&tar_gz(&items), Format::TarGz);
        assert!(result.unwrap_err().contains("outside"));
    }

    #[cfg(unix)]
    #[test]
    fn a_zip_link_outside_is_refused() {
        let items = vec![Item::Symlink("link", "../../etc")];
        let (_dir, result) = unpack_bytes(&zip_bytes(&items), Format::Zip);
        assert!(result.unwrap_err().contains("outside"));
    }

    #[test]
    fn a_broken_archive_is_refused() {
        let (_dir, result) = unpack_bytes(b"not an archive", Format::Zip);
        assert!(result.unwrap_err().contains("not a readable archive"));
        let (_dir, result) = unpack_bytes(b"not an archive", Format::TarGz);
        assert!(result.is_err());
    }

    #[test]
    fn lexical_paths_stay_under_their_start() {
        assert_eq!(lexical(Path::new("a/../b")), Some(PathBuf::from("b")));
        assert_eq!(lexical(Path::new("a/../../b")), None);
        assert_eq!(
            safe_relative(Path::new("./a/./b")),
            Some(PathBuf::from("a/b"))
        );
        assert_eq!(safe_relative(Path::new("a/../b")), None);
    }
}
