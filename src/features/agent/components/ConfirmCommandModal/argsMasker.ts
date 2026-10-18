/**
 * Frontend mirror of the backend's `mask_for_display` in
 * `rim_services::command::sensitivity`. Must stay in lockstep with the
 * backend regex + vendor-prefix list — drift produces the "value masked in
 * UI but logged plain" failure mode.
 *
 * The backend redaction policy:
 *  - Recursive walk over JSON.
 *  - A value is redacted if its key matches `SENSITIVE_ARG_NAME_RE`,
 *    or any ancestor key did (sticky propagation),
 *    or its string value matches `value_looks_secret`.
 *  - Vendor prefixes detected: sk-, xoxb-, xoxp-, xoxa-, ghp_, gho_,
 *    ghu_, ghs_, ghr_, glpat-, ya29., AKIA, AIza.
 *  - JWT shape: `header.payload.signature` of base64url segments.
 *  - High-entropy fallback: ≥40 chars of base64-ish + ≥12 distinct chars.
 *  - Numeric/bool scalars under a forced (sensitive) path become the
 *    `[REDACTED]` string — shape change is the cost of not lying.
 */

export const REDACTED_PLACEHOLDER = "[REDACTED]";

// Substring match, case-insensitive — matches `apiKey`, `user_token`,
// `AUTHORIZATION`, etc. Mirrors backend `SENSITIVE_ARG_NAME_RE`.
const SENSITIVE_ARG_NAME_RE =
  /password|token|secret|key|credential|auth|api_key|bearer|cookie|session/i;

const VENDOR_PREFIXES: ReadonlyArray<string> = [
  "sk-",
  "xoxb-",
  "xoxp-",
  "xoxa-",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "glpat-",
  "ya29.",
  "AKIA",
  "AIza",
];

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const B64_LIKE_RE = /^[A-Za-z0-9+/_=-]+$/;
const B64_LIKE_MIN_CHARS = 40;
const MIN_DISTINCT_CHARS = 12;

export function argNameLooksSensitive(name: string): boolean {
  return SENSITIVE_ARG_NAME_RE.test(name);
}

function hasSufficientCharDiversity(value: string): boolean {
  const seen = new Set<string>();
  for (const ch of value) {
    seen.add(ch);
    if (seen.size >= MIN_DISTINCT_CHARS) return true;
  }
  return false;
}

export function valueLooksSecret(value: string): boolean {
  if (value.length === 0) return false;

  for (const prefix of VENDOR_PREFIXES) {
    if (value.startsWith(prefix)) return true;
  }
  if (JWT_RE.test(value)) return true;
  if (
    value.length >= B64_LIKE_MIN_CHARS &&
    B64_LIKE_RE.test(value) &&
    hasSufficientCharDiversity(value)
  ) {
    return true;
  }
  return false;
}

function maskWalk(value: unknown, forced: boolean): unknown {
  if (value === null || value === undefined) {
    return forced ? REDACTED_PLACEHOLDER : value;
  }
  if (typeof value === "string") {
    return forced || valueLooksSecret(value) ? REDACTED_PLACEHOLDER : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return forced ? REDACTED_PLACEHOLDER : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskWalk(item, forced));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childForced = forced || argNameLooksSensitive(k);
      out[k] = maskWalk(v, childForced);
    }
    return out;
  }
  // Functions, symbols, etc. — never legal JSON, but be defensive.
  return forced ? REDACTED_PLACEHOLDER : String(value);
}

export function maskForDisplay(args: Record<string, unknown>): Record<string, unknown> {
  return maskWalk(args, false) as Record<string, unknown>;
}

/**
 * Render a JSON-ish value as a single-line string for the modal's args
 * grid. Strings come through verbatim (already masked upstream); other
 * primitives use JSON.stringify so booleans/numbers are unambiguous; nested
 * objects/arrays render compact JSON.
 */
export function formatArgValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "(none)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "(unserializable)";
  }
}
