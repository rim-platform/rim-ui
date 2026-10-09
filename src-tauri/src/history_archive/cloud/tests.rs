//! The Google Drive and Dropbox providers against the fake services in [`super::fake`]:
//! sign-in, upload, list, download, token refresh, rate limits, an interrupted backup, and a
//! restore on a second device.

use std::sync::Arc;

use serde_json::json;

use super::super::archive::Archive;
use super::super::format::Event;
use super::super::provider::ArchiveProvider;
use super::super::tests::{message, Device, PASSPHRASE, TEST_COST};
use super::super::{ArchiveError, ConnectTarget};
use super::fake::{approve, deny, FakeCloud};
use super::{CloudConnections, CloudKind};
use crate::message_cache::tests::{account, MockFeed};

const KINDS: [CloudKind; 2] = [CloudKind::GoogleDrive, CloudKind::Dropbox];
const DEVICE: &str = "0f0e0d0c-aaaa-4bbb-8ccc-123456789abc";
const LABEL: &str = "http://localhost:8080/api\nalice";

/// Sign in to `kind` on the fake and return the pending connection's provider.
fn sign_in(connections: &CloudConnections, kind: CloudKind) -> (String, Box<dyn ArchiveProvider>) {
    let auth = connections
        .authorize(kind, approve, |p| {
            Ok(Archive::inspect(p)?.map(|m| m.version))
        })
        .unwrap();
    assert_eq!(auth.kind, kind);
    assert_eq!(auth.account, "ada@example.com");
    let (_, _, provider) = connections.pending_provider(&auth.connection_id).unwrap();
    (auth.connection_id, provider)
}

/// How many provider revokes `n` sign-outs make: Dropbox revokes, Google does not.
fn expected_revokes(kind: CloudKind, n: usize) -> usize {
    match kind {
        CloudKind::GoogleDrive => 0,
        CloudKind::Dropbox => n,
    }
}

fn events(conversation: &str, from: i64, to: i64) -> Vec<Event> {
    (from..=to)
        .map(|v| {
            Event::Message(message(
                conversation,
                &format!("m{v}"),
                v,
                &format!("text {v}"),
            ))
        })
        .collect()
}

#[test]
fn sign_in_uses_pkce_and_keeps_nothing_until_connected() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (connections, credentials) = cloud.connections();
        assert!(connections.services().iter().all(|s| s.available));
        let auth = connections.authorize(kind, approve, |_| Ok(None)).unwrap();
        assert!(!auth.has_archive);

        let exchange = cloud.state().exchanges[0].clone();
        assert!(exchange["redirect_uri"].starts_with(match kind {
            CloudKind::GoogleDrive => "http://127.0.0.1:",
            CloudKind::Dropbox => "http://localhost:",
        }));
        assert_eq!(exchange["code_verifier"].len(), 43);
        let secret = exchange.get("client_secret").map(String::as_str);
        match kind {
            CloudKind::GoogleDrive => assert_eq!(secret, Some("google-not-secret")),
            CloudKind::Dropbox => assert_eq!(secret, None),
        }
        // The write check left nothing behind, and nothing is in the keyring yet.
        assert!(cloud.state().drive.is_empty() && cloud.state().dropbox.is_empty());
        assert!(credentials.0.lock().unwrap().is_empty());

        // A discarded Dropbox sign-in is revoked. A Google one is only dropped: Google
        // revokes per account, which would sign out the user's other devices too.
        connections.discard(&auth.connection_id);
        assert_eq!(cloud.state().revoked, expected_revokes(kind, 1));
        assert!(!cloud.state().refresh_revoked);
        assert!(matches!(
            connections.pending_provider(&auth.connection_id),
            Err(ArchiveError::CloudAuth(_))
        ));

        // The user refusing in the browser ends the sign-in.
        assert!(matches!(
            connections.authorize(kind, deny, |_| Ok(None)),
            Err(ArchiveError::Cancelled)
        ));
    }
}

#[test]
fn a_build_without_a_client_id_offers_no_cloud() {
    let cloud = FakeCloud::start();
    let mut settings = cloud.settings();
    settings.dropbox.client_id = None;
    let connections = CloudConnections::new(
        settings,
        Arc::new(super::fake::MemoryCredentials::default()),
    );
    let services = connections.services();
    assert!(services[0].available && !services[1].available);
    assert!(matches!(
        connections.authorize(CloudKind::Dropbox, approve, |_| Ok(None)),
        Err(ArchiveError::ServiceNotConfigured(_))
    ));
}

#[test]
fn upload_list_download_and_overwrite() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = sign_in(&connections, kind);

        assert_eq!(provider.read("rim-archive.json").unwrap(), None);
        assert!(provider.create("rim-archive.json", b"manifest").unwrap());
        assert!(!provider.create("rim-archive.json", b"another").unwrap());
        assert_eq!(
            provider.read("rim-archive.json").unwrap().unwrap(),
            b"manifest"
        );

        provider
            .write("accounts/t1/devices/d1/head.rimx", b"one")
            .unwrap();
        provider
            .write("accounts/t1/devices/d1/head.rimx", b"two")
            .unwrap();
        provider
            .write("accounts/t1/devices/d1/seg-0000000001.rimx", b"s")
            .unwrap();
        provider
            .write("accounts/t1/devices/d2/head.rimx", b"h")
            .unwrap();
        assert_eq!(
            provider
                .read("accounts/t1/devices/d1/head.rimx")
                .unwrap()
                .unwrap(),
            b"two"
        );
        assert_eq!(
            provider.list_dirs("accounts/t1/devices").unwrap(),
            vec!["d1", "d2"]
        );
        assert_eq!(provider.list_dirs("accounts").unwrap(), vec!["t1"]);
        assert!(provider.list_dirs("accounts/none").unwrap().is_empty());
        assert!(provider.read("../escape").is_err());
        assert!(provider.describe().contains("ada@example.com"));

        let state = cloud.state();
        match kind {
            CloudKind::GoogleDrive => {
                // One file per name, all in appDataFolder; the overwrite replaced in place.
                assert_eq!(
                    state.drive_names(),
                    vec![
                        "accounts/t1/devices/d1/head.rimx",
                        "accounts/t1/devices/d1/seg-0000000001.rimx",
                        "accounts/t1/devices/d2/head.rimx",
                        "rim-archive.json",
                    ]
                );
                assert!(state.drive.iter().all(|f| f.parents == ["appDataFolder"]));
            }
            CloudKind::Dropbox => {
                let paths: Vec<_> = state.dropbox.keys().cloned().collect();
                assert_eq!(
                    paths,
                    vec![
                        "/accounts/t1/devices/d1/head.rimx",
                        "/accounts/t1/devices/d1/seg-0000000001.rimx",
                        "/accounts/t1/devices/d2/head.rimx",
                        "/rim-archive.json",
                    ]
                );
            }
        }
    }
}

#[test]
fn listings_follow_every_page() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = sign_in(&connections, kind);
        for i in 0..7 {
            provider
                .write(&format!("accounts/t/devices/d{i}/head.rimx"), b"h")
                .unwrap();
        }
        cloud.state().page_size = 2;
        let dirs = provider.list_dirs("accounts/t/devices").unwrap();
        assert_eq!(dirs, (0..7).map(|i| format!("d{i}")).collect::<Vec<_>>());
    }
}

#[test]
fn two_devices_creating_a_drive_archive_at_once_agree_on_the_older() {
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let (_, provider) = sign_in(&connections, CloudKind::GoogleDrive);
    cloud.state().drive_race = Some("rim-archive.json".into());
    // The other device's file is older: this device withdraws its own and joins.
    assert!(!provider.create("rim-archive.json", b"mine").unwrap());
    assert_eq!(cloud.state().drive_names(), vec!["rim-archive.json"]);
    assert_eq!(
        provider.read("rim-archive.json").unwrap().unwrap(),
        b"the other device's"
    );
}

#[test]
fn an_expired_access_token_is_refreshed_and_a_revoked_one_asks_to_sign_in() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = sign_in(&connections, kind);
        provider
            .write("accounts/t/devices/d/head.rimx", b"h")
            .unwrap();
        assert_eq!(cloud.state().refreshes, 0);

        // The service stops taking the token before it said it would expire.
        cloud.state().access_token = "access-new".into();
        assert_eq!(
            provider
                .read("accounts/t/devices/d/head.rimx")
                .unwrap()
                .unwrap(),
            b"h"
        );
        assert_eq!(cloud.state().refreshes, 1);

        // The user revoked RIM's access: refreshing fails as a sign-in error.
        {
            let mut state = cloud.state();
            state.refresh_revoked = true;
            state.access_token = "access-unknown".into();
        }
        assert!(matches!(
            provider.read("accounts/t/devices/d/head.rimx"),
            Err(ArchiveError::CloudAuth(_))
        ));
    }
}

#[test]
fn a_rotated_refresh_token_is_saved() {
    let cloud = FakeCloud::start();
    let (connections, credentials) = cloud.connections();
    let (id, _) = sign_in(&connections, CloudKind::Dropbox);
    connections.keep(&id).unwrap();
    let name = format!("history-archive-cloud-v1:{id}");
    assert_eq!(credentials.0.lock().unwrap()[&name], "refresh-0");

    {
        let mut state = cloud.state();
        state.rotate_refresh_tokens = true;
        state.access_token = "access-expired".into();
    }
    let connection = super::CloudConnection {
        connection_id: id,
        account: "ada@example.com".into(),
    };
    let provider = connections.open(CloudKind::Dropbox, &connection).unwrap();
    assert_eq!(provider.read("nothing-here").unwrap(), None);
    assert_eq!(credentials.0.lock().unwrap()[&name], "refresh-1");
}

#[test]
fn rate_limits_and_server_errors_are_retried_with_backoff() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = sign_in(&connections, kind);
        let (upload, download) = match kind {
            CloudKind::GoogleDrive => ("POST /upload/drive/v3/files", "GET /drive/v3/files"),
            CloudKind::Dropbox => ("files/upload", "files/download"),
        };
        cloud.fault(
            upload,
            429,
            Some(1),
            json!({ "error": "too_many_requests" }),
            2,
        );
        cloud.fault(download, 503, None, json!({}), 1);
        if kind == CloudKind::GoogleDrive {
            cloud.fault(
                upload,
                403,
                None,
                json!({ "error": { "errors": [{ "reason": "userRateLimitExceeded" }] } }),
                1,
            );
        }
        let before = cloud.state().count(upload);
        provider
            .write("accounts/t/devices/d/head.rimx", b"h")
            .unwrap();
        let retries = if kind == CloudKind::GoogleDrive { 3 } else { 2 };
        assert_eq!(cloud.state().count(upload) - before, retries + 1);
        assert_eq!(
            provider
                .read("accounts/t/devices/d/head.rimx")
                .unwrap()
                .unwrap(),
            b"h"
        );

        // A service that stays busy is reported as unavailable, after the last attempt.
        cloud.fault(download, 429, Some(1), json!({}), 100);
        let before = cloud.state().count(download);
        let busy = provider.read("accounts/t/devices/d/head.rimx");
        assert!(
            matches!(busy, Err(ArchiveError::Unavailable(_))),
            "{busy:?}"
        );
        assert_eq!(cloud.state().count(download) - before, 4);
    }
}

#[test]
fn a_full_drive_is_not_writable() {
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let (_, provider) = sign_in(&connections, CloudKind::GoogleDrive);
    cloud.fault(
        "POST /upload",
        403,
        None,
        json!({ "error": { "errors": [{ "reason": "storageQuotaExceeded" }] } }),
        1,
    );
    assert!(matches!(
        provider.check_writable(),
        Err(ArchiveError::NotWritable(_))
    ));

    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let (_, provider) = sign_in(&connections, CloudKind::Dropbox);
    cloud.fault(
        "files/upload",
        409,
        None,
        json!({ "error_summary": "path/insufficient_space/.." }),
        1,
    );
    assert!(matches!(
        provider.check_writable(),
        Err(ArchiveError::NotWritable(_))
    ));
}

#[test]
fn an_interrupted_backup_resumes_from_the_head() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (id, provider) = sign_in(&connections, kind);
        let archive = Archive::create(provider, PASSPHRASE, TEST_COST, chrono::Utc::now()).unwrap();
        archive
            .account(LABEL)
            .append(DEVICE, &events("c1", 1, 3), 1_000)
            .unwrap();

        // The connection drops after the new segment is uploaded, before the head lists it.
        let head_write = match kind {
            CloudKind::GoogleDrive => "PATCH /upload/drive/v3/files",
            CloudKind::Dropbox => "head.rimx",
        };
        cloud.fault(head_write, 500, None, json!({}), 100);
        let failed = archive
            .account(LABEL)
            .append(DEVICE, &events("c1", 4, 6), 2_000);
        assert!(
            matches!(failed, Err(ArchiveError::Unavailable(_))),
            "{failed:?}"
        );
        cloud.state().faults.clear();

        // Readers see only what the head commits to.
        let reader =
            Archive::unlock(connections.pending_provider(&id).unwrap().2, PASSPHRASE).unwrap();
        let contents = reader.account(LABEL).read_all().unwrap();
        assert_eq!(contents.segments.len(), 1);
        assert!(contents.missing.is_empty() && contents.damaged.is_empty());

        // The next export, in a fresh session, writes the batch again over the orphan.
        let resumed = Archive::open(
            connections.pending_provider(&id).unwrap().2,
            archive.id(),
            super::super::crypto::ArchiveKey::from_bytes(*archive.key().as_bytes()),
        )
        .unwrap();
        resumed
            .account(LABEL)
            .append(DEVICE, &events("c1", 4, 6), 3_000)
            .unwrap();
        let contents = reader.account(LABEL).read_all().unwrap();
        assert_eq!(contents.segments.len(), 2);
        assert!(contents.missing.is_empty() && contents.damaged.is_empty());
        let all: Vec<Event> = contents
            .segments
            .into_iter()
            .flat_map(|s| s.events)
            .collect();
        assert_eq!(all, events("c1", 1, 6));

        if kind == CloudKind::GoogleDrive {
            // The orphan was overwritten, not joined by a second file of its name.
            let names = cloud.state().drive_names();
            let mut unique = names.clone();
            unique.dedup();
            assert_eq!(names, unique);
            assert_eq!(names.len(), 4, "{names:?}");
        }
    }
}

#[test]
fn a_new_device_restores_from_the_cloud_and_disconnecting_signs_out() {
    for kind in KINDS {
        let cloud = FakeCloud::start();
        let (laptop_cloud, laptop_credentials) = cloud.connections();
        let laptop = Device::with_cloud("alice", laptop_cloud);
        let auth = laptop.archive.cloud_authorize(kind, approve).unwrap();
        assert!(!auth.has_archive);
        let target = ConnectTarget::Cloud {
            connection_id: auth.connection_id.clone(),
        };
        let outcome = laptop
            .archive
            .connect(&account("alice"), &target, PASSPHRASE)
            .unwrap();
        assert!(outcome.created);
        let status = outcome.status;
        let expected_kind = match kind {
            CloudKind::GoogleDrive => "googleDrive",
            CloudKind::Dropbox => "dropbox",
        };
        assert_eq!(status.provider, Some(expected_kind));
        assert_eq!(status.folder.as_deref(), Some("ada@example.com"));
        assert!(status.unlocked);

        // The refresh token is in the keyring, not in the settings file.
        assert_eq!(laptop_credentials.0.lock().unwrap().len(), 1);
        let settings_dir = laptop._data.path().join("history-archive");
        for entry in std::fs::read_dir(&settings_dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            assert!(
                !text.contains("refresh-0") && !text.contains("access-"),
                "{text}"
            );
        }

        let mut feed = MockFeed::new(1000);
        feed.send_many("c1", 12);
        laptop.track("c1");
        laptop.sync(&mut feed);
        assert_eq!(laptop.export().messages, 12);
        let expected = laptop.timeline("c1").unwrap();

        // A second device signs in to the same account and finds the archive.
        let (phone_cloud, phone_credentials) = cloud.connections();
        let phone = Device::with_cloud("alice", phone_cloud);
        let auth = phone.archive.cloud_authorize(kind, approve).unwrap();
        assert!(auth.has_archive);
        assert_eq!(auth.version, Some(1));
        let target = ConnectTarget::Cloud {
            connection_id: auth.connection_id,
        };
        assert!(matches!(
            phone
                .archive
                .connect(&account("alice"), &target, "not the passphrase"),
            Err(ArchiveError::WrongPassphrase)
        ));
        let outcome = phone
            .archive
            .connect(&account("alice"), &target, PASSPHRASE)
            .unwrap();
        assert!(!outcome.created);
        let report = phone.restore();
        assert_eq!(report.messages, 12);
        assert_eq!(phone.timeline("c1").unwrap(), expected);

        // Disconnecting forgets the refresh token and revokes this device's Dropbox grant;
        // the laptop stays signed in.
        let revoked = cloud.state().revoked;
        phone.archive.disconnect(&account("alice")).unwrap();
        assert_eq!(cloud.state().revoked, revoked + expected_revokes(kind, 1));
        assert!(!cloud.state().refresh_revoked);
        assert!(phone_credentials.0.lock().unwrap().is_empty());
        assert!(!phone.archive.status(&account("alice")).unwrap().configured);
        feed.send_many("c1", 3);
        laptop.sync(&mut feed);
        assert_eq!(laptop.export().messages, 3);
    }
}

#[test]
fn moving_from_the_cloud_to_a_folder_signs_out_of_the_cloud() {
    let cloud = FakeCloud::start();
    let (connections, credentials) = cloud.connections();
    let device = Device::with_cloud("alice", connections);
    let auth = device
        .archive
        .cloud_authorize(CloudKind::GoogleDrive, approve)
        .unwrap();
    device
        .archive
        .connect(
            &account("alice"),
            &ConnectTarget::Cloud {
                connection_id: auth.connection_id,
            },
            PASSPHRASE,
        )
        .unwrap();
    assert_eq!(credentials.0.lock().unwrap().len(), 1);

    let folder = tempfile::tempdir().unwrap();
    assert!(device.connect(folder.path()));
    assert!(credentials.0.lock().unwrap().is_empty());
    assert_eq!(cloud.state().revoked, 0);
    let status = device.archive.status(&account("alice")).unwrap();
    assert_eq!(status.provider, Some("localFolder"));
}

#[test]
fn providers_work_from_the_blocking_pool_of_an_async_runtime() {
    // How the Tauri commands call them: inside `spawn_blocking` of a Tokio runtime, where the
    // blocking HTTP client must be built, used and dropped without panicking.
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let read = runtime.block_on(async move {
        tokio::task::spawn_blocking(move || {
            let (_, provider) = sign_in(&connections, CloudKind::Dropbox);
            provider.write("accounts/t/devices/d/head.rimx", b"h")?;
            provider.read("accounts/t/devices/d/head.rimx")
        })
        .await
        .unwrap()
    });
    assert_eq!(read.unwrap().unwrap(), b"h");
}
