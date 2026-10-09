//! Link previews of encrypted messages, fetched by the sender's device: the server never sees
//! an encrypted message's links, and receivers never fetch. Only the page's head is read, at
//! most 512 KiB, within 5 seconds.

use serde::Serialize;

use super::{E2eeError, Result};

const MAX_BYTES: usize = 512 * 1024;
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
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

/// Fetch `url` and read its preview; `None` when the page says nothing worth showing.
#[tauri::command]
pub async fn e2ee_link_preview(url: String) -> Result<Option<LinkPreviewView>> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| E2eeError::Invalid("not a URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(E2eeError::Invalid("only http and https links".into()));
    }
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| E2eeError::Invalid(e.to_string()))?;
    let mut response = match client.get(parsed).send().await {
        Ok(response) if response.status().is_success() => response,
        _ => return Ok(None),
    };
    let is_html = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("html"));
    if !is_html {
        return Ok(None);
    }
    let mut body = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BYTES || contains(&body, b"</head>") {
            break;
        }
    }
    let preview = parse_preview(&url, &String::from_utf8_lossy(&body));
    Ok((preview.title.is_some() || preview.description.is_some()).then_some(preview))
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
    use super::*;

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
