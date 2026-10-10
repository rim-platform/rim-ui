import { describe, it, expect } from "vitest";

import {
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  RATE_LIMITED,
  TIMED_OUT,
  graphqlErrorExtension,
  retryAfterSeconds,
  timedOutMessage,
  timedOutUntil,
  UPSTREAM_UNAVAILABLE,
  UPSTREAM_UNAVAILABLE_MESSAGE,
} from "./errors";

const forbidden = Object.assign(new Error('Forbidden: {"response":{}}'), {
  response: {
    errors: [
      {
        message: "Only moderators can archive channels",
        extensions: { code: "FORBIDDEN" },
      },
    ],
  },
});

describe("graphqlErrorCode", () => {
  it("reads extensions.code off the first GraphQL error", () => {
    expect(graphqlErrorCode(forbidden)).toBe(FORBIDDEN);
  });

  it("is undefined for plain errors and non-objects", () => {
    expect(graphqlErrorCode(new Error("boom"))).toBeUndefined();
    expect(graphqlErrorCode("boom")).toBeUndefined();
    expect(graphqlErrorCode(null)).toBeUndefined();
    expect(graphqlErrorCode({ response: { errors: [] } })).toBeUndefined();
  });
});

describe("graphqlErrorMessage", () => {
  it("prefers the server's message over the serialized ClientError message", () => {
    expect(graphqlErrorMessage(forbidden, "fallback")).toBe("Only moderators can archive channels");
  });

  it("falls back to Error.message, then to the fallback", () => {
    expect(graphqlErrorMessage(new Error("network down"), "fallback")).toBe("network down");
    expect(graphqlErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("words an unreachable peer server without its id", () => {
    const upstream = Object.assign(new Error("serialized"), {
      response: {
        errors: [
          {
            message: "server rims1_abc is unavailable",
            extensions: { code: "UPSTREAM_UNAVAILABLE", hostServerId: "rims1_abc" },
          },
        ],
      },
    });
    expect(graphqlErrorCode(upstream)).toBe(UPSTREAM_UNAVAILABLE);
    expect(graphqlErrorExtension(upstream, "hostServerId")).toBe("rims1_abc");
    expect(graphqlErrorMessage(upstream, "fallback")).toBe(UPSTREAM_UNAVAILABLE_MESSAGE);
  });
});

function withExtensions(message: string, extensions: Record<string, unknown>) {
  return Object.assign(new Error(`${message} (serialized)`), {
    response: { errors: [{ message, extensions }] },
  });
}

describe("Track 1.2 error extensions", () => {
  const until = "2026-10-05T12:30:00Z";
  const timedOut = withExtensions(`timed out until ${until}`, { code: TIMED_OUT, until });
  const slowMode = withExtensions("rate limit exceeded", {
    code: RATE_LIMITED,
    retryAfterSeconds: 12,
  });

  it("reads `until` off a TIMED_OUT error only", () => {
    expect(timedOutUntil(timedOut)).toBe(until);
    expect(timedOutUntil(slowMode)).toBeUndefined();
    expect(timedOutUntil(withExtensions("x", { code: TIMED_OUT }))).toBeUndefined();
  });

  it("reads `retryAfterSeconds` off a RATE_LIMITED error only", () => {
    expect(retryAfterSeconds(slowMode)).toBe(12);
    expect(retryAfterSeconds(timedOut)).toBeUndefined();
    expect(retryAfterSeconds(withExtensions("x", { code: RATE_LIMITED }))).toBeUndefined();
  });

  it("exposes any extension value", () => {
    expect(graphqlErrorExtension(slowMode, "retryAfterSeconds")).toBe(12);
    expect(graphqlErrorExtension(new Error("plain"), "until")).toBeUndefined();
  });

  it("words a TIMED_OUT failure as the timed-out message everywhere", () => {
    expect(graphqlErrorMessage(timedOut, "fallback")).toBe(timedOutMessage(until));
    expect(timedOutMessage(until)).toMatch(/^You are timed out until /);
  });
});
