//! The app's secrets in the OS credential store: the message cache key, the history archive
//! keys and cloud refresh tokens, the offline session record, the AI provider keys and the
//! legacy Stronghold password, all under one service name.
//!
//! - macOS: Keychain. Windows: Credential Manager. Both are `keyring`'s defaults.
//! - Linux: the desktop keyring service (Secret Service over D-Bus, provided by GNOME Keyring,
//!   KWallet or KeePassXC). Builds before this one used the kernel keyring, which the kernel
//!   clears on reboot, so every secret was lost with it.
//!
//! On Linux there is no fallback: when no Secret Service is running, reads and writes fail
//! with an error that says so, instead of storing secrets somewhere that does not persist.
//! A secret still in the kernel keyring from an earlier build (the app was updated without a
//! reboot in between) is moved to the Secret Service the first time it is read.

use keyring::Entry;

/// The service name every secret is stored under; entries differ by user name.
pub(crate) const SERVICE: &str = "com.rim.rim-ui";

/// The credential store entry for `user`.
#[cfg(target_os = "linux")]
pub(crate) fn entry(user: &str) -> keyring::Result<Entry> {
    let current = keyring::secret_service::SsCredential::new_with_target(None, SERVICE, user)?;
    // The kernel keyring can be unavailable (a sandbox that blocks its syscalls); then there
    // is simply nothing to migrate.
    let legacy = keyring::keyutils::KeyutilsCredential::new_with_target(None, SERVICE, user)
        .ok()
        .map(|c| Box::new(c) as Box<keyring::credential::Credential>);
    Ok(Entry::new_with_credential(Box::new(linux::Migrating {
        current: Box::new(current),
        legacy,
    })))
}

/// The credential store entry for `user`.
#[cfg(not(target_os = "linux"))]
pub(crate) fn entry(user: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, user)
}

#[cfg(target_os = "linux")]
mod linux {
    use std::any::Any;
    use std::fmt;

    use keyring::credential::{Credential, CredentialApi};
    use keyring::Error;

    /// The Secret Service credential, plus the kernel keyring credential of the same name
    /// that earlier builds wrote, read only to move a secret across.
    pub(super) struct Migrating {
        pub(super) current: Box<Credential>,
        pub(super) legacy: Option<Box<Credential>>,
    }

    impl Migrating {
        /// Best-effort: a stale legacy copy must not come back after the secret changes.
        fn forget_legacy(&self) {
            if let Some(legacy) = &self.legacy {
                let _ = legacy.delete_credential();
            }
        }

        fn migrate(&self) -> keyring::Result<Vec<u8>> {
            let secret = match &self.legacy {
                Some(legacy) => legacy.get_secret().map_err(|_| Error::NoEntry)?,
                None => return Err(Error::NoEntry),
            };
            self.current.set_secret(&secret).map_err(explain)?;
            self.forget_legacy();
            log::info!(
                "[secret_store] moved a secret from the kernel keyring to the Secret Service"
            );
            Ok(secret)
        }
    }

    impl CredentialApi for Migrating {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.current.set_secret(secret).map_err(explain)?;
            self.forget_legacy();
            Ok(())
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            match self.current.get_secret() {
                Err(Error::NoEntry) => self.migrate(),
                other => other.map_err(explain),
            }
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            let legacy_deleted = self
                .legacy
                .as_ref()
                .is_some_and(|legacy| legacy.delete_credential().is_ok());
            match self.current.delete_credential() {
                Err(Error::NoEntry) if legacy_deleted => Ok(()),
                other => other.map_err(explain),
            }
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    impl fmt::Debug for Migrating {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.debug_struct("Migrating")
                .field("current", &self.current)
                .field("legacy", &self.legacy)
                .finish()
        }
    }

    /// Says what to do about a Secret Service failure; the original error stays attached.
    fn explain(err: Error) -> Error {
        match err {
            // A locked collection whose unlock prompt could not be shown comes back as a plain
            // D-Bus failure, recognisable only by the Secret Service's error name, which only
            // the error's debug form carries.
            Error::PlatformFailure(source) if format!("{source:?}").contains(IS_LOCKED) => {
                Error::NoStorageAccess(Box::new(Explained {
                    hint: LOCKED,
                    source,
                }))
            }
            Error::PlatformFailure(source) => Error::PlatformFailure(Box::new(Explained {
                hint: NOT_RUNNING,
                source,
            })),
            Error::NoStorageAccess(source) => Error::NoStorageAccess(Box::new(Explained {
                hint: LOCKED,
                source,
            })),
            other => other,
        }
    }

    const IS_LOCKED: &str = "org.freedesktop.Secret.Error.IsLocked";

    pub(super) const NOT_RUNNING: &str = "the desktop keyring service (Secret Service) is not \
        available or failed. On Linux RIM keeps its keys there, so GNOME Keyring, KWallet or \
        another Secret Service provider must be running in your desktop session";

    pub(super) const LOCKED: &str = "the desktop keyring is locked or its unlock prompt was \
        dismissed. Unlock it and try again";

    #[derive(Debug)]
    struct Explained {
        hint: &'static str,
        source: Box<dyn std::error::Error + Send + Sync>,
    }

    impl fmt::Display for Explained {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "{} ({})", self.hint, self.source)
        }
    }

    impl std::error::Error for Explained {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(self.source.as_ref())
        }
    }

    #[cfg(test)]
    mod tests {
        use keyring::credential::CredentialBuilderApi;
        use keyring::mock::{MockCredential, MockCredentialBuilder};
        use keyring::Entry;

        use super::*;

        /// Two independent in-memory stores standing in for the Secret Service and the kernel
        /// keyring.
        fn stores() -> (Box<Credential>, Box<Credential>) {
            let build = || MockCredentialBuilder {}.build(None, "svc", "user").unwrap();
            (build(), build())
        }

        fn mock(credential: &Credential) -> &MockCredential {
            credential.as_any().downcast_ref().unwrap()
        }

        fn entry(current: Box<Credential>, legacy: Option<Box<Credential>>) -> Entry {
            Entry::new_with_credential(Box::new(Migrating { current, legacy }))
        }

        #[test]
        fn reads_and_writes_go_to_the_secret_service() {
            let (current, legacy) = stores();
            current.set_password("in secret service").unwrap();
            legacy.set_password("stale").unwrap();
            let both = entry(current, Some(legacy));

            assert_eq!(both.get_password().unwrap(), "in secret service");
            both.set_password("new").unwrap();
            assert_eq!(both.get_password().unwrap(), "new");
        }

        #[test]
        fn a_kernel_keyring_secret_moves_on_first_read() {
            let (current, legacy) = stores();
            legacy.set_password("from before the update").unwrap();
            let migrating = Migrating {
                current,
                legacy: Some(legacy),
            };

            assert_eq!(migrating.get_password().unwrap(), "from before the update");
            assert_eq!(
                migrating.current.get_password().unwrap(),
                "from before the update"
            );
            let legacy = migrating.legacy.as_ref().unwrap();
            assert!(matches!(legacy.get_password(), Err(Error::NoEntry)));
        }

        #[test]
        fn nothing_anywhere_is_no_entry() {
            let (current, legacy) = stores();
            assert!(matches!(
                entry(current, Some(legacy)).get_password(),
                Err(Error::NoEntry)
            ));
            let (current, _) = stores();
            assert!(matches!(
                entry(current, None).get_password(),
                Err(Error::NoEntry)
            ));
        }

        #[test]
        fn a_write_drops_the_stale_kernel_keyring_copy() {
            let (current, legacy) = stores();
            legacy.set_password("stale").unwrap();
            let migrating = Migrating {
                current,
                legacy: Some(legacy),
            };

            migrating.set_password("new").unwrap();
            let legacy = migrating.legacy.as_ref().unwrap();
            assert!(matches!(legacy.get_password(), Err(Error::NoEntry)));
        }

        #[test]
        fn delete_removes_both_copies_and_reports_a_missing_one() {
            let (current, legacy) = stores();
            current.set_password("a").unwrap();
            legacy.set_password("b").unwrap();
            let both = entry(current, Some(legacy));
            both.delete_credential().unwrap();
            assert!(matches!(both.get_password(), Err(Error::NoEntry)));
            assert!(matches!(both.delete_credential(), Err(Error::NoEntry)));

            // Only the legacy copy left: deleting it is a successful delete.
            let (current, legacy) = stores();
            legacy.set_password("b").unwrap();
            entry(current, Some(legacy)).delete_credential().unwrap();
        }

        #[test]
        fn no_secret_service_is_an_error_that_says_so_without_falling_back() {
            let (current, legacy) = stores();
            legacy.set_password("only in the kernel keyring").unwrap();
            mock(current.as_ref()).set_error(Error::PlatformFailure(
                "org.freedesktop.DBus.Error.ServiceUnknown".into(),
            ));
            let migrating = Migrating {
                current,
                legacy: Some(legacy),
            };

            let err = migrating.get_password().unwrap_err();
            assert!(matches!(err, Error::PlatformFailure(_)));
            let message = err.to_string();
            assert!(message.contains(NOT_RUNNING), "{message}");
            assert!(message.contains("ServiceUnknown"), "{message}");

            // The failed write is reported and the old copy is kept for the next attempt.
            mock(migrating.current.as_ref())
                .set_error(Error::PlatformFailure("no session bus".into()));
            assert!(migrating.set_password("new").is_err());
            let legacy = migrating.legacy.as_ref().unwrap();
            assert_eq!(legacy.get_password().unwrap(), "only in the kernel keyring");
        }

        #[test]
        fn a_locked_keyring_says_to_unlock_it() {
            let (current, _) = stores();
            mock(current.as_ref()).set_error(Error::NoStorageAccess("prompt dismissed".into()));
            let err = entry(current, None).get_password().unwrap_err();
            assert!(err.to_string().contains(LOCKED), "{err}");

            // What GNOME Keyring answers when it cannot show its unlock prompt.
            let (current, _) = stores();
            mock(current.as_ref()).set_error(Error::PlatformFailure(
                "D-Bus error: Cannot create an item in a locked collection \
                 (org.freedesktop.Secret.Error.IsLocked)"
                    .into(),
            ));
            let err = entry(current, None).set_password("x").unwrap_err();
            assert!(matches!(err, Error::NoStorageAccess(_)));
            assert!(err.to_string().contains(LOCKED), "{err}");
        }
    }
}

/// Against the real stores. Needs a running, unlocked Secret Service and the kernel keyring:
/// `cargo test secret_store -- --ignored` inside a desktop session.
#[cfg(all(test, target_os = "linux"))]
mod system_tests {
    use keyring::credential::CredentialApi;
    use keyring::keyutils::KeyutilsCredential;
    use keyring::secret_service::SsCredential;

    use super::*;

    #[test]
    #[ignore = "needs a running Secret Service"]
    fn secrets_round_trip_and_kernel_keyring_secrets_move() {
        let user = format!("system-test-{}", uuid::Uuid::new_v4());
        let current = SsCredential::new_with_target(None, SERVICE, &user).unwrap();

        // An earlier build's secret. Some sandboxes give each handle its own kernel keyring;
        // then there is nothing an earlier build could have left behind, and that half is skipped.
        let legacy = KeyutilsCredential::new_with_target(None, SERVICE, &user)
            .ok()
            .filter(|legacy| legacy.set_password("written by an earlier build").is_ok())
            .filter(|_| {
                KeyutilsCredential::new_with_target(None, SERVICE, &user)
                    .is_ok_and(|other| other.get_password().is_ok())
            });
        let entry = entry(&user).unwrap();
        match &legacy {
            Some(legacy) => {
                assert_eq!(entry.get_password().unwrap(), "written by an earlier build");
                assert!(matches!(
                    legacy.get_password(),
                    Err(keyring::Error::NoEntry)
                ));
                assert_eq!(
                    current.get_password().unwrap(),
                    "written by an earlier build"
                );
            }
            None => eprintln!("kernel keyring unavailable: skipped the migration half"),
        }

        entry.set_password("updated").unwrap();
        assert_eq!(entry.get_password().unwrap(), "updated");
        assert_eq!(current.get_password().unwrap(), "updated");
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
