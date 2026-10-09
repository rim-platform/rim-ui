//! OAuth 2.0 for a desktop app (RFC 8252): the system browser signs the user in, a one-shot
//! HTTP listener on the loopback interface receives the authorization code, and PKCE (S256)
//! stands in for a client secret, which an installed app cannot keep.

use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::super::crypto::random_bytes;
use super::super::ArchiveError;
use super::http::Http;
use super::CredentialStore;

/// The path the loopback listener answers on.
pub(crate) const CALLBACK_PATH: &str = "/callback";

/// Refresh an access token this long before it expires.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// A provider's OAuth client: who the app is and where to send the user.
#[derive(Debug, Clone)]
pub(crate) struct OAuthApp {
    pub client_id: String,
    /// Google's "Desktop app" clients come with a secret that Google itself says is not
    /// confidential in an installed app, yet its token endpoint still asks for it. Dropbox
    /// needs none.
    pub client_secret: Option<String>,
    pub authorize_url: String,
    pub token_url: String,
    /// Space-separated.
    pub scopes: &'static str,
    /// Provider-specific parameters of the authorization request.
    pub extra: &'static [(&'static str, &'static str)],
}

/// What a token endpoint grants.
pub(crate) struct Grant {
    pub access_token: Zeroizing<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<Zeroizing<String>>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

/// A PKCE verifier and its S256 challenge.
pub(crate) struct Pkce {
    pub verifier: Zeroizing<String>,
    pub challenge: String,
}

impl Pkce {
    pub(crate) fn new() -> Result<Self, ArchiveError> {
        // 32 random bytes make a 43-character verifier, the shortest RFC 7636 allows.
        let verifier = Zeroizing::new(URL_SAFE_NO_PAD.encode(random_bytes::<32>()?));
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Ok(Self {
            verifier,
            challenge,
        })
    }
}

/// An unguessable `state` for one authorization request.
pub(crate) fn random_state() -> Result<String, ArchiveError> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes::<16>()?))
}

impl OAuthApp {
    pub(crate) fn authorize_url(
        &self,
        redirect_uri: &str,
        state: &str,
        pkce: &Pkce,
    ) -> Result<String, ArchiveError> {
        let mut params = vec![
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", redirect_uri),
            ("response_type", "code"),
            ("scope", self.scopes),
            ("state", state),
            ("code_challenge", pkce.challenge.as_str()),
            ("code_challenge_method", "S256"),
        ];
        params.extend(self.extra.iter().copied());
        reqwest::Url::parse_with_params(&self.authorize_url, &params)
            .map(String::from)
            .map_err(|e| ArchiveError::Invalid(format!("authorization url: {e}")))
    }

    /// Trade the authorization code for tokens.
    pub(crate) fn exchange(
        &self,
        http: &Http,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<Grant, ArchiveError> {
        self.token_request(
            http,
            &[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect_uri),
            ],
        )
    }

    pub(crate) fn refresh(&self, http: &Http, refresh_token: &str) -> Result<Grant, ArchiveError> {
        self.token_request(
            http,
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ],
        )
    }

    fn token_request(&self, http: &Http, params: &[(&str, &str)]) -> Result<Grant, ArchiveError> {
        let mut form: Vec<(&str, &str)> = params.to_vec();
        form.push(("client_id", &self.client_id));
        if let Some(secret) = &self.client_secret {
            form.push(("client_secret", secret));
        }
        let reply = http.send(|c| c.post(&self.token_url).form(&form))?;
        if reply.ok() {
            let token: TokenResponse = reply.json()?;
            return Ok(Grant {
                access_token: Zeroizing::new(token.access_token),
                expires_in: token.expires_in,
                refresh_token: token.refresh_token.map(Zeroizing::new),
            });
        }
        // RFC 6749: a refused grant is a 400 (or 401) naming the error.
        match serde_json::from_slice::<TokenError>(&reply.body) {
            Ok(e) if reply.status.is_client_error() => Err(ArchiveError::CloudAuth(format!(
                "{} refused the sign-in ({}{})",
                http.service(),
                e.error,
                e.error_description
                    .map(|d| format!(": {d}"))
                    .unwrap_or_default()
            ))),
            _ => Err(http.failure("token request", &reply)),
        }
    }
}

/// Access tokens for one connection, refreshed as they expire.
pub(crate) struct TokenSource {
    app: OAuthApp,
    http: Arc<Http>,
    refresh_token: Mutex<Zeroizing<String>>,
    access: Mutex<Option<(Zeroizing<String>, Instant)>>,
    /// Where a rotated refresh token is saved, once the connection is kept.
    persist: Mutex<Option<(Arc<dyn CredentialStore>, String)>>,
}

impl TokenSource {
    /// From a fresh grant; it must carry a refresh token, or backups would stop within the
    /// hour.
    pub(crate) fn from_grant(
        app: OAuthApp,
        http: Arc<Http>,
        grant: Grant,
    ) -> Result<Self, ArchiveError> {
        let refresh = grant.refresh_token.ok_or_else(|| {
            ArchiveError::CloudAuth(format!(
                "{} granted no offline access; sign in again",
                http.service()
            ))
        })?;
        let expires = Instant::now() + Duration::from_secs(grant.expires_in.unwrap_or(3_600));
        Ok(Self {
            app,
            http,
            refresh_token: Mutex::new(refresh),
            access: Mutex::new(Some((grant.access_token, expires))),
            persist: Mutex::new(None),
        })
    }

    /// From a refresh token kept in the secret vault.
    pub(crate) fn from_refresh_token(
        app: OAuthApp,
        http: Arc<Http>,
        refresh_token: Zeroizing<String>,
        store: Arc<dyn CredentialStore>,
        name: String,
    ) -> Self {
        Self {
            app,
            http,
            refresh_token: Mutex::new(refresh_token),
            access: Mutex::new(None),
            persist: Mutex::new(Some((store, name))),
        }
    }

    pub(crate) fn refresh_token(&self) -> Zeroizing<String> {
        lock(&self.refresh_token).clone()
    }

    /// Save the refresh token under `name` now and whenever the provider rotates it.
    pub(crate) fn persist(
        &self,
        store: Arc<dyn CredentialStore>,
        name: String,
    ) -> Result<(), ArchiveError> {
        store.set(&name, &self.refresh_token())?;
        *lock(&self.persist) = Some((store, name));
        Ok(())
    }

    /// A current access token, refreshed when it is about to expire.
    pub(crate) fn access_token(&self) -> Result<Zeroizing<String>, ArchiveError> {
        self.access_token_via(&self.http)
    }

    /// [`Self::access_token`], refreshing through `http` (another retry policy).
    pub(crate) fn access_token_via(&self, http: &Http) -> Result<Zeroizing<String>, ArchiveError> {
        let mut access = lock(&self.access);
        if let Some((token, expires)) = access.as_ref() {
            if *expires > Instant::now() + EXPIRY_MARGIN {
                return Ok(token.clone());
            }
        }
        let refresh = self.refresh_token();
        let grant = self.app.refresh(http, &refresh)?;
        if let Some(rotated) = grant.refresh_token {
            if *rotated != *refresh {
                if let Some((store, name)) = lock(&self.persist).as_ref() {
                    store.set(name, &rotated)?;
                }
                *lock(&self.refresh_token) = rotated;
            }
        }
        let expires = Instant::now() + Duration::from_secs(grant.expires_in.unwrap_or(3_600));
        *access = Some((grant.access_token.clone(), expires));
        Ok(grant.access_token)
    }

    /// Forget the access token: the provider refused it before it said it would expire.
    pub(crate) fn invalidate(&self) {
        *lock(&self.access) = None;
    }

    pub(crate) fn http(&self) -> &Http {
        &self.http
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

// ─── Loopback redirect ──────────────────────────────────────────────────────

/// The one-shot listener the provider redirects the browser to.
pub(crate) struct Loopback {
    listeners: Vec<TcpListener>,
    redirect_uri: String,
}

impl Loopback {
    /// Listen on `port` (0: any free port) of the loopback interface. `host` is what the
    /// redirect URI names: `127.0.0.1`, or `localhost` for providers that only accept that,
    /// in which case IPv6 `::1` is listened on too, since a browser may resolve it first.
    pub(crate) fn bind(host: &str, port: u16) -> Result<Self, ArchiveError> {
        let v4 = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).map_err(|e| {
            if e.kind() == ErrorKind::AddrInUse {
                ArchiveError::Unavailable(format!(
                    "port {port} on this computer is in use, and sign-in needs it; close the \
                     program using it and try again"
                ))
            } else {
                ArchiveError::Io(format!("cannot listen for the sign-in: {e}"))
            }
        })?;
        let port = v4
            .local_addr()
            .map_err(|e| ArchiveError::Io(e.to_string()))?
            .port();
        let mut listeners = vec![v4];
        if host == "localhost" {
            if let Ok(v6) = TcpListener::bind(SocketAddr::from((Ipv6Addr::LOCALHOST, port))) {
                listeners.push(v6);
            }
        }
        for listener in &listeners {
            listener
                .set_nonblocking(true)
                .map_err(|e| ArchiveError::Io(e.to_string()))?;
        }
        Ok(Self {
            listeners,
            redirect_uri: format!("http://{host}:{port}{CALLBACK_PATH}"),
        })
    }

    pub(crate) fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    /// Wait for the browser to come back with the authorization code for `state`. Requests
    /// for other paths, or carrying another state, are answered and ignored.
    pub(crate) fn wait(
        &self,
        state: &str,
        deadline: Instant,
        cancel: &AtomicBool,
    ) -> Result<Zeroizing<String>, ArchiveError> {
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(ArchiveError::Cancelled);
            }
            if Instant::now() >= deadline {
                return Err(ArchiveError::CloudAuth(
                    "the sign-in was not finished in time".into(),
                ));
            }
            let mut accepted = false;
            for listener in &self.listeners {
                match listener.accept() {
                    Ok((stream, _)) => {
                        accepted = true;
                        if let Some(result) = handle_callback(stream, state) {
                            return result;
                        }
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(e) => log::warn!("[history_archive] sign-in listener: {e}"),
                }
            }
            if !accepted {
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

/// Answer one request to the listener. `Some` when it carried the outcome of the sign-in.
fn handle_callback(
    mut stream: TcpStream,
    state: &str,
) -> Option<Result<Zeroizing<String>, ArchiveError>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut request = Vec::new();
    let mut buf = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") && request.len() < 16 * 1024 {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => request.extend_from_slice(&buf[..n]),
        }
    }
    let request = String::from_utf8_lossy(&request);
    let mut parts = request.lines().next().unwrap_or("").split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let url = reqwest::Url::parse(&format!("http://localhost{target}")).ok();
    let Some(url) = url.filter(|u| method == "GET" && u.path() == CALLBACK_PATH) else {
        respond(&mut stream, "404 Not Found", "Not found.");
        return None;
    };
    let param = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if param("state").as_deref() != Some(state) {
        respond(
            &mut stream,
            "400 Bad Request",
            "This is not the sign-in RIM is waiting for. Start it again from RIM.",
        );
        return None;
    }
    if let Some(error) = param("error") {
        respond(
            &mut stream,
            "200 OK",
            "Sign-in was cancelled. You can close this tab and return to RIM.",
        );
        return Some(Err(if error == "access_denied" {
            ArchiveError::Cancelled
        } else {
            ArchiveError::CloudAuth(format!("sign-in failed: {error}"))
        }));
    }
    match param("code") {
        Some(code) => {
            respond(
                &mut stream,
                "200 OK",
                "RIM is connected. You can close this tab and return to RIM.",
            );
            Some(Ok(Zeroizing::new(code)))
        }
        None => {
            respond(
                &mut stream,
                "400 Bad Request",
                "The sign-in carried no code.",
            );
            None
        }
    }
}

fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>RIM</title></head>\
         <body style=\"font-family:sans-serif;background:#111;color:#eee;padding:3em\">\
         <p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Play the browser: follow the redirect the provider would send to `redirect_uri`.
    pub(crate) fn browser_returns(redirect_uri: &str, query: &str) -> String {
        let url = reqwest::Url::parse(redirect_uri).unwrap();
        let port = url.port().unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "GET {}?{query} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n",
            url.path()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn pkce_challenge_is_the_s256_of_the_verifier() {
        let pkce = Pkce::new().unwrap();
        assert_eq!(pkce.verifier.len(), 43);
        assert_eq!(
            pkce.challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(pkce.verifier.as_bytes()))
        );
        assert_ne!(Pkce::new().unwrap().verifier, pkce.verifier);
    }

    #[test]
    fn the_authorization_url_carries_pkce_state_and_the_redirect() {
        let app = OAuthApp {
            client_id: "client-1".into(),
            client_secret: None,
            authorize_url: "https://auth.example/authorize".into(),
            token_url: "https://auth.example/token".into(),
            scopes: "a b",
            extra: &[("token_access_type", "offline")],
        };
        let pkce = Pkce::new().unwrap();
        let url = app
            .authorize_url("http://127.0.0.1:5000/callback", "st", &pkce)
            .unwrap();
        let url = reqwest::Url::parse(&url).unwrap();
        let get = |k: &str| {
            url.query_pairs()
                .find(|(n, _)| n == k)
                .map(|(_, v)| v.into_owned())
        };
        assert_eq!(get("client_id").as_deref(), Some("client-1"));
        assert_eq!(
            get("redirect_uri").as_deref(),
            Some("http://127.0.0.1:5000/callback")
        );
        assert_eq!(get("scope").as_deref(), Some("a b"));
        assert_eq!(get("state").as_deref(), Some("st"));
        assert_eq!(get("code_challenge"), Some(pkce.challenge.clone()));
        assert_eq!(get("code_challenge_method").as_deref(), Some("S256"));
        assert_eq!(get("token_access_type").as_deref(), Some("offline"));
    }

    #[test]
    fn the_listener_takes_the_code_for_its_state_only() {
        let loopback = Loopback::bind("127.0.0.1", 0).unwrap();
        let redirect = loopback.redirect_uri().to_string();
        let browser = thread::spawn(move || {
            let stray = browser_returns(&redirect.replace("/callback", "/favicon.ico"), "");
            let forged = browser_returns(&redirect, "code=evil&state=other");
            let real = browser_returns(&redirect, "code=c%2F1&state=st");
            (stray, forged, real)
        });
        let cancel = AtomicBool::new(false);
        let code = loopback
            .wait("st", Instant::now() + Duration::from_secs(10), &cancel)
            .unwrap();
        assert_eq!(code.as_str(), "c/1");
        let (stray, forged, real) = browser.join().unwrap();
        assert!(stray.starts_with("HTTP/1.1 404"));
        assert!(forged.starts_with("HTTP/1.1 400"));
        assert!(real.starts_with("HTTP/1.1 200") && real.contains("RIM is connected"));
    }

    #[test]
    fn a_denied_or_cancelled_sign_in_ends_the_wait() {
        let loopback = Loopback::bind("localhost", 0).unwrap();
        assert!(loopback.redirect_uri().starts_with("http://localhost:"));
        let redirect = loopback.redirect_uri().to_string();
        let browser =
            thread::spawn(move || browser_returns(&redirect, "error=access_denied&state=st"));
        let cancel = AtomicBool::new(false);
        let denied = loopback.wait("st", Instant::now() + Duration::from_secs(10), &cancel);
        assert!(matches!(denied, Err(ArchiveError::Cancelled)));
        browser.join().unwrap();

        cancel.store(true, Ordering::SeqCst);
        let cancelled = loopback.wait("st", Instant::now() + Duration::from_secs(10), &cancel);
        assert!(matches!(cancelled, Err(ArchiveError::Cancelled)));
        let late = loopback.wait("st", Instant::now(), &AtomicBool::new(false));
        assert!(matches!(late, Err(ArchiveError::CloudAuth(_))));
    }
}
