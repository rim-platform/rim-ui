//! Cloud API providers of the history archive: Google Drive, Dropbox, S3-compatible storage
//! and the user's own backup endpoint, spoken to directly from this app, with no RIM server in
//! the path (nobody but the user's own storage holds their history).
//!
//! - [`oauth`]: the desktop sign-in (system browser, loopback redirect, PKCE) and the access
//!   tokens refreshed from a refresh token. Refresh tokens live in the secret vault, never in
//!   the settings file.
//! - [`http`]: retries with backoff for rate limits and transient failures.
//! - [`sigv4`]: the request signing S3 takes.
//! - [`google_drive`], [`dropbox`], [`s3`], [`endpoint`]: the [`ArchiveProvider`]
//!   implementations.
//!
//! Each provider writes the same format as a local folder (`docs/specs/history-archive-v1.md`)
//! and only needs the provider operations it already has: upload a new file, list, download,
//! and overwrite one small file (a device's head).
//!
//! OAuth client ids are build configuration: `RIM_GOOGLE_CLIENT_ID` (with
//! `RIM_GOOGLE_CLIENT_SECRET`) and `RIM_DROPBOX_APP_KEY`, read at build time or, for a
//! development run, from the environment. A build without them offers neither service; S3 and
//! the backup endpoint need no build configuration and are always offered.

pub(crate) mod claims;
pub(crate) mod dropbox;
pub(crate) mod endpoint;
pub(crate) mod google_drive;
pub(crate) mod http;
pub(crate) mod oauth;
pub(crate) mod s3;
pub(crate) mod sigv4;

#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::blocking::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::secret_store::SecretVault;

use super::provider::ArchiveProvider;
use super::{vault_error, ArchiveError};
use dropbox::{DropboxEndpoints, DropboxProvider};
use endpoint::{EndpointCheck, EndpointConnection, EndpointProvider, EndpointSetup};
use google_drive::{DriveEndpoints, GoogleDriveProvider};
use http::{Http, Reply, RetryPolicy};
use oauth::{Loopback, OAuthApp, Pkce, TokenSource};
use s3::{S3Check, S3Connection, S3Provider, S3Setup};

/// The cloud services an archive can live in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloudKind {
    GoogleDrive,
    Dropbox,
}

impl CloudKind {
    pub(crate) fn service(self) -> &'static str {
        match self {
            Self::GoogleDrive => google_drive::SERVICE,
            Self::Dropbox => dropbox::SERVICE,
        }
    }
}

/// One provider's OAuth client and endpoints.
#[derive(Debug, Clone)]
pub(crate) struct ServiceSettings {
    /// `None` when this build has no client id for the service; it is then not offered.
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    /// The redirect URI's host: Google takes `127.0.0.1` on any port; Dropbox only takes
    /// redirect URIs registered with the app, so it gets `localhost` on a fixed port.
    pub redirect_host: &'static str,
    /// 0: any free port.
    pub redirect_port: u16,
    pub authorize_url: String,
    pub token_url: String,
}

/// Build and run configuration of the cloud providers.
#[derive(Debug, Clone)]
pub(crate) struct CloudSettings {
    pub google: ServiceSettings,
    pub drive: DriveEndpoints,
    pub dropbox: ServiceSettings,
    pub dropbox_api: DropboxEndpoints,
    pub retry: RetryPolicy,
    /// How long the browser sign-in may take.
    pub sign_in_timeout: Duration,
}

/// The Dropbox redirect port unless `RIM_DROPBOX_REDIRECT_PORT` says otherwise. The app's
/// Dropbox settings must list `http://localhost:<port>/callback`.
pub(crate) const DEFAULT_DROPBOX_REDIRECT_PORT: u16 = 53_241;

/// A setting from the environment of this run, else from the build's.
fn setting(runtime: Option<String>, build: Option<&'static str>) -> Option<String> {
    runtime
        .or(build.map(str::to_string))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

impl CloudSettings {
    /// The real services, with client ids from the environment or the build.
    pub(crate) fn from_env() -> Self {
        let env = |name: &str| std::env::var(name).ok();
        let dropbox_port = setting(
            env("RIM_DROPBOX_REDIRECT_PORT"),
            option_env!("RIM_DROPBOX_REDIRECT_PORT"),
        )
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_DROPBOX_REDIRECT_PORT);
        Self {
            google: ServiceSettings {
                client_id: setting(
                    env("RIM_GOOGLE_CLIENT_ID"),
                    option_env!("RIM_GOOGLE_CLIENT_ID"),
                ),
                client_secret: setting(
                    env("RIM_GOOGLE_CLIENT_SECRET"),
                    option_env!("RIM_GOOGLE_CLIENT_SECRET"),
                ),
                redirect_host: "127.0.0.1",
                redirect_port: 0,
                authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
                token_url: "https://oauth2.googleapis.com/token".into(),
            },
            drive: DriveEndpoints {
                api: "https://www.googleapis.com/drive/v3".into(),
                upload: "https://www.googleapis.com/upload/drive/v3".into(),
            },
            dropbox: ServiceSettings {
                client_id: setting(
                    env("RIM_DROPBOX_APP_KEY"),
                    option_env!("RIM_DROPBOX_APP_KEY"),
                ),
                client_secret: None,
                redirect_host: "localhost",
                redirect_port: dropbox_port,
                authorize_url: "https://www.dropbox.com/oauth2/authorize".into(),
                token_url: "https://api.dropboxapi.com/oauth2/token".into(),
            },
            dropbox_api: DropboxEndpoints {
                api: "https://api.dropboxapi.com/2".into(),
                content: "https://content.dropboxapi.com/2".into(),
            },
            retry: RetryPolicy::DEFAULT,
            sign_in_timeout: Duration::from_secs(5 * 60),
        }
    }

    fn service(&self, kind: CloudKind) -> &ServiceSettings {
        match kind {
            CloudKind::GoogleDrive => &self.google,
            CloudKind::Dropbox => &self.dropbox,
        }
    }

    fn oauth_app(&self, kind: CloudKind) -> Result<OAuthApp, ArchiveError> {
        let service = self.service(kind);
        let client_id = service.client_id.clone().ok_or_else(|| {
            ArchiveError::ServiceNotConfigured(format!(
                "this build of RIM has no {} client id",
                kind.service()
            ))
        })?;
        let (scopes, extra) = match kind {
            CloudKind::GoogleDrive => (google_drive::SCOPES, google_drive::AUTHORIZE_EXTRA),
            CloudKind::Dropbox => (dropbox::SCOPES, dropbox::AUTHORIZE_EXTRA),
        };
        Ok(OAuthApp {
            client_id,
            client_secret: service.client_secret.clone(),
            authorize_url: service.authorize_url.clone(),
            token_url: service.token_url.clone(),
            scopes,
            extra,
        })
    }

    fn http(&self, kind: CloudKind, policy: RetryPolicy) -> Result<Http, ArchiveError> {
        let classify = match kind {
            CloudKind::GoogleDrive => google_drive::is_rate_limited,
            CloudKind::Dropbox => http::no_extra_retries,
        };
        Http::new(kind.service(), policy, classify)
    }
}

/// Which cloud services this build offers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudService {
    pub kind: CloudKind,
    pub available: bool,
}

// ─── Credentials ────────────────────────────────────────────────────────────

/// Where refresh tokens are kept: the secret vault in the app, memory in tests.
pub(crate) trait CredentialStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, ArchiveError>;
    fn set(&self, name: &str, secret: &str) -> Result<(), ArchiveError>;
    fn delete(&self, name: &str) -> Result<(), ArchiveError>;
}

pub(crate) struct VaultCredentials(pub(crate) Arc<SecretVault>);

impl CredentialStore for VaultCredentials {
    fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, ArchiveError> {
        self.0.read(name).map_err(vault_error)
    }

    fn set(&self, name: &str, secret: &str) -> Result<(), ArchiveError> {
        self.0.write(name, secret).map_err(vault_error)
    }

    fn delete(&self, name: &str) -> Result<(), ArchiveError> {
        self.0.delete(name).map_err(vault_error)
    }
}

/// The secret name of a connection's refresh token, an endpoint's password or token, or an S3
/// secret access key.
fn credential_name(connection_id: &str) -> String {
    format!("history-archive-cloud-v1:{connection_id}")
}

// ─── Requests with a token ──────────────────────────────────────────────────

/// Sends requests with a connection's access token, refreshing it once when the service
/// refuses it.
pub(crate) struct Authorized {
    tokens: Arc<TokenSource>,
}

impl Authorized {
    pub(crate) fn new(tokens: Arc<TokenSource>) -> Self {
        Self { tokens }
    }

    pub(crate) fn http(&self) -> &Http {
        self.tokens.http()
    }

    pub(crate) fn send(
        &self,
        build: impl Fn(&Client, &str) -> RequestBuilder,
    ) -> Result<Reply, ArchiveError> {
        let token = self.tokens.access_token()?;
        let reply = self.http().send(|c| build(c, &token))?;
        if reply.status != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(reply);
        }
        self.tokens.invalidate();
        let token = self.tokens.access_token()?;
        self.http().send(|c| build(c, &token))
    }
}

// ─── Connections ────────────────────────────────────────────────────────────

/// A signed-in cloud account an archive is kept in, as saved in the account's settings. The
/// refresh token is in the secret vault under the connection id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudConnection {
    pub connection_id: String,
    /// The signed-in account, to show the user (an email address).
    pub account: String,
}

/// The outcome of a sign-in: a connection waiting for the passphrase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthorization {
    pub connection_id: String,
    pub kind: CloudKind,
    pub account: String,
    pub has_archive: bool,
    pub version: Option<u32>,
}

/// A connection waiting for the passphrase.
enum Pending {
    OAuth {
        kind: CloudKind,
        account: String,
        tokens: Arc<TokenSource>,
    },
    Endpoint {
        connection: EndpointConnection,
        secret: Option<Zeroizing<String>>,
    },
    S3 {
        connection: S3Connection,
        secret: Zeroizing<String>,
    },
}

/// A connection as the account's settings name it.
pub(crate) enum Connection {
    OAuth(CloudKind, CloudConnection),
    Endpoint(EndpointConnection),
    S3(S3Connection),
}

const EXPIRED: &str = "that sign-in has expired; sign in again";

/// Signed-in connections: the ones still waiting for a passphrase (in memory only, so an
/// abandoned sign-in leaves nothing in the secret vault), and live token sources of kept ones.
pub(crate) struct CloudConnections {
    settings: CloudSettings,
    credentials: Arc<dyn CredentialStore>,
    pending: Mutex<HashMap<String, Pending>>,
    live: Mutex<HashMap<String, Arc<TokenSource>>>,
    /// One sign-in at a time; a new one cancels the one before.
    signing_in: Mutex<()>,
    cancel: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl CloudConnections {
    pub(crate) fn new(settings: CloudSettings, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            settings,
            credentials,
            pending: Mutex::new(HashMap::new()),
            live: Mutex::new(HashMap::new()),
            signing_in: Mutex::new(()),
            cancel: AtomicBool::new(false),
        }
    }

    pub(crate) fn services(&self) -> Vec<CloudService> {
        [CloudKind::GoogleDrive, CloudKind::Dropbox]
            .into_iter()
            .map(|kind| CloudService {
                kind,
                available: self.settings.service(kind).client_id.is_some(),
            })
            .collect()
    }

    /// Sign in to `kind` in the browser (`open_browser` opens the URL it is given), then
    /// look into the account's app folder. The connection is held until [`Self::take`] or
    /// [`Self::discard`].
    pub(crate) fn authorize(
        &self,
        kind: CloudKind,
        open_browser: impl FnOnce(&str) -> Result<(), ArchiveError>,
        inspect: impl FnOnce(&dyn ArchiveProvider) -> Result<Option<u32>, ArchiveError>,
    ) -> Result<CloudAuthorization, ArchiveError> {
        let app = self.settings.oauth_app(kind)?;
        // Cancel a sign-in still waiting, then take its place.
        self.cancel.store(true, Ordering::SeqCst);
        let _signing_in = lock(&self.signing_in);
        self.cancel.store(false, Ordering::SeqCst);

        let service = self.settings.service(kind);
        let loopback = Loopback::bind(service.redirect_host, service.redirect_port)?;
        let pkce = Pkce::new()?;
        let state = oauth::random_state()?;
        let redirect_uri = loopback.redirect_uri().to_string();
        open_browser(&app.authorize_url(&redirect_uri, &state, &pkce)?)?;
        let code = loopback.wait(
            &state,
            Instant::now() + self.settings.sign_in_timeout,
            &self.cancel,
        )?;
        drop(loopback);

        let http = Arc::new(self.settings.http(kind, self.settings.retry)?);
        let grant = app.exchange(&http, &code, &pkce.verifier, &redirect_uri)?;
        let tokens = Arc::new(TokenSource::from_grant(app, http, grant)?);
        let account = self.account_email(kind, tokens.clone())?;
        let provider = self.provider(kind, tokens.clone(), account.clone());
        provider.check_writable()?;
        let version = inspect(provider.as_ref())?;

        let connection_id = uuid::Uuid::new_v4().to_string();
        lock(&self.pending).insert(
            connection_id.clone(),
            Pending::OAuth {
                kind,
                account: account.clone(),
                tokens,
            },
        );
        Ok(CloudAuthorization {
            connection_id,
            kind,
            account,
            has_archive: version.is_some(),
            version,
        })
    }

    /// Stop a sign-in that is waiting for the browser.
    pub(crate) fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Check the backup endpoint the user typed (the probe), then look into it. The
    /// connection, with its secret in memory only, is held until [`Self::keep`] or
    /// [`Self::discard`].
    pub(crate) fn check_endpoint(
        &self,
        setup: EndpointSetup,
        inspect: impl FnOnce(&dyn ArchiveProvider) -> Result<Option<u32>, ArchiveError>,
    ) -> Result<EndpointCheck, ArchiveError> {
        let url = endpoint::route_url(&setup.url, setup.allow_insecure)?;
        let mut connection = EndpointConnection {
            connection_id: uuid::Uuid::new_v4().to_string(),
            url: url.to_string(),
            auth: setup.auth,
            allow_insecure: setup.allow_insecure,
            exclusive_create: false,
        };
        let secret = setup.secret.filter(|_| connection.auth.needs_secret());
        let checking = EndpointProvider::new(
            self.endpoint_http(RetryPolicy::CHECK)?,
            &connection,
            secret.clone(),
        )?;
        connection.exclusive_create = checking.probe()?;
        let version = inspect(
            self.endpoint_provider(&connection, secret.clone())?
                .as_ref(),
        )?;
        let check = EndpointCheck {
            connection_id: connection.connection_id.clone(),
            url: connection.url.clone(),
            has_archive: version.is_some(),
            version,
            exclusive_create: connection.exclusive_create,
        };
        lock(&self.pending).insert(
            check.connection_id.clone(),
            Pending::Endpoint { connection, secret },
        );
        Ok(check)
    }

    /// Check the S3 bucket the user typed (the probe), then look into it. The connection, with
    /// its secret in memory only, is held until [`Self::keep`] or [`Self::discard`].
    pub(crate) fn check_s3(
        &self,
        setup: S3Setup,
        inspect: impl FnOnce(&dyn ArchiveProvider) -> Result<Option<u32>, ArchiveError>,
    ) -> Result<S3Check, ArchiveError> {
        let mut connection = S3Connection::from_setup(&setup)?;
        let secret = setup
            .secret_access_key
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ArchiveError::Invalid("enter the secret access key".into()))?;
        let checking = S3Provider::new(
            self.s3_http(RetryPolicy::CHECK)?,
            &connection,
            secret.clone(),
        )?;
        connection.conditional_writes = checking.probe()?;
        let version = inspect(self.s3_provider(&connection, secret.clone())?.as_ref())?;
        let check = S3Check {
            connection_id: connection.connection_id.clone(),
            location: connection.location(),
            has_archive: version.is_some(),
            version,
            conditional_writes: connection.conditional_writes,
        };
        lock(&self.pending).insert(
            check.connection_id.clone(),
            Pending::S3 { connection, secret },
        );
        Ok(check)
    }

    /// A pending connection's provider, for connecting the archive in it.
    pub(crate) fn pending_provider(
        &self,
        connection_id: &str,
    ) -> Result<(Connection, Box<dyn ArchiveProvider>), ArchiveError> {
        let pending = lock(&self.pending);
        match pending.get(connection_id) {
            None => Err(ArchiveError::CloudAuth(EXPIRED.into())),
            Some(Pending::OAuth {
                kind,
                account,
                tokens,
            }) => {
                let connection = CloudConnection {
                    connection_id: connection_id.to_string(),
                    account: account.clone(),
                };
                Ok((
                    Connection::OAuth(*kind, connection),
                    self.provider(*kind, tokens.clone(), account.clone()),
                ))
            }
            Some(Pending::Endpoint { connection, secret }) => Ok((
                Connection::Endpoint(connection.clone()),
                self.endpoint_provider(connection, secret.clone())?,
            )),
            Some(Pending::S3 { connection, secret }) => Ok((
                Connection::S3(connection.clone()),
                self.s3_provider(connection, secret.clone())?,
            )),
        }
    }

    /// Keep a pending connection: its refresh token, the endpoint's password or token, or the
    /// S3 secret access key goes to the secret vault.
    pub(crate) fn keep(&self, connection_id: &str) -> Result<(), ArchiveError> {
        let Some(pending) = lock(&self.pending).remove(connection_id) else {
            return Err(ArchiveError::CloudAuth(EXPIRED.into()));
        };
        let name = credential_name(connection_id);
        match pending {
            Pending::OAuth { tokens, .. } => {
                tokens.persist(self.credentials.clone(), name)?;
                lock(&self.live).insert(connection_id.to_string(), tokens);
            }
            Pending::Endpoint {
                secret: Some(secret),
                ..
            }
            | Pending::S3 { secret, .. } => self.credentials.set(&name, &secret)?,
            Pending::Endpoint { secret: None, .. } => {}
        }
        Ok(())
    }

    /// Drop a pending connection the user did not use, revoking its grant where that is
    /// this device's alone (see [`Self::revoke`]).
    pub(crate) fn discard(&self, connection_id: &str) {
        if let Some(Pending::OAuth { kind, tokens, .. }) = lock(&self.pending).remove(connection_id)
        {
            self.revoke(kind, tokens);
        }
    }

    /// A kept endpoint's provider, with its secret from the vault.
    pub(crate) fn open_endpoint(
        &self,
        connection: &EndpointConnection,
    ) -> Result<Box<dyn ArchiveProvider>, ArchiveError> {
        let secret = if connection.auth.needs_secret() {
            Some(self.stored_secret(
                &connection.connection_id,
                "the backup endpoint's password or token",
            )?)
        } else {
            None
        };
        self.endpoint_provider(connection, secret)
    }

    /// A kept bucket's provider, with its secret access key from the vault.
    pub(crate) fn open_s3(
        &self,
        connection: &S3Connection,
    ) -> Result<Box<dyn ArchiveProvider>, ArchiveError> {
        let secret = self.stored_secret(&connection.connection_id, "the S3 secret access key")?;
        self.s3_provider(connection, secret)
    }

    /// A kept connection's secret from the vault; `what` names it when it is gone.
    fn stored_secret(
        &self,
        connection_id: &str,
        what: &str,
    ) -> Result<Zeroizing<String>, ArchiveError> {
        self.credentials
            .get(&credential_name(connection_id))?
            .ok_or_else(|| ArchiveError::CloudAuth(format!("this device no longer holds {what}")))
    }

    /// Forget a kept endpoint's password or token, or a bucket's secret access key.
    pub(crate) fn forget_secret(&self, connection_id: &str) -> Result<(), ArchiveError> {
        self.credentials.delete(&credential_name(connection_id))
    }

    fn endpoint_http(&self, policy: RetryPolicy) -> Result<Http, ArchiveError> {
        Http::new(endpoint::SERVICE, policy, http::no_extra_retries)
    }

    fn s3_http(&self, policy: RetryPolicy) -> Result<Http, ArchiveError> {
        Http::new(s3::SERVICE, policy, s3::is_retryable_conflict)
    }

    fn s3_provider(
        &self,
        connection: &S3Connection,
        secret: Zeroizing<String>,
    ) -> Result<Box<dyn ArchiveProvider>, ArchiveError> {
        Ok(Box::new(S3Provider::new(
            self.s3_http(self.settings.retry)?,
            connection,
            secret,
        )?))
    }

    fn endpoint_provider(
        &self,
        connection: &EndpointConnection,
        secret: Option<Zeroizing<String>>,
    ) -> Result<Box<dyn ArchiveProvider>, ArchiveError> {
        Ok(Box::new(EndpointProvider::new(
            self.endpoint_http(self.settings.retry)?,
            connection,
            secret,
        )?))
    }

    /// A kept connection's provider.
    pub(crate) fn open(
        &self,
        kind: CloudKind,
        connection: &CloudConnection,
    ) -> Result<Box<dyn ArchiveProvider>, ArchiveError> {
        let tokens = self.live_tokens(kind, &connection.connection_id)?;
        Ok(self.provider(kind, tokens, connection.account.clone()))
    }

    /// Sign a kept connection out: forget its refresh token, then revoke its grant where that
    /// is this device's alone (see [`Self::revoke`]). The local wipe comes first, so a revoke
    /// that hangs or fails, or the app quitting meanwhile, cannot leave the token behind.
    pub(crate) fn forget(&self, kind: CloudKind, connection_id: &str) -> Result<(), ArchiveError> {
        let tokens = self.live_tokens(kind, connection_id).ok();
        lock(&self.live).remove(connection_id);
        let deleted = self.credentials.delete(&credential_name(connection_id));
        if let Some(tokens) = tokens {
            self.revoke(kind, tokens);
        }
        deleted
    }

    fn live_tokens(
        &self,
        kind: CloudKind,
        connection_id: &str,
    ) -> Result<Arc<TokenSource>, ArchiveError> {
        if let Some(tokens) = lock(&self.live).get(connection_id) {
            return Ok(tokens.clone());
        }
        let name = credential_name(connection_id);
        let refresh = self.credentials.get(&name)?.ok_or_else(|| {
            ArchiveError::CloudAuth(format!(
                "this device is no longer signed in to {}",
                kind.service()
            ))
        })?;
        let tokens = Arc::new(TokenSource::from_refresh_token(
            self.settings.oauth_app(kind)?,
            Arc::new(self.settings.http(kind, self.settings.retry)?),
            refresh,
            self.credentials.clone(),
            name,
        ));
        lock(&self.live).insert(connection_id.to_string(), tokens.clone());
        Ok(tokens)
    }

    fn provider(
        &self,
        kind: CloudKind,
        tokens: Arc<TokenSource>,
        account: String,
    ) -> Box<dyn ArchiveProvider> {
        match kind {
            CloudKind::GoogleDrive => Box::new(GoogleDriveProvider::new(
                tokens,
                self.settings.drive.clone(),
                account,
            )),
            CloudKind::Dropbox => Box::new(DropboxProvider::new(
                tokens,
                self.settings.dropbox_api.clone(),
                account,
            )),
        }
    }

    fn account_email(
        &self,
        kind: CloudKind,
        tokens: Arc<TokenSource>,
    ) -> Result<String, ArchiveError> {
        match kind {
            CloudKind::GoogleDrive => {
                GoogleDriveProvider::account_email(tokens, &self.settings.drive)
            }
            CloudKind::Dropbox => {
                DropboxProvider::account_email(tokens, &self.settings.dropbox_api)
            }
        }
    }

    /// Revoke a connection's grant at the provider: best effort and tried once, since the
    /// user is disconnecting either way.
    ///
    /// Only Dropbox is revoked. Google revokes per project, not per token: revoking any one
    /// token removes the user's whole grant to the OAuth client and invalidates the refresh
    /// tokens of every other device signed in to that account, so stopping backups on one
    /// device would stop them on all. A Google sign-in is only forgotten locally; the user
    /// removes RIM's access everywhere in their Google account settings.
    fn revoke(&self, kind: CloudKind, tokens: Arc<TokenSource>) {
        if kind == CloudKind::GoogleDrive {
            return;
        }
        let http = match self.settings.http(kind, RetryPolicy::ONCE) {
            Ok(http) => http,
            Err(e) => return log::warn!("[history_archive] cannot revoke: {e}"),
        };
        if let Err(e) = DropboxProvider::revoke(&http, &tokens, &self.settings.dropbox_api) {
            log::warn!("[history_archive] {} revoke failed: {e}", kind.service());
        }
    }
}
