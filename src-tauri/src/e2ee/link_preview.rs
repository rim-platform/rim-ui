//! Link previews of encrypted messages, fetched by the sender's device: the server never sees
//! an encrypted message's links, and receivers never fetch. Only the page's head is read, at
//! most 512 KiB, within 5 seconds for the whole fetch. Only public internet addresses are
//! reached: each hop's host is resolved and checked first, the connection goes to the checked
//! addresses, and at most 3 redirects are followed, each checked the same way.

use std::net::SocketAddr;
use std::sync::Arc;

use reqwest::dns::{Name, Resolve, Resolving};
use reqwest::Url;
use serde::Serialize;

use super::{E2eeError, Result};
use crate::outbound::is_public_address;

const MAX_BYTES: usize = 512 * 1024;
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// Most redirects followed before the fetch gives up.
const MAX_REDIRECTS: usize = 3;
/// Longest preview field, in characters (the content's limit).
const MAX_FIELD: usize = 2_000;

/// A link preview as the content carries it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkPreviewView {
    pub url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
}

/// Fetch `url` and read its preview; `None` when the page says nothing worth showing, cannot be
/// reached, or is on an address outside the public internet.
///
/// # Errors
///
/// [`E2eeError::Invalid`] when `url` is not an `http` or `https` URL.
#[tauri::command]
pub async fn e2ee_link_preview(url: String) -> Result<Option<LinkPreviewView>> {
    let parsed = Url::parse(&url).map_err(|_| E2eeError::Invalid("not a URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(E2eeError::Invalid("only http and https links".into()));
    }
    Ok(fetch_preview(parsed, &url, |addr| is_public_address(addr.ip())).await)
}

/// Fetch `start`, following redirects by hand, and read the final page's preview under `url`.
/// `allowed` decides which addresses may be connected to; a hop with any address it refuses
/// ends the fetch.
async fn fetch_preview<F>(start: Url, url: &str, allowed: F) -> Option<LinkPreviewView>
where
    F: Fn(SocketAddr) -> bool,
{
    let fetch = async {
        let mut target = start;
        for _ in 0..=MAX_REDIRECTS {
            let client = pinned_client(&target, &allowed).await?;
            let response = client.get(target.clone()).send().await.ok()?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)?
                    .to_str()
                    .ok()?;
                target = target.join(location).ok()?;
                if !matches!(target.scheme(), "http" | "https") {
                    return None;
                }
                continue;
            }
            if !response.status().is_success() {
                return None;
            }
            return read_preview(response, url).await;
        }
        None
    };
    tokio::time::timeout(TIMEOUT, fetch).await.ok().flatten()
}

/// A client for one request to `target`: no proxy, no redirects, and its host resolved here,
/// checked with `allowed` and pinned, so the connection goes to the checked addresses only.
/// `None` when the host cannot be resolved or any of its addresses is refused.
async fn pinned_client<F>(target: &Url, allowed: &F) -> Option<reqwest::Client>
where
    F: Fn(SocketAddr) -> bool,
{
    let port = target.port_or_known_default()?;
    let mut builder = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        // A proxy would resolve and reach the target itself, past the address check.
        .no_proxy()
        .dns_resolver(Arc::new(NoResolver));
    match target.host()? {
        url::Host::Ipv4(ip) => allowed(SocketAddr::new(ip.into(), port)).then_some(())?,
        url::Host::Ipv6(ip) => allowed(SocketAddr::new(ip.into(), port)).then_some(())?,
        url::Host::Domain(name) => {
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((name, port)).await.ok()?.collect();
            if addrs.is_empty() || !addrs.iter().all(|addr| allowed(*addr)) {
                return None;
            }
            builder = builder.resolve_to_addrs(name, &addrs);
        }
    }
    builder.build().ok()
}

/// A resolver that resolves nothing: every name a fetch reaches is pinned beforehand, so any
/// other lookup is refused.
struct NoResolver;

impl Resolve for NoResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let name = name.as_str().to_string();
        Box::pin(async move { Err(format!("{name} was not checked before connecting").into()) })
    }
}

/// Read an HTML response's head and its preview; `None` for another type or an empty preview.
async fn read_preview(mut response: reqwest::Response, url: &str) -> Option<LinkPreviewView> {
    let is_html = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("html"));
    if !is_html {
        return None;
    }
    let mut body = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BYTES || contains(&body, b"</head>") {
            break;
        }
    }
    let preview = parse_preview(url, &String::from_utf8_lossy(&body));
    (preview.title.is_some() || preview.description.is_some()).then_some(preview)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w.eq_ignore_ascii_case(needle))
}

/// Read the Open Graph tags (and `<title>`) of an HTML head.
pub(crate) fn parse_preview(url: &str, html: &str) -> LinkPreviewView {
    let mut preview = LinkPreviewView {
        url: Some(url.chars().take(MAX_FIELD).collect()),
        ..LinkPreviewView::default()
    };
    let lower = html.to_ascii_lowercase();
    let mut rest = 0;
    while let Some(start) = lower[rest..].find("<meta") {
        let start = rest + start;
        let Some(end) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + end];
        rest = start + end;
        let key = attribute(tag, "property").or_else(|| attribute(tag, "name"));
        let Some(content) = attribute(tag, "content") else {
            continue;
        };
        let slot = match key.as_deref().map(str::to_ascii_lowercase).as_deref() {
            Some("og:title") => &mut preview.title,
            Some("og:description") | Some("description") => &mut preview.description,
            Some("og:site_name") => &mut preview.site_name,
            _ => continue,
        };
        if slot.is_none() {
            *slot = clean(&content);
        }
    }
    if preview.title.is_none() {
        if let (Some(open), Some(close)) = (lower.find("<title"), lower.find("</title>")) {
            if let Some(gt) = lower[open..].find('>') {
                let from = open + gt + 1;
                if from <= close {
                    preview.title = clean(&html[from..close]);
                }
            }
        }
    }
    preview
}

/// The value of `name="…"` (or single quotes) in a tag.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(name) {
        let at = from + at;
        from = at + name.len();
        let before_ok = at == 0 || lower.as_bytes()[at - 1].is_ascii_whitespace();
        let after = lower[from..].trim_start();
        if !before_ok || !after.starts_with('=') {
            continue;
        }
        let value = tag[tag.len() - after.len() + 1..].trim_start();
        let quote = value.chars().next()?;
        if quote != '"' && quote != '\'' {
            return value.split_whitespace().next().map(str::to_string);
        }
        let inner = &value[1..];
        return inner.find(quote).map(|end| inner[..end].to_string());
    }
    None
}

/// Entities decoded, whitespace collapsed, at most 2,000 characters; `None` when empty.
fn clean(text: &str) -> Option<String> {
    let decoded = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'");
    let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    (!collapsed.is_empty()).then(|| collapsed.chars().take(MAX_FIELD).collect())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    const PAGE: &str = "<html><head><title>internal</title></head></html>";

    /// A loopback HTTP server that answers each request with what `answer` makes of its path,
    /// and counts the connections it accepted.
    async fn serve(answer: fn(&str, u16) -> String) -> (u16, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let accepted = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&accepted);
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                count.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let read = socket.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..read]).to_string();
                    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let _ = socket.write_all(answer(&path, port).as_bytes()).await;
                });
            }
        });
        (port, accepted)
    }

    fn page() -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{PAGE}",
            PAGE.len()
        )
    }

    fn redirect(location: &str) -> String {
        format!(
            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
    }

    /// `/hops/N` redirects to `/hops/N-1`; `/hops/0` and every other path serve the page.
    fn hops(path: &str, _port: u16) -> String {
        match path
            .strip_prefix("/hops/")
            .and_then(|n| n.parse::<u32>().ok())
        {
            Some(n) if n > 0 => redirect(&format!("/hops/{}", n - 1)),
            _ => page(),
        }
    }

    #[tokio::test]
    async fn a_page_on_this_computer_is_never_fetched() {
        let (port, accepted) = serve(hops).await;
        for url in [
            format!("http://127.0.0.1:{port}/"),
            format!("http://localhost:{port}/"),
            format!("http://[::ffff:127.0.0.1]:{port}/"),
            format!("http://2130706433:{port}/"),
        ] {
            assert_eq!(
                e2ee_link_preview(url.clone()).await.ok(),
                Some(None),
                "{url}"
            );
        }
        assert_eq!(accepted.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_redirect_to_a_refused_address_is_not_followed() {
        let (inner, inner_accepted) = serve(hops).await;
        let (outer, outer_accepted) = serve(|path, _| {
            let inner = path.trim_start_matches('/');
            redirect(&format!("http://127.0.0.1:{inner}/"))
        })
        .await;
        let start = Url::parse(&format!("http://127.0.0.1:{outer}/{inner}")).expect("url");

        let only_outer = |addr: SocketAddr| addr.port() == outer;
        assert_eq!(fetch_preview(start.clone(), "u", only_outer).await, None);
        assert_eq!(outer_accepted.load(Ordering::SeqCst), 1);
        assert_eq!(inner_accepted.load(Ordering::SeqCst), 0);

        let both = |addr: SocketAddr| addr.port() == outer || addr.port() == inner;
        let preview = fetch_preview(start, "u", both).await.expect("followed");
        assert_eq!(preview.title.as_deref(), Some("internal"));
        assert_eq!(inner_accepted.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn at_most_three_redirects_are_followed() {
        let (port, accepted) = serve(hops).await;
        let any = |_: SocketAddr| true;
        let three = Url::parse(&format!("http://127.0.0.1:{port}/hops/3")).expect("url");
        let preview = fetch_preview(three, "u", any)
            .await
            .expect("three redirects");
        assert_eq!(preview.title.as_deref(), Some("internal"));
        assert_eq!(accepted.load(Ordering::SeqCst), 4);

        let four = Url::parse(&format!("http://127.0.0.1:{port}/hops/4")).expect("url");
        assert_eq!(fetch_preview(four, "u", any).await, None);
        assert_eq!(accepted.load(Ordering::SeqCst), 8);
    }

    #[tokio::test]
    async fn only_http_and_https_links_are_fetched() {
        assert!(e2ee_link_preview("file:///etc/passwd".into())
            .await
            .is_err());
        assert!(e2ee_link_preview("not a url".into()).await.is_err());
    }

    #[test]
    fn reads_open_graph_tags_and_falls_back_to_the_title() {
        let html = r#"<html><head><title>Plain &amp; simple</title>
            <meta property="og:title" content="Open Graph title">
            <meta name='description' content='A  page
               about things'>
            <meta property="og:site_name" content="Example"></head>"#;
        assert_eq!(
            parse_preview("https://example.com", html),
            LinkPreviewView {
                url: Some("https://example.com".into()),
                title: Some("Open Graph title".into()),
                description: Some("A page about things".into()),
                site_name: Some("Example".into()),
            }
        );
        let plain = parse_preview(
            "https://example.com",
            "<head><title> Plain &amp; simple </title>",
        );
        assert_eq!(plain.title.as_deref(), Some("Plain & simple"));
        assert_eq!(plain.description, None);
    }
}
