/** Schemes a rendered link may point at. */
const LINK_SCHEMES = new Set(["http", "https", "mailto"]);
/** Schemes rendered media may load from. */
const MEDIA_SCHEMES = new Set(["http", "https"]);

/** The URL's scheme in lower case, ignoring the whitespace and controls browsers ignore. */
function schemeOf(url: string): string | null {
  // eslint-disable-next-line no-control-regex
  const compact = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  return match ? match[1].toLowerCase() : null;
}

function allowed(url: string, schemes: Set<string>): boolean {
  const scheme = schemeOf(url);
  return scheme === null || schemes.has(scheme);
}

/** True when a link may open `url`: http(s), mailto or a relative reference. */
export function isSafeLinkUrl(url: string): boolean {
  return allowed(url, LINK_SCHEMES);
}

/** True when an image in rendered Markdown may load from `url`: http(s) or a relative reference. */
export function isSafeMediaUrl(url: string): boolean {
  return allowed(url, MEDIA_SCHEMES);
}

/** True for an absolute http(s) URL, the only kind a server-supplied preview may use. */
export function isHttpUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === "http" || scheme === "https";
}
