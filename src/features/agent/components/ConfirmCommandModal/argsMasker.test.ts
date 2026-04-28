import { describe, it, expect } from "vitest";

import {
  argNameLooksSensitive,
  formatArgValue,
  maskForDisplay,
  REDACTED_PLACEHOLDER,
  valueLooksSecret,
} from "./argsMasker";

describe("argNameLooksSensitive", () => {
  it("matches sensitive name patterns case-insensitively", () => {
    for (const name of [
      "password",
      "Password",
      "user_password",
      "token",
      "access_token",
      "secret",
      "api_key",
      "apiKey",
      "API_KEY",
      "credential",
      "authorization",
      "AUTH",
      "bearer",
      "cookie",
      "session",
    ]) {
      expect(argNameLooksSensitive(name)).toBe(true);
    }
  });

  it("does not match innocuous names", () => {
    for (const name of [
      "message",
      "channel",
      "text",
      "user_id",
      "conversation_id",
      "count",
      "query",
      "limit",
    ]) {
      expect(argNameLooksSensitive(name)).toBe(false);
    }
  });
});

describe("valueLooksSecret", () => {
  it("detects vendor prefixes", () => {
    expect(
      valueLooksSecret("sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"),
    ).toBe(true);
    expect(valueLooksSecret("xoxb-12345-abc")).toBe(true);
    expect(valueLooksSecret("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
    expect(valueLooksSecret("glpat-abc123def456")).toBe(true);
    expect(valueLooksSecret("ya29.a0AVA9y1u_xyz")).toBe(true);
    expect(valueLooksSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(valueLooksSecret("AIzaSyA-example-google-api-key")).toBe(true);
  });

  it("detects JWT shape", () => {
    expect(
      valueLooksSecret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123"),
    ).toBe(true);
  });

  it("detects high-entropy base64-ish tokens", () => {
    expect(
      valueLooksSecret("AbCdEf0123456789XyZwVuTsRqPoNmLkJiHgFeDcBa9876"),
    ).toBe(true);
  });

  it("does not flag short or low-diversity strings", () => {
    expect(valueLooksSecret("abc123")).toBe(false);
    expect(valueLooksSecret("short-token")).toBe(false);
    expect(valueLooksSecret("a".repeat(80))).toBe(false);
    expect(valueLooksSecret("abc".repeat(50))).toBe(false);
  });

  it("does not flag normal prose", () => {
    expect(valueLooksSecret("hello world")).toBe(false);
    expect(valueLooksSecret("status: ok")).toBe(false);
    expect(valueLooksSecret("")).toBe(false);
  });
});

describe("maskForDisplay", () => {
  it("redacts sensitive top-level keys", () => {
    const out = maskForDisplay({ message: "hi", password: "hunter2" });
    expect(out).toEqual({ message: "hi", password: REDACTED_PLACEHOLDER });
  });

  it("redacts secret-shaped values under innocuous keys", () => {
    const out = maskForDisplay({
      data: "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(out["data"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("redacts nested sensitive keys", () => {
    const out = maskForDisplay({
      user: { id: "u1", auth: "bearer abc" },
    });
    const user = out["user"] as Record<string, unknown>;
    expect(user["id"]).toBe("u1");
    expect(user["auth"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("propagates sensitivity through arrays under a sensitive key", () => {
    const out = maskForDisplay({
      tokens: ["short1", "plain-value", "abc"],
      message: "hi",
    });
    expect(out["message"]).toBe("hi");
    expect(out["tokens"]).toEqual([
      REDACTED_PLACEHOLDER,
      REDACTED_PLACEHOLDER,
      REDACTED_PLACEHOLDER,
    ]);
  });

  it("propagates sensitivity through nested objects under a sensitive key", () => {
    const out = maskForDisplay({
      credentials: { value: "not-a-known-shape", region: "us-east-1" },
    });
    const creds = out["credentials"] as Record<string, unknown>;
    expect(creds["value"]).toBe(REDACTED_PLACEHOLDER);
    expect(creds["region"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("redacts numeric/bool values under a sensitive key", () => {
    const out = maskForDisplay({
      api_key: 12345,
      enabled_secret: true,
      count: 42,
    });
    expect(out["api_key"]).toBe(REDACTED_PLACEHOLDER);
    expect(out["enabled_secret"]).toBe(REDACTED_PLACEHOLDER);
    expect(out["count"]).toBe(42);
  });

  it("preserves non-string scalars at benign paths", () => {
    const out = maskForDisplay({ count: 42, enabled: true, missing: null });
    expect(out["count"]).toBe(42);
    expect(out["enabled"]).toBe(true);
    expect(out["missing"]).toBe(null);
  });
});

// Parity guard — mirrors the canonical list in
// `rim-server/rim_services/src/command/sensitivity.rs:159` (VENDOR_PREFIXES).
// If this test fails, either the backend list changed without updating the
// frontend or vice versa. Drift = "masked in UI, logged plain" (Widow N4).
// Cross-repo gate: a PR that touches either list must touch the other.
describe("VENDOR_PREFIXES parity with backend", () => {
  const EXPECTED_BACKEND_PREFIXES = [
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

  it("frontend masks every backend-listed prefix", () => {
    for (const prefix of EXPECTED_BACKEND_PREFIXES) {
      // Pad to ensure the prefix dominates the detection, not the entropy
      // fallback. A bare prefix should already trigger Layer-1 vendor match.
      const sample = `${prefix}abcdef0123456789ghijklmnop`;
      expect(valueLooksSecret(sample)).toBe(true);
    }
  });
});

describe("formatArgValue", () => {
  it("formats primitives", () => {
    expect(formatArgValue("hello")).toBe("hello");
    expect(formatArgValue(42)).toBe("42");
    expect(formatArgValue(true)).toBe("true");
    expect(formatArgValue(null)).toBe("null");
    expect(formatArgValue(undefined)).toBe("(none)");
  });

  it("compact-stringifies objects + arrays", () => {
    expect(formatArgValue({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
    expect(formatArgValue([1, 2, 3])).toBe("[1,2,3]");
  });
});
