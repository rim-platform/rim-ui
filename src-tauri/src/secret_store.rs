//! The app's secrets in the OS credential store: the message cache key, the history archive
//! keys and cloud refresh tokens, the offline session record, the device keys and the AI
//! provider keys, all under one service name.
//!
//! - macOS: Keychain. Windows: Credential Manager. Both are `keyring`'s defaults.
//! - Linux: the desktop keyring service (Secret Service over D-Bus, provided by GNOME Keyring,
//!   KWallet or KeePassXC), never the kernel keyring, which the kernel clears on reboot.
//!
//! On Linux there is no fallback: when no Secret Service is running, reads and writes fail
//! with an error that says so, instead of storing secrets somewhere that does not persist.

use keyring::Entry;

/// The service name every secret is stored under; entries differ by user name.
pub(crate) const SERVICE: &str = "com.rim.rim-ui";

/// The credential store entry for `user`.
#[cfg(target_os = "linux")]
pub(crate) fn entry(user: &str) -> keyring::Result<Entry> {
    let credential = keyring::secret_service::SsCredential::new_with_target(None, SERVICE, user)?;
    Ok(Entry::new_with_credential(Box::new(linux::Explaining(
        Box::new(credential),
    ))))
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

    /// The Secret Service credential, with its failures explained (see [`explain`]).
    pub(super) struct Explaining(pub(super) Box<Credential>);

    impl CredentialApi for Explaining {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.0.set_secret(secret).map_err(explain)
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.0.get_secret().map_err(explain)
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            self.0.delete_credential().map_err(explain)
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    impl fmt::Debug for Explaining {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.debug_tuple("Explaining").field(&self.0).finish()
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

        /// An in-memory store standing in for the Secret Service.
        fn store() -> Box<Credential> {
            MockCredentialBuilder {}.build(None, "svc", "user").unwrap()
        }

        fn mock(credential: &Credential) -> &MockCredential {
            credential.as_any().downcast_ref().unwrap()
        }

        fn entry(credential: Box<Credential>) -> Entry {
            Entry::new_with_credential(Box::new(Explaining(credential)))
        }

        #[test]
        fn reads_writes_and_deletes_go_to_the_secret_service() {
            let entry = entry(store());
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
            entry.set_password("new").unwrap();
            assert_eq!(entry.get_password().unwrap(), "new");
            entry.delete_credential().unwrap();
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
            assert!(matches!(entry.delete_credential(), Err(Error::NoEntry)));
        }

        #[test]
        fn no_secret_service_is_an_error_that_says_so() {
            let current = store();
            mock(current.as_ref()).set_error(Error::PlatformFailure(
                "org.freedesktop.DBus.Error.ServiceUnknown".into(),
            ));
            let err = entry(current).get_password().unwrap_err();
            assert!(matches!(err, Error::PlatformFailure(_)));
            let message = err.to_string();
            assert!(message.contains(NOT_RUNNING), "{message}");
            assert!(message.contains("ServiceUnknown"), "{message}");
        }

        #[test]
        fn a_locked_keyring_says_to_unlock_it() {
            let current = store();
            mock(current.as_ref()).set_error(Error::NoStorageAccess("prompt dismissed".into()));
            let err = entry(current).get_password().unwrap_err();
            assert!(err.to_string().contains(LOCKED), "{err}");

            // What GNOME Keyring answers when it cannot show its unlock prompt.
            let current = store();
            mock(current.as_ref()).set_error(Error::PlatformFailure(
                "D-Bus error: Cannot create an item in a locked collection \
                 (org.freedesktop.Secret.Error.IsLocked)"
                    .into(),
            ));
            let err = entry(current).set_password("x").unwrap_err();
            assert!(matches!(err, Error::NoStorageAccess(_)));
            assert!(err.to_string().contains(LOCKED), "{err}");
        }
    }
}

/// Against the real store. Needs a running, unlocked Secret Service:
/// `cargo test secret_store -- --ignored` inside a desktop session.
#[cfg(all(test, target_os = "linux"))]
mod system_tests {
    use keyring::credential::CredentialApi;
    use keyring::secret_service::SsCredential;

    use super::*;

    #[test]
    #[ignore = "needs a running Secret Service"]
    fn secrets_round_trip() {
        let user = format!("system-test-{}", uuid::Uuid::new_v4());
        let current = SsCredential::new_with_target(None, SERVICE, &user).unwrap();
        let entry = entry(&user).unwrap();

        entry.set_password("updated").unwrap();
        assert_eq!(entry.get_password().unwrap(), "updated");
        assert_eq!(current.get_password().unwrap(), "updated");
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
