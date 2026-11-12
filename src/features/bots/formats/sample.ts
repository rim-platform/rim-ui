/** The most field names a sample offers as suggestions. */
export const MAX_SAMPLE_PATHS = 500;

/** The most items of one list a sample's field names reach into. */
const ITEMS_PER_LIST = 3;

const PATH_PART = /^[A-Za-z0-9_-]+$/;

/**
 * The paths a format can name in `body`, a sample delivery's text, for the field and placeholder
 * suggestions: keys with dots between them and list indexes, leaves and branches both, at most
 * {@link MAX_SAMPLE_PATHS}. A key a path can't hold is skipped. Nothing for a body that isn't
 * JSON. Read only to offer names; nothing here is sent anywhere.
 */
export function samplePaths(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const paths: string[] = [];
  const walk = (value: unknown, prefix: string) => {
    if (paths.length >= MAX_SAMPLE_PATHS) return;
    const visit = (part: string, child: unknown) => {
      if (paths.length >= MAX_SAMPLE_PATHS || !PATH_PART.test(part)) return;
      const path = prefix ? `${prefix}.${part}` : part;
      paths.push(path);
      walk(child, path);
    };
    if (Array.isArray(value)) {
      value.slice(0, ITEMS_PER_LIST).forEach((child, index) => visit(String(index), child));
    } else if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) visit(key, child);
    }
  };
  walk(parsed, "");
  return paths;
}

/** A sample's headers as `Name: value` lines, one header a line. */
export function headersToLines(headers: { name: string; value: string }[]): string {
  return headers.map((h) => `${h.name}: ${h.value}`).join("\n");
}

/** `Name: value` lines read back into headers; a line with no colon or no name is skipped. */
export function linesToHeaders(lines: string): { name: string; value: string }[] {
  return lines
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf(":");
      if (at <= 0) return null;
      const name = line.slice(0, at).trim();
      return name ? { name, value: line.slice(at + 1).trim() } : null;
    })
    .filter((header): header is { name: string; value: string } => header !== null);
}

/** Whether a delivery's `Content-Type` is a form-encoded body, the usual reason it isn't JSON. */
export function isFormEncoded(contentType: string | null | undefined): boolean {
  return (contentType ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
}

/** The event a delivery's headers name, such as GitHub's `x-github-event`, if one does. */
export function eventOf(headers: { name: string; value: string }[]): string | null {
  return headers.find((h) => /event/i.test(h.name))?.value ?? null;
}

/** A body for reading: indented when it is JSON, else as it came. */
export function readableBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
