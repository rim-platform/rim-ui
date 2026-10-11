//! The Google Drive, Dropbox, S3 and backup endpoint providers against the fake services in
//! [`super::fake`]: sign-in and the S3 and endpoint checks, upload, list, download, token
//! refresh, rate limits, an interrupted backup, and a restore on a second device. The endpoint
//! also runs against the reference service in Python.

use std::sync::Arc;

use serde_json::json;

use super::super::archive::Archive;
use super::super::format::Event;
use super::super::provider::ArchiveProvider;
use super::super::tests::{message, Device, PASSPHRASE, TEST_COST};
use super::super::{ArchiveError, ConnectTarget};
use super::endpoint::{EndpointAuth, EndpointProblem};
use super::fake::{approve, deny, FakeCloud, S3Conditional, ENDPOINT_TOKEN, S3_SECRET};
use super::s3::S3Problem;
use super::{CloudConnections, CloudKind};
use crate::message_cache::tests::{account, MockFeed};

const KINDS: [CloudKind; 2] = [CloudKind::GoogleDrive, CloudKind::Dropbox];

/// Where an archive is kept in these tests: a cloud service signed in to, or an S3 bucket or
/// the backup endpoint checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backend {
    Cloud(CloudKind),
    S3,
    Endpoint,
}

const BACKENDS: [Backend; 4] = [
    Backend::Cloud(CloudKind::GoogleDrive),
    Backend::Cloud(CloudKind::Dropbox),
    Backend::S3,
    Backend::Endpoint,
];
/// The fake S3's prefix, as the setup normalizes it.
const S3_PREFIX: &str = "backups/ada/";
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
    let (_, provider) = connections.pending_provider(&auth.connection_id).unwrap();
    (auth.connection_id, provider)
}

/// Check the fake's backup endpoint and return the pending connection's provider.
fn check_endpoint(
    cloud: &FakeCloud,
    connections: &CloudConnections,
) -> (String, Box<dyn ArchiveProvider>) {
    let check = connections
        .check_endpoint(cloud.endpoint_setup(), |p| {
            Ok(Archive::inspect(p)?.map(|m| m.version))
        })
        .unwrap();
    assert_eq!(check.url, format!("{}/ep/backup", cloud.url()));
    let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();
    (check.connection_id, provider)
}

/// Check the fake's S3 bucket and return the pending connection's provider.
fn check_s3(
    cloud: &FakeCloud,
    connections: &CloudConnections,
) -> (String, Box<dyn ArchiveProvider>) {
    let check = connections
        .check_s3(cloud.s3_setup(), |p| {
            Ok(Archive::inspect(p)?.map(|m| m.version))
        })
        .unwrap();
    assert_eq!(check.location, "rim/backups/ada on 127.0.0.1");
    let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();
    (check.connection_id, provider)
}

/// Set `backend` up on the fake and return the pending connection's provider.
fn set_up(
    cloud: &FakeCloud,
    connections: &CloudConnections,
    backend: Backend,
) -> (String, Box<dyn ArchiveProvider>) {
    match backend {
        Backend::Cloud(kind) => sign_in(connections, kind),
        Backend::S3 => check_s3(cloud, connections),
        Backend::Endpoint => check_endpoint(cloud, connections),
    }
}

/// How many provider revokes `n` sign-outs make: Dropbox revokes; Google, S3 and the endpoint
/// do not.
fn expected_revokes(backend: Backend, n: usize) -> usize {
    match backend {
        Backend::Cloud(CloudKind::Dropbox) => n,
        _ => 0,
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
        assert_eq!(
            cloud.state().revoked,
            expected_revokes(Backend::Cloud(kind), 1)
        );
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
    for backend in BACKENDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = set_up(&cloud, &connections, backend);

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
        let place = match backend {
            Backend::Cloud(_) => "ada@example.com".to_string(),
            Backend::S3 => "rim/backups/ada on 127.0.0.1".to_string(),
            Backend::Endpoint => format!("{}/ep/backup", cloud.url()),
        };
        assert!(provider.describe().contains(&place));

        let state = cloud.state();
        let files = [
            "accounts/t1/devices/d1/head.rimx",
            "accounts/t1/devices/d1/seg-0000000001.rimx",
            "accounts/t1/devices/d2/head.rimx",
            "rim-archive.json",
        ];
        match backend {
            Backend::Cloud(CloudKind::GoogleDrive) => {
                // One file per name, all in appDataFolder; the overwrite replaced in place.
                assert_eq!(state.drive_names(), files);
                assert!(state.drive.iter().all(|f| f.parents == ["appDataFolder"]));
            }
            Backend::Cloud(CloudKind::Dropbox) => {
                let paths: Vec<_> = state.dropbox.keys().cloned().collect();
                assert_eq!(paths, files.map(|f| format!("/{f}")));
            }
            Backend::S3 => {
                // Objects under the prefix; the storage takes conditional writes, so the create
                // left no claims, and the check deleted its probe.
                assert_eq!(state.s3_keys(), files.map(|f| format!("{S3_PREFIX}{f}")));
            }
            Backend::Endpoint => {
                // The service honours If-None-Match, so the create left no claim files; the
                // check left one probe.
                assert_eq!(state.endpoint_paths(), files);
                assert_eq!(state.endpoint.len(), files.len() + 1);
                assert_eq!(state.count("If-None-Match"), 0);
            }
        }
    }
}

#[test]
fn listings_follow_every_page() {
    let paged = [
        Backend::Cloud(CloudKind::GoogleDrive),
        Backend::Cloud(CloudKind::Dropbox),
        Backend::S3,
    ];
    for backend in paged {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = set_up(&cloud, &connections, backend);
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
    for backend in BACKENDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (_, provider) = set_up(&cloud, &connections, backend);
        let (upload, download) = match backend {
            Backend::Cloud(CloudKind::GoogleDrive) => {
                ("POST /upload/drive/v3/files", "GET /drive/v3/files")
            }
            Backend::Cloud(CloudKind::Dropbox) => ("files/upload", "files/download"),
            Backend::S3 => ("PUT /s3/", "GET /s3/"),
            Backend::Endpoint => ("POST /ep/backup", "GET /ep/backup"),
        };
        let drive = backend == Backend::Cloud(CloudKind::GoogleDrive);
        // S3 asks for a retry of a write that met another conditional write of its key.
        if backend == Backend::S3 {
            cloud.fault(
                upload,
                409,
                None,
                json!("<Error><Code>ConditionalRequestConflict</Code></Error>"),
                1,
            );
        }
        cloud.fault(
            upload,
            429,
            Some(1),
            json!({ "error": "too_many_requests" }),
            2,
        );
        cloud.fault(download, 503, None, json!({}), 1);
        if drive {
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
        let retries = if drive || backend == Backend::S3 {
            3
        } else {
            2
        };
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
    for backend in BACKENDS {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        let (id, provider) = set_up(&cloud, &connections, backend);
        let archive = Archive::create(provider, PASSPHRASE, TEST_COST, chrono::Utc::now()).unwrap();
        archive
            .account(LABEL)
            .append(DEVICE, &events("c1", 1, 3), 1_000)
            .unwrap();

        // The connection drops after the new segment is uploaded, before the head lists it.
        let head_write = match backend {
            Backend::Cloud(CloudKind::GoogleDrive) => "PATCH /upload/drive/v3/files",
            Backend::Cloud(CloudKind::Dropbox) => "head.rimx",
            Backend::S3 => "head.rimx PUT",
            Backend::Endpoint => "head.rimx POST",
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
            Archive::unlock(connections.pending_provider(&id).unwrap().1, PASSPHRASE).unwrap();
        let contents = reader.account(LABEL).read_all().unwrap();
        assert_eq!(contents.segments.len(), 1);
        assert!(contents.missing.is_empty() && contents.damaged.is_empty());

        // The next export, in a fresh session, writes the batch again over the orphan.
        let resumed = Archive::open(
            connections.pending_provider(&id).unwrap().1,
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

        if backend == Backend::Cloud(CloudKind::GoogleDrive) {
            // The orphan was overwritten, not joined by a second file of its name.
            let names = cloud.state().drive_names();
            let mut unique = names.clone();
            unique.dedup();
            assert_eq!(names, unique);
            assert_eq!(names.len(), 4, "{names:?}");
        }
    }
}

/// Sign in to `backend` or check it on `device`: the pending connection's id, and the version
/// of the archive found there.
fn connect_place(device: &Device, cloud: &FakeCloud, backend: Backend) -> (String, Option<u32>) {
    match backend {
        Backend::Cloud(kind) => {
            let auth = device.archive.cloud_authorize(kind, approve).unwrap();
            assert_eq!(auth.has_archive, auth.version.is_some());
            (auth.connection_id, auth.version)
        }
        Backend::S3 => {
            let check = device.archive.s3_check(cloud.s3_setup()).unwrap();
            assert_eq!(check.has_archive, check.version.is_some());
            (check.connection_id, check.version)
        }
        Backend::Endpoint => {
            let check = device
                .archive
                .endpoint_check(cloud.endpoint_setup())
                .unwrap();
            assert_eq!(check.has_archive, check.version.is_some());
            (check.connection_id, check.version)
        }
    }
}

#[test]
fn a_new_device_restores_from_the_cloud_and_disconnecting_signs_out() {
    for backend in BACKENDS {
        let cloud = FakeCloud::start();
        let (laptop_cloud, laptop_credentials) = cloud.connections();
        let laptop = Device::with_cloud("alice", laptop_cloud);
        let (connection_id, version) = connect_place(&laptop, &cloud, backend);
        assert_eq!(version, None);
        let target = ConnectTarget::Cloud { connection_id };
        let outcome = laptop
            .archive
            .connect(&account("alice"), &target, PASSPHRASE)
            .unwrap();
        assert!(outcome.created);
        let status = outcome.status;
        let (expected_kind, place) = match backend {
            Backend::Cloud(CloudKind::GoogleDrive) => ("googleDrive", "ada@example.com".into()),
            Backend::Cloud(CloudKind::Dropbox) => ("dropbox", "ada@example.com".into()),
            Backend::S3 => ("s3", "rim/backups/ada on 127.0.0.1".into()),
            Backend::Endpoint => ("endpoint", format!("{}/ep/backup", cloud.url())),
        };
        assert_eq!(status.provider, Some(expected_kind));
        assert_eq!(status.folder, Some(place));
        assert!(status.unlocked);

        // The refresh token, the S3 secret or the endpoint's token is in the keyring, not in
        // the settings file.
        assert_eq!(laptop_credentials.0.lock().unwrap().len(), 1);
        let settings_dir = laptop._data.path().join("history-archive");
        for entry in std::fs::read_dir(&settings_dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            assert!(
                !text.contains("refresh-0")
                    && !text.contains("access-")
                    && !text.contains(ENDPOINT_TOKEN)
                    && !text.contains(S3_SECRET),
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
        let (connection_id, version) = connect_place(&phone, &cloud, backend);
        assert_eq!(version, Some(1));
        let target = ConnectTarget::Cloud { connection_id };
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

        // Disconnecting forgets the refresh token or the endpoint's token and revokes this
        // device's Dropbox grant; the laptop stays signed in.
        let revoked = cloud.state().revoked;
        phone.archive.disconnect(&account("alice")).unwrap();
        assert_eq!(
            cloud.state().revoked,
            revoked + expected_revokes(backend, 1)
        );
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

// ─── Backup endpoint ────────────────────────────────────────────────────────

/// The problem an endpoint check with `setup` reports.
fn check_problem(
    connections: &CloudConnections,
    setup: super::endpoint::EndpointSetup,
) -> ArchiveError {
    connections
        .check_endpoint(setup, |_| Ok(None))
        .map(|check| check.connection_id)
        .unwrap_err()
}

#[test]
fn the_endpoint_check_sends_each_auth_mode() {
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let modes = [
        (EndpointAuth::None, None),
        (
            EndpointAuth::Basic {
                username: "ada".into(),
            },
            Some(("Authorization", "Basic YWRhOnB3")),
        ),
        (EndpointAuth::Bearer, Some(("Authorization", "Bearer pw"))),
        (
            EndpointAuth::Header {
                name: "X-Api-Key".into(),
            },
            Some(("X-Api-Key", "pw")),
        ),
    ];
    for (auth, header) in modes {
        cloud.state().endpoint_auth = header.map(|(n, v)| (n.to_string(), v.to_string()));
        let mut setup = cloud.endpoint_setup();
        setup.secret = header.map(|_| zeroize::Zeroizing::new("pw".to_string()));
        setup.auth = auth.clone();
        let check = connections.check_endpoint(setup, |_| Ok(None)).unwrap();
        assert!(check.exclusive_create, "{auth:?}");
        let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();
        provider.write("a/b", b"x").unwrap();
        assert_eq!(provider.read("a/b").unwrap().unwrap(), b"x");
    }

    // A mode that takes a secret is refused without one, before anything is sent.
    let mut setup = cloud.endpoint_setup();
    setup.secret = None;
    let before = cloud.state().log.len();
    assert!(matches!(
        check_problem(&connections, setup),
        ArchiveError::Invalid(_)
    ));
    assert_eq!(cloud.state().log.len(), before);
}

#[test]
fn the_endpoint_check_names_the_problem() {
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let setup = FakeCloud::endpoint_setup;
    let code = |setup| check_problem(&connections, setup).code();

    let mut wrong_token = setup(&cloud);
    wrong_token.secret = Some(zeroize::Zeroizing::new("not-it".into()));
    let mut wrong_path = setup(&cloud);
    wrong_path.url = format!("{}/ep/wrong", cloud.url());
    let mut refused = setup(&cloud);
    refused.url = "http://127.0.0.1:1".into();
    // A server that answers a TLS handshake in plain HTTP.
    let plain = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut tls = setup(&cloud);
    tls.url = format!("https://{}", plain.local_addr().unwrap());
    std::thread::spawn(move || {
        use std::io::Write;
        if let Ok((mut stream, _)) = plain.accept() {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
        }
    });
    let mut insecure = setup(&cloud);
    insecure.url = "http://backup.example.invalid/backup".into();

    for (setup, expected) in [
        (wrong_token, EndpointProblem::Unauthorized.code()),
        (wrong_path, EndpointProblem::NotFound.code()),
        (refused, "ARCHIVE_UNAVAILABLE"),
        (tls, "ARCHIVE_TLS"),
        (insecure, EndpointProblem::Insecure.code()),
    ] {
        let url = setup.url.clone();
        assert_eq!(code(setup), expected, "{url}");
    }

    cloud.fault("POST /ep/backup", 403, None, json!({}), 1);
    assert_eq!(code(setup(&cloud)), EndpointProblem::Forbidden.code());

    // A listing that is not a JSON array of entries.
    cloud.fault("list= GET", 200, None, json!("<html>"), 1);
    assert_eq!(code(setup(&cloud)), EndpointProblem::NotJson.code());

    // A service that takes the probe but returns something else.
    cloud.fault("GET /ep/backup path=", 200, None, json!("other bytes"), 1);
    assert_eq!(code(setup(&cloud)), EndpointProblem::Broken.code());
}

#[test]
fn an_endpoint_without_exclusive_create_keeps_the_first_claim() {
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    cloud.state().endpoint_ignores_conditions = true;
    let check = connections
        .check_endpoint(cloud.endpoint_setup(), |_| Ok(None))
        .unwrap();
    assert!(!check.exclusive_create);
    let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();

    assert!(provider.create("rim-archive.json", b"mine").unwrap());
    assert!(!provider.create("rim-archive.json", b"again").unwrap());
    assert_eq!(provider.read("rim-archive.json").unwrap().unwrap(), b"mine");

    // Another device's claim was stored first: this device writes that one's bytes and joins.
    cloud.state().endpoint_race = Some("head.rimx".into());
    assert!(!provider.create("devices/d1/head.rimx", b"mine").unwrap());
    assert_eq!(
        provider.read("devices/d1/head.rimx").unwrap().unwrap(),
        b"the other device's"
    );
    let paths = cloud.state().endpoint_paths();
    assert_eq!(paths.iter().filter(|p| p.ends_with(".claim")).count(), 3);
    // Claims are files, not directories: listings of directories ignore them.
    assert_eq!(provider.list_dirs("devices").unwrap(), vec!["d1"]);
}

/// The reference service in `docs/specs`, running on a free loopback port until dropped.
struct ReferenceService {
    child: std::process::Child,
    url: String,
    _dir: tempfile::TempDir,
}

impl ReferenceService {
    /// `None` when this computer has no `python3`.
    fn start(auth: &[&str]) -> Option<Self> {
        use std::io::BufRead;
        use std::process::{Command, Stdio};

        if Command::new("python3").arg("--version").output().is_err() {
            eprintln!("python3 is not installed: the reference backup endpoint is not tested");
            return None;
        }
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docs/specs/backup-endpoint-reference.py");
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("python3")
            .arg("-I")
            .arg(script)
            .arg("--dir")
            .arg(dir.path())
            .args(["--port", "0"])
            .args(auth)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let url = line
            .trim()
            .strip_prefix("listening on ")
            .unwrap_or_else(|| panic!("unexpected output: {line:?}"))
            .to_string();
        Some(Self {
            child,
            url,
            _dir: dir,
        })
    }
}

impl Drop for ReferenceService {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn the_reference_service_holds_an_archive() {
    let modes = [
        (vec![], EndpointAuth::None),
        (
            vec!["--basic", "ada:pw"],
            EndpointAuth::Basic {
                username: "ada".into(),
            },
        ),
        (vec!["--bearer", "pw"], EndpointAuth::Bearer),
        (
            vec!["--header", "X-Api-Key:pw"],
            EndpointAuth::Header {
                name: "X-Api-Key".into(),
            },
        ),
    ];
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    for (flags, auth) in modes {
        let Some(service) = ReferenceService::start(&flags) else {
            return;
        };
        let setup = |secret: &str| super::endpoint::EndpointSetup {
            url: service.url.clone(),
            auth: auth.clone(),
            secret: Some(zeroize::Zeroizing::new(secret.to_string())),
            allow_insecure: false,
        };
        if auth.needs_secret() {
            assert!(
                matches!(
                    check_problem(&connections, setup("not-it")),
                    ArchiveError::Endpoint(EndpointProblem::Unauthorized, _)
                ),
                "{auth:?}"
            );
        }
        let check = connections
            .check_endpoint(setup("pw"), |_| Ok(None))
            .unwrap();
        assert!(check.exclusive_create, "{auth:?}");
        let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();

        let archive = Archive::create(provider, PASSPHRASE, TEST_COST, chrono::Utc::now()).unwrap();
        archive
            .account(LABEL)
            .append(DEVICE, &events("c1", 1, 3), 1_000)
            .unwrap();
        archive
            .account(LABEL)
            .append(DEVICE, &events("c1", 4, 5), 2_000)
            .unwrap();
        let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();
        assert!(!provider.create("rim-archive.json", b"another").unwrap());
        assert_eq!(provider.read("devices/none").unwrap(), None);
        assert!(provider.list_dirs("accounts/none").unwrap().is_empty());
        let reader = Archive::unlock(provider, PASSPHRASE).unwrap();
        let contents = reader.account(LABEL).read_all().unwrap();
        assert_eq!(contents.devices, 1);
        let all: Vec<Event> = contents
            .segments
            .into_iter()
            .flat_map(|s| s.events)
            .collect();
        assert_eq!(all, events("c1", 1, 5), "{auth:?}");
    }
}

// ─── S3 ─────────────────────────────────────────────────────────────────────

#[test]
fn the_s3_check_names_the_problem() {
    let cloud = FakeCloud::start();
    let (connections, _) = cloud.connections();
    let code = |setup| {
        connections
            .check_s3(setup, |_| Ok(None))
            .map(|check| check.connection_id)
            .unwrap_err()
            .code()
    };
    let setup = FakeCloud::s3_setup;

    let mut wrong_secret = setup(&cloud);
    wrong_secret.secret_access_key = Some(zeroize::Zeroizing::new("not-it".into()));
    let mut wrong_key = setup(&cloud);
    wrong_key.access_key_id = "AKIDOTHER".into();
    let mut wrong_bucket = setup(&cloud);
    wrong_bucket.bucket = "elsewhere".into();
    let mut wrong_region = setup(&cloud);
    wrong_region.region = "eu-central-1".into();
    let mut not_s3 = setup(&cloud);
    not_s3.endpoint = format!("{}/ep/wrong", cloud.url());
    let mut insecure = setup(&cloud);
    insecure.endpoint = "http://minio.example.invalid:9000".into();
    let mut no_secret = setup(&cloud);
    no_secret.secret_access_key = None;

    for (setup, expected) in [
        (wrong_secret, S3Problem::Credentials.code()),
        (wrong_key, S3Problem::Credentials.code()),
        (wrong_bucket, S3Problem::NoSuchBucket.code()),
        (wrong_region, S3Problem::WrongRegion.code()),
        (not_s3, S3Problem::NotS3.code()),
        (insecure, EndpointProblem::Insecure.code()),
        (no_secret, "INVALID_ARGS"),
    ] {
        let endpoint = setup.endpoint.clone();
        assert_eq!(code(setup), expected, "{endpoint}");
    }

    let s3_error = |code: &str| json!(format!("<Error><Code>{code}</Code></Error>"));
    cloud.fault("PUT /s3/", 403, None, s3_error("AccessDenied"), 1);
    assert_eq!(code(setup(&cloud)), S3Problem::Forbidden.code());
    cloud.fault("PUT /s3/", 403, None, s3_error("RequestTimeTooSkewed"), 1);
    assert_eq!(code(setup(&cloud)), S3Problem::Clock.code());
    cloud.fault("GET /s3/", 200, None, json!("other bytes"), 1);
    assert_eq!(code(setup(&cloud)), S3Problem::Broken.code());
    cloud.fault("list-type=2", 200, None, json!("<html></html>"), 1);
    assert_eq!(code(setup(&cloud)), S3Problem::NotS3.code());

    // The archive never deletes, so a key that may not delete still passes; its probe stays.
    cloud.fault("DELETE /s3/", 403, None, s3_error("AccessDenied"), 1);
    connections.check_s3(setup(&cloud), |_| Ok(None)).unwrap();
}

#[test]
fn s3_without_conditional_writes_keeps_the_oldest_claim() {
    for conditional in [S3Conditional::Ignore, S3Conditional::NotImplemented] {
        let cloud = FakeCloud::start();
        let (connections, _) = cloud.connections();
        cloud.state().s3_conditional = conditional;
        let check = connections
            .check_s3(cloud.s3_setup(), |_| Ok(None))
            .unwrap();
        assert!(!check.conditional_writes, "{conditional:?}");
        let (_, provider) = connections.pending_provider(&check.connection_id).unwrap();

        assert!(provider.create("rim-archive.json", b"mine").unwrap());
        assert!(!provider.create("rim-archive.json", b"again").unwrap());
        assert_eq!(provider.read("rim-archive.json").unwrap().unwrap(), b"mine");

        // Another device's claim is a second older: this device copies that one and joins.
        cloud.state().s3_race = Some("head.rimx".into());
        assert!(!provider.create("devices/d1/head.rimx", b"mine").unwrap());
        assert_eq!(
            provider.read("devices/d1/head.rimx").unwrap().unwrap(),
            b"the other device's"
        );
        let claims = cloud
            .state()
            .s3_keys()
            .into_iter()
            .filter(|k| k.ends_with(".claim"))
            .count();
        assert_eq!(claims, 3);
        assert_eq!(provider.list_dirs("devices").unwrap(), vec!["d1"]);
    }
}
