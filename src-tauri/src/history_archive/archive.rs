//! An archive in a provider: creating, unlocking and opening it, appending a device's
//! segments, and reading every device's segments back.

use sha2::{Digest, Sha256};

use super::crypto::{ArchiveKey, KdfCost, MIN_PASSPHRASE_CHARS};
use super::format::{
    self, check_id, devices_dir, file_path, segment_name, DeviceHead, Event, FileKind, FilePlace,
    Manifest, SegmentEntry, SegmentHeader, FORMAT_VERSION, HEAD_NAME, MANIFEST_PATH,
    MAX_SEGMENT_BYTES,
};
use super::provider::ArchiveProvider;
use super::ArchiveError;

pub(crate) struct Archive {
    provider: Box<dyn ArchiveProvider>,
    archive_id: String,
    key: ArchiveKey,
}

impl Archive {
    /// The folder's manifest, or `None` when the folder holds no archive.
    pub(crate) fn inspect(
        provider: &dyn ArchiveProvider,
    ) -> Result<Option<Manifest>, ArchiveError> {
        provider
            .read(MANIFEST_PATH)?
            .map(|bytes| Manifest::parse(&bytes))
            .transpose()
    }

    /// Start a new archive in an empty folder, its key wrapped under `passphrase`.
    pub(crate) fn create(
        provider: Box<dyn ArchiveProvider>,
        passphrase: &str,
        cost: KdfCost,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Self, ArchiveError> {
        if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
            return Err(ArchiveError::Invalid(format!(
                "the passphrase needs at least {MIN_PASSPHRASE_CHARS} characters"
            )));
        }
        let archive_id = uuid::Uuid::new_v4().to_string();
        let key = ArchiveKey::generate()?;
        let manifest = Manifest::new(&archive_id, &key, passphrase, cost, now.to_rfc3339())?;
        let bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| ArchiveError::Format(e.to_string()))?;
        if !provider.create(MANIFEST_PATH, &bytes)? {
            return Err(ArchiveError::Exists);
        }
        Ok(Self {
            provider,
            archive_id,
            key,
        })
    }

    /// Open the folder's archive with its passphrase.
    pub(crate) fn unlock(
        provider: Box<dyn ArchiveProvider>,
        passphrase: &str,
    ) -> Result<Self, ArchiveError> {
        let manifest = Self::inspect(provider.as_ref())?.ok_or(ArchiveError::NoArchive)?;
        let key = manifest.unwrap_key(passphrase)?;
        Ok(Self {
            provider,
            archive_id: manifest.archive_id,
            key,
        })
    }

    /// Open with a key this device kept, after checking the folder still holds that archive
    /// (an unmounted drive, or another archive swapped in, must not get this device's writes).
    pub(crate) fn open(
        provider: Box<dyn ArchiveProvider>,
        archive_id: &str,
        key: ArchiveKey,
    ) -> Result<Self, ArchiveError> {
        let manifest = Self::inspect(provider.as_ref())?.ok_or_else(|| {
            ArchiveError::Unavailable(format!("no archive in {}", provider.describe()))
        })?;
        if manifest.archive_id != archive_id {
            return Err(ArchiveError::Mismatch);
        }
        Ok(Self {
            provider,
            archive_id: archive_id.to_string(),
            key,
        })
    }

    pub(crate) fn id(&self) -> &str {
        &self.archive_id
    }

    pub(crate) fn key(&self) -> &ArchiveKey {
        &self.key
    }

    pub(crate) fn provider(&self) -> &dyn ArchiveProvider {
        self.provider.as_ref()
    }

    /// One account's part of the archive. `account_label` is the cache's account label.
    pub(crate) fn account(&self, account_label: &str) -> AccountArchive<'_> {
        AccountArchive {
            archive: self,
            tag: self.key.account_tag(account_label),
        }
    }
}

/// A segment as read back.
#[derive(Debug, Clone)]
pub(crate) struct ReadSegment {
    pub device_id: String,
    pub created_at_ms: i64,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SegmentRef {
    pub device_id: String,
    pub seq: u64,
}

/// Everything readable in an account's part of the archive, and what was not.
#[derive(Debug, Default)]
pub(crate) struct ArchiveContents {
    pub segments: Vec<ReadSegment>,
    /// Listed in a head but not in the folder: usually a sync client still downloading it.
    pub missing: Vec<SegmentRef>,
    /// In the folder but failing its hash, decryption or parse.
    pub damaged: Vec<SegmentRef>,
    /// Devices whose head could not be opened.
    pub damaged_heads: Vec<String>,
    pub devices: usize,
}

pub(crate) struct AccountArchive<'a> {
    archive: &'a Archive,
    tag: String,
}

impl AccountArchive<'_> {
    fn place<'p>(&'p self, device_id: &'p str, name: &'p str) -> FilePlace<'p> {
        FilePlace {
            archive_id: &self.archive.archive_id,
            account_tag: &self.tag,
            device_id,
            name,
        }
    }

    fn provider(&self) -> &dyn ArchiveProvider {
        self.archive.provider.as_ref()
    }

    /// A device's head, or `None` before its first export (or before it synced here).
    pub(crate) fn read_head(&self, device_id: &str) -> Result<Option<DeviceHead>, ArchiveError> {
        let path = file_path(&self.tag, device_id, HEAD_NAME);
        let Some(bytes) = self.provider().read(&path)? else {
            return Ok(None);
        };
        let plaintext = format::open_file(
            &self.archive.key,
            FileKind::Head,
            &self.place(device_id, HEAD_NAME),
            &bytes,
        )?;
        let head: DeviceHead = serde_json::from_slice(&plaintext)
            .map_err(|e| ArchiveError::Format(format!("device head: {e}")))?;
        if head.archive_id != self.archive.archive_id || head.device_id != device_id {
            return Err(ArchiveError::Format(
                "device head names another place".into(),
            ));
        }
        Ok(Some(head))
    }

    /// Append `events` as new segments of `device_id`, then list them in its head. Segments
    /// are written before the head, so a reader never finds a listed segment that this
    /// device has not finished writing (a sync client may still deliver them out of order).
    /// Returns the number of segments written.
    pub(crate) fn append(
        &self,
        device_id: &str,
        events: &[Event],
        now_ms: i64,
    ) -> Result<usize, ArchiveError> {
        self.append_limited(device_id, events, now_ms, MAX_SEGMENT_BYTES)
    }

    pub(crate) fn append_limited(
        &self,
        device_id: &str,
        events: &[Event],
        now_ms: i64,
        max_segment_bytes: usize,
    ) -> Result<usize, ArchiveError> {
        if events.is_empty() {
            return Ok(0);
        }
        check_id(device_id)?;
        let mut head = self.read_head(device_id)?.unwrap_or_else(|| DeviceHead {
            v: FORMAT_VERSION,
            archive_id: self.archive.archive_id.clone(),
            device_id: device_id.to_string(),
            ..DeviceHead::default()
        });

        let mut lines = Vec::with_capacity(events.len());
        for event in events {
            lines.push(format::event_line(event)?);
        }
        let mut written = 0;
        let mut start = 0;
        while start < lines.len() {
            // At least one event per segment, then as many as fit.
            let mut end = start + 1;
            let mut size = lines[start].len() + 1;
            while end < lines.len() && size + lines[end].len() < max_segment_bytes {
                size += lines[end].len() + 1;
                end += 1;
            }
            let seq = head.next_seq();
            let header = SegmentHeader {
                v: FORMAT_VERSION,
                archive_id: self.archive.archive_id.clone(),
                device_id: device_id.to_string(),
                seq,
                created_at_ms: now_ms,
            };
            let mut plaintext = zeroize::Zeroizing::new(format::header_line(&header)?);
            for line in &lines[start..end] {
                plaintext.push('\n');
                plaintext.push_str(line);
            }
            plaintext.push('\n');

            let name = segment_name(seq);
            let sealed = format::seal_file(
                &self.archive.key,
                FileKind::Segment,
                &self.place(device_id, &name),
                plaintext.as_bytes(),
            )?;
            self.provider()
                .write(&file_path(&self.tag, device_id, &name), &sealed)?;
            head.segments.push(SegmentEntry {
                seq,
                sha256: hex::encode(Sha256::digest(&sealed)),
                events: (end - start) as u32,
                created_at_ms: now_ms,
            });
            written += 1;
            start = end;
        }

        head.updated_at_ms = now_ms;
        let head_json = zeroize::Zeroizing::new(
            serde_json::to_vec(&head).map_err(|e| ArchiveError::Format(e.to_string()))?,
        );
        let sealed = format::seal_file(
            &self.archive.key,
            FileKind::Head,
            &self.place(device_id, HEAD_NAME),
            &head_json,
        )?;
        self.provider()
            .write(&file_path(&self.tag, device_id, HEAD_NAME), &sealed)?;
        Ok(written)
    }

    /// Every device's segments that can be read, in each device's order. What cannot be read
    /// is reported rather than failing the whole read.
    pub(crate) fn read_all(&self) -> Result<ArchiveContents, ArchiveError> {
        let mut contents = ArchiveContents::default();
        for device_id in self.provider().list_dirs(&devices_dir(&self.tag))? {
            if check_id(&device_id).is_err() {
                continue;
            }
            let head = match self.read_head(&device_id) {
                Ok(Some(head)) => head,
                // The folder exists but its head has not arrived yet.
                Ok(None) => continue,
                Err(e) => {
                    log::warn!("[history_archive] unreadable device head: {e}");
                    contents.damaged_heads.push(device_id);
                    continue;
                }
            };
            contents.devices += 1;
            for entry in &head.segments {
                let reference = SegmentRef {
                    device_id: device_id.clone(),
                    seq: entry.seq,
                };
                match self.read_segment(&device_id, entry) {
                    Ok(Some(segment)) => contents.segments.push(segment),
                    Ok(None) => contents.missing.push(reference),
                    Err(e) => {
                        log::warn!("[history_archive] unreadable segment: {e}");
                        contents.damaged.push(reference);
                    }
                }
            }
        }
        Ok(contents)
    }

    fn read_segment(
        &self,
        device_id: &str,
        entry: &SegmentEntry,
    ) -> Result<Option<ReadSegment>, ArchiveError> {
        let name = segment_name(entry.seq);
        let Some(bytes) = self
            .provider()
            .read(&file_path(&self.tag, device_id, &name))?
        else {
            return Ok(None);
        };
        if hex::encode(Sha256::digest(&bytes)) != entry.sha256 {
            return Err(ArchiveError::Format(
                "segment does not match its head's hash".into(),
            ));
        }
        let plaintext = format::open_file(
            &self.archive.key,
            FileKind::Segment,
            &self.place(device_id, &name),
            &bytes,
        )?;
        let (header, events) = format::parse_segment(&plaintext)?;
        if header.archive_id != self.archive.archive_id
            || header.device_id != device_id
            || header.seq != entry.seq
        {
            return Err(ArchiveError::Format(
                "segment header names another place".into(),
            ));
        }
        Ok(Some(ReadSegment {
            device_id: device_id.to_string(),
            created_at_ms: header.created_at_ms,
            events,
        }))
    }
}
