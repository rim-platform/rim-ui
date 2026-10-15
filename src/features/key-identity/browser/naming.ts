/**
 * Names the browser key backend gives and checks: the endpoint as an absolute URL, a login
 * proof's audience, device names and ids.
 */

/** The endpoint resolved against this page, so a relative `/api` reads as the absolute URL. */
export function absoluteEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.includes("://")) return trimmed;
  try {
    return new URL(trimmed, window.location.origin).href;
  } catch {
    return trimmed;
  }
}

/** The `host[:port]` of the endpoint URL as written, lowercased: a login proof's `audience`. */
export function audience(endpoint: string): string {
  const absolute = absoluteEndpoint(endpoint);
  const invalid = () => new Error(`not an absolute server URL: ${endpoint}`);
  const at = absolute.indexOf("://");
  if (at < 0) throw invalid();
  const authority = absolute
    .slice(at + 3)
    .split(/[/?#]/)[0]
    .split("@")
    .pop();
  if (!authority) throw invalid();
  return authority.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** A device name as certificates allow it: trimmed, 1 to 64 characters, no control characters. */
export function deviceName(name: string): string {
  const kept = Array.from(name.trim())
    .filter((c) => !/\p{Cc}/u.test(c))
    .slice(0, 64)
    .join("")
    .trim();
  if (!kept) throw new Error("give this device a name");
  return kept;
}

/** This browser and system, as the default device name ("Firefox on Linux"). */
export function browserDeviceName(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS|Macintosh/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return system ? `${browser} on ${system}` : `${browser}`;
}

/** A UUID v7: the time in milliseconds, then random bits. */
export function uuidV7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
