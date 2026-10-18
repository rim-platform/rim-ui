//! Fetching a `.rimbundle` link for **Install from link** on the desktop.
//!
//! The webview cannot read a bundle from a host that sends no
//! `Access-Control-Allow-Origin`, such as a GitHub release asset, so the host
//! fetches it instead: `https://` only, redirects followed only to `https://`,
//! no cookies, no credentials and no headers beyond reqwest's own, at most
//! [`MAX_BUNDLE_BYTES`], within [`FETCH_TIMEOUT`]. The bytes are returned only
//! when they hash to the link's `#sha256=` pin, so the command reads nothing the
//! caller could not already name by its hash.

use crate::plugin_host::bundle::{bundle_sha256, MAX_BUNDLE_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::redirect::{Attempt, Policy};
use reqwest::Url;
use std::time::Duration;

/// Wall-clock cap on one bundle fetch, redirects and body included.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(120);
/// Cap on connecting to the bundle's server.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Most redirects one fetch follows.
pub const MAX_REDIRECTS: usize = 10;

/// Why a bundle link was not fetched. The message is shown to the user as it is.
#[derive(Debug, thiserror::Error)]
pub enum BundleFetchError {
    #[error("A plugin link must start with https://.")]
    Scheme,
    #[error("A plugin link must not carry a user name or password.")]
    Credentials,
    #[error("The bundle's server redirected to a link that does not start with https://.")]
    Redirect,
    #[error("The bundle's server redirected more than {MAX_REDIRECTS} times.")]
    TooManyRedirects,
    #[error("The bundle is over {} MiB.", MAX_BUNDLE_BYTES / (1024 * 1024))]
    TooLarge,
    #[error("The bundle's server answered {0}.")]
    Status(u16),
    #[error("The bundle could not be fetched: {0}")]
    Network(String),
    #[error(
        "A plugin link must end with #sha256= and the bundle's 64-character SHA-256, in lowercase."
    )]
    Pin,
    #[error("The bundle does not match the SHA-256 in the link.")]
    HashMismatch,
}

impl serde::Serialize for BundleFetchError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// A redirect the policy stopped, carried out of reqwest as the error's source.
#[derive(Debug, thiserror::Error)]
#[error("redirect refused: {0}")]
struct RedirectRefused(&'static str);

/// What one fetch allows: the only scheme, the largest body and the time limit.
#[derive(Debug, Clone, Copy)]
struct FetchRules {
    scheme: &'static str,
    max_bytes: usize,
    timeout: Duration,
}

/// The rules of a pasted link.
const LINK_RULES: FetchRules = FetchRules {
    scheme: "https",
    max_bytes: MAX_BUNDLE_BYTES,
    timeout: FETCH_TIMEOUT,
};

/// Fetches the bundle at `url` and returns its bytes as base64, once they hash
/// to `sha256` (64 lowercase hex digits, the link's `#sha256=` value).
///
/// # Errors
///
/// Returns a [`BundleFetchError`] for a link that is not `https://` or carries
/// credentials, a redirect to another scheme or past [`MAX_REDIRECTS`], a body
/// over [`MAX_BUNDLE_BYTES`], a status other than success, a network failure or
/// timeout, a malformed pin, and bytes that do not hash to the pin.
#[tauri::command]
pub async fn plugin_fetch_bundle(url: String, sha256: String) -> Result<String, BundleFetchError> {
    let bytes = fetch_bundle(&url, &sha256, LINK_RULES).await?;
    Ok(STANDARD.encode(bytes))
}

/// The host of a URL for the audit log, without its path or query, which may carry a signature.
fn host_of(url: &Url) -> &str {
    url.host_str().unwrap_or("-")
}

/// Logs a refused fetch to the audit log.
fn audit_refused(host: &str, reason: &str) {
    log::warn!("[AUDIT] event=plugin_bundle_fetch_refused host={host} reason={reason}");
}

/// Whether a URL carries a user name or password.
fn has_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

/// Whether `pin` is 64 lowercase hex digits.
fn is_pin(pin: &str) -> bool {
    pin.len() == 64 && pin.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The redirect policy of `rules`: follow only to its scheme, without
/// credentials in the URL, at most [`MAX_REDIRECTS`] times.
fn redirect_policy(rules: FetchRules) -> Policy {
    Policy::custom(move |attempt: Attempt| {
        if attempt.url().scheme() != rules.scheme {
            audit_refused(host_of(attempt.url()), "redirect_scheme");
            attempt.error(RedirectRefused("scheme"))
        } else if has_credentials(attempt.url()) {
            audit_refused(host_of(attempt.url()), "redirect_credentials");
            attempt.error(RedirectRefused("credentials"))
        } else if attempt.previous().len() > MAX_REDIRECTS {
            audit_refused(host_of(attempt.url()), "redirect_limit");
            attempt.error(RedirectRefused("limit"))
        } else {
            attempt.follow()
        }
    })
}

/// A reqwest failure as a [`BundleFetchError`]: a redirect the policy refused
/// keeps its reason, anything else is a network failure.
fn send_error(error: reqwest::Error) -> BundleFetchError {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(&error);
    while let Some(e) = source {
        if let Some(RedirectRefused(reason)) = e.downcast_ref::<RedirectRefused>() {
            return match *reason {
                "limit" => BundleFetchError::TooManyRedirects,
                _ => BundleFetchError::Redirect,
            };
        }
        source = e.source();
    }
    if error.is_timeout() {
        return BundleFetchError::Network("it took too long".into());
    }
    BundleFetchError::Network(error.without_url().to_string())
}

/// Fetches `url` under `rules` and checks the bytes against `pin`.
///
/// # Errors
///
/// As [`plugin_fetch_bundle`].
async fn fetch_bundle(
    url: &str,
    pin: &str,
    rules: FetchRules,
) -> Result<Vec<u8>, BundleFetchError> {
    if !is_pin(pin) {
        return Err(BundleFetchError::Pin);
    }
    let url = Url::parse(url.trim()).map_err(|_| BundleFetchError::Scheme)?;
    if url.scheme() != rules.scheme {
        audit_refused(host_of(&url), "scheme");
        return Err(BundleFetchError::Scheme);
    }
    if has_credentials(&url) {
        audit_refused(host_of(&url), "credentials");
        return Err(BundleFetchError::Credentials);
    }
    let client = reqwest::Client::builder()
        .timeout(rules.timeout)
        .connect_timeout(CONNECT_TIMEOUT.min(rules.timeout))
        .redirect(redirect_policy(rules))
        .referer(false)
        .build()
        .map_err(|e| BundleFetchError::Network(e.to_string()))?;
    let mut response = client.get(url).send().await.map_err(send_error)?;
    // reqwest returns a redirect to a scheme it cannot fetch (`file:`, `data:`) as
    // the response itself, without asking the policy.
    if response.status().is_redirection()
        && response.headers().contains_key(reqwest::header::LOCATION)
    {
        audit_refused(host_of(response.url()), "redirect_scheme");
        return Err(BundleFetchError::Redirect);
    }
    if !response.status().is_success() {
        return Err(BundleFetchError::Status(response.status().as_u16()));
    }
    let host = host_of(response.url()).to_string();
    let too_large = |host: &str| {
        audit_refused(host, "too_large");
        BundleFetchError::TooLarge
    };
    if response
        .content_length()
        .is_some_and(|len| len > rules.max_bytes as u64)
    {
        return Err(too_large(&host));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(send_error)? {
        if bytes.len() + chunk.len() > rules.max_bytes {
            return Err(too_large(&host));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bundle_sha256(&bytes) != pin {
        audit_refused(&host, "hash_mismatch");
        return Err(BundleFetchError::HashMismatch);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// Rules for a plain-HTTP server on the loopback interface, with a 1 KiB cap.
    const TEST_RULES: FetchRules = FetchRules {
        scheme: "http",
        max_bytes: 1024,
        timeout: Duration::from_secs(5),
    };

    /// Serves each raw response in turn on a fresh loopback port, one per
    /// connection, and returns the server's base URL. A response may name the
    /// base URL as `{base}`.
    fn serve(responses: Vec<Vec<u8>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let base_for_thread = base.clone();
        thread::spawn(move || {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                let text = String::from_utf8_lossy(&response).replace("{base}", &base_for_thread);
                let _ = stream.write_all(text.as_bytes());
            }
        });
        base
    }

    fn ok(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn redirect(location: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
        .into_bytes()
    }

    /// A body of `len` bytes sent without a `Content-Length`, ended by closing the connection.
    fn undeclared(len: usize) -> Vec<u8> {
        let mut response = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
        response.extend(std::iter::repeat_n(b'x', len));
        response
    }

    #[test]
    fn link_rules_cap_at_the_bundle_limit() {
        assert_eq!(LINK_RULES.scheme, "https");
        assert_eq!(LINK_RULES.max_bytes, MAX_BUNDLE_BYTES);
        assert_eq!(LINK_RULES.timeout, FETCH_TIMEOUT);
    }

    #[tokio::test]
    async fn a_link_of_another_scheme_is_refused_before_any_request() {
        let pin = bundle_sha256(b"x");
        for link in [
            "http://example.com/a.rimbundle",
            "file:///etc/passwd",
            "ftp://example.com/a.rimbundle",
            "not a link",
        ] {
            let err = fetch_bundle(link, &pin, LINK_RULES).await.unwrap_err();
            assert!(matches!(err, BundleFetchError::Scheme), "{link}: {err}");
        }
    }

    #[tokio::test]
    async fn a_link_with_credentials_is_refused() {
        let pin = bundle_sha256(b"x");
        let err = fetch_bundle(
            "https://user:secret@example.com/a.rimbundle",
            &pin,
            LINK_RULES,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, BundleFetchError::Credentials));
    }

    #[tokio::test]
    async fn a_malformed_pin_is_refused() {
        for pin in ["", "abc", &"A".repeat(64), &"g".repeat(64)] {
            let err = fetch_bundle("https://example.com/a.rimbundle", pin, LINK_RULES)
                .await
                .unwrap_err();
            assert!(matches!(err, BundleFetchError::Pin), "{pin}");
        }
    }

    #[tokio::test]
    async fn bytes_matching_the_pin_are_returned() {
        let body = b"{\"format\":\"rim-plugin-bundle\"}";
        let base = serve(vec![ok(body)]);
        let bytes = fetch_bundle(
            &format!("{base}/a.rimbundle"),
            &bundle_sha256(body),
            TEST_RULES,
        )
        .await
        .unwrap();
        assert_eq!(bytes, body);
    }

    #[tokio::test]
    async fn bytes_not_matching_the_pin_are_refused() {
        let base = serve(vec![ok(b"tampered")]);
        let err = fetch_bundle(
            &format!("{base}/a"),
            &bundle_sha256(b"original"),
            TEST_RULES,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, BundleFetchError::HashMismatch));
    }

    #[tokio::test]
    async fn a_redirect_to_the_same_scheme_is_followed() {
        let body = b"bundle";
        let base = serve(vec![redirect("{base}/asset"), ok(body)]);
        let bytes = fetch_bundle(&format!("{base}/a"), &bundle_sha256(body), TEST_RULES)
            .await
            .unwrap();
        assert_eq!(bytes, body);
    }

    #[tokio::test]
    async fn a_redirect_to_another_scheme_is_refused() {
        let pin = bundle_sha256(b"x");
        for location in [
            "https://example.com/a.rimbundle",
            "file:///etc/passwd",
            "ftp://example.com/a",
            "data:text/plain,x",
        ] {
            let base = serve(vec![redirect(location)]);
            let err = fetch_bundle(&format!("{base}/a"), &pin, TEST_RULES)
                .await
                .unwrap_err();
            assert!(
                matches!(err, BundleFetchError::Redirect),
                "{location}: {err}"
            );
        }
    }

    #[tokio::test]
    async fn a_redirect_carrying_credentials_is_refused() {
        let base = serve(vec![redirect("http://user:secret@127.0.0.1:1/a")]);
        let err = fetch_bundle(&format!("{base}/a"), &bundle_sha256(b"x"), TEST_RULES)
            .await
            .unwrap_err();
        assert!(matches!(err, BundleFetchError::Redirect), "{err}");
    }

    #[tokio::test]
    async fn too_many_redirects_are_refused() {
        let hops = (0..=MAX_REDIRECTS + 1)
            .map(|_| redirect("{base}/again"))
            .collect();
        let base = serve(hops);
        let err = fetch_bundle(&format!("{base}/a"), &bundle_sha256(b"x"), TEST_RULES)
            .await
            .unwrap_err();
        assert!(matches!(err, BundleFetchError::TooManyRedirects), "{err}");
    }

    #[tokio::test]
    async fn a_declared_length_over_the_cap_is_refused() {
        let body = vec![b'x'; TEST_RULES.max_bytes + 1];
        let base = serve(vec![ok(&body)]);
        let err = fetch_bundle(&format!("{base}/a"), &bundle_sha256(&body), TEST_RULES)
            .await
            .unwrap_err();
        assert!(matches!(err, BundleFetchError::TooLarge));
    }

    #[tokio::test]
    async fn an_undeclared_body_over_the_cap_is_refused() {
        let base = serve(vec![undeclared(TEST_RULES.max_bytes * 4)]);
        let err = fetch_bundle(&format!("{base}/a"), &bundle_sha256(b"x"), TEST_RULES)
            .await
            .unwrap_err();
        assert!(matches!(err, BundleFetchError::TooLarge));
    }

    #[tokio::test]
    async fn a_body_at_the_cap_is_read() {
        let body = vec![b'x'; TEST_RULES.max_bytes];
        let base = serve(vec![undeclared(body.len())]);
        let bytes = fetch_bundle(&format!("{base}/a"), &bundle_sha256(&body), TEST_RULES)
            .await
            .unwrap();
        assert_eq!(bytes.len(), TEST_RULES.max_bytes);
    }

    #[tokio::test]
    async fn an_error_status_is_refused() {
        let base = serve(vec![
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        ]);
        let err = fetch_bundle(&format!("{base}/a"), &bundle_sha256(b"x"), TEST_RULES)
            .await
            .unwrap_err();
        assert!(matches!(err, BundleFetchError::Status(404)));
    }

    #[tokio::test]
    async fn a_server_that_never_answers_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let rules = FetchRules {
            timeout: Duration::from_millis(300),
            ..TEST_RULES
        };
        let err = fetch_bundle(&format!("{base}/a"), &bundle_sha256(b"x"), rules)
            .await
            .unwrap_err();
        assert!(matches!(err, BundleFetchError::Network(_)), "{err}");
        drop(listener);
    }

    #[test]
    fn errors_serialize_as_their_message() {
        let json = serde_json::to_string(&BundleFetchError::Status(403)).unwrap();
        assert_eq!(json, "\"The bundle's server answered 403.\"");
        assert_eq!(
            BundleFetchError::TooLarge.to_string(),
            "The bundle is over 8 MiB."
        );
    }
}
