import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { readRefusal, refusalForAgent, showCommandRefusal } from "./refusal";

function failure(message: string, extensions: Record<string, unknown>): Error {
  return Object.assign(new Error(`${message} (serialized response)`), {
    response: { errors: [{ message, extensions }] },
  });
}

describe("readRefusal", () => {
  it("reads each refusal extension", () => {
    expect(
      readRefusal(failure("m", { code: "FORBIDDEN", refusal: "DENIED", missing: "x.y" })),
    ).toEqual({
      kind: "DENIED",
      missing: "x.y",
    });
    expect(readRefusal(failure("m", { code: "FORBIDDEN", refusal: "DENIED" }))).toEqual({
      kind: "DENIED",
      missing: null,
    });
    expect(
      readRefusal(failure("m", { code: "TIMEOUT", refusal: "FAILED", retrySafe: true })),
    ).toEqual({
      kind: "FAILED",
      retrySafe: true,
    });
    expect(
      readRefusal(failure("m", { code: "TIMEOUT", refusal: "FAILED", retrySafe: false })),
    ).toEqual({
      kind: "FAILED",
      retrySafe: false,
    });
    expect(readRefusal(failure("m", { code: "CONFIRMATION_STALE", refusal: "EXPIRED" }))).toEqual({
      kind: "EXPIRED",
    });
    expect(readRefusal(failure("m", { code: "VALIDATION", refusal: "INVALID" }))).toEqual({
      kind: "INVALID",
    });
  });

  it("falls back on the code when there is no refusal", () => {
    expect(readRefusal(failure("m", { code: "FORBIDDEN" }))).toEqual({
      kind: "DENIED",
      missing: null,
    });
    expect(readRefusal(failure("m", { code: "CONFIRMATION_STALE" }))).toEqual({ kind: "EXPIRED" });
    expect(readRefusal(failure("m", { code: "TIMEOUT" }))).toEqual({
      kind: "FAILED",
      retrySafe: false,
    });
    expect(readRefusal(failure("m", { code: "RATE_LIMITED" }))).toEqual({
      kind: "FAILED",
      retrySafe: true,
    });
    expect(readRefusal(failure("m", { code: "VALIDATION" }))).toEqual({ kind: "INVALID" });
  });

  it("is null for a plain error and for an unknown code", () => {
    expect(readRefusal(new Error("x"))).toBeNull();
    expect(readRefusal(failure("m", { code: "SOMETHING_ELSE" }))).toBeNull();
  });
});

describe("showCommandRefusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows DENIED as an error card naming the missing permission, with no action", () => {
    const retry = vi.fn();
    showCommandRefusal(
      "Ban",
      failure("No.", { code: "FORBIDDEN", refusal: "DENIED", missing: "moderation.ban" }),
      retry,
    );
    expect(toast.error).toHaveBeenCalledWith("Ban: not done", {
      card: "denied",
      description: "You don't have the `moderation.ban` permission.",
    });
    expect(vi.mocked(toast.error).mock.calls[0][1]?.action).toBeUndefined();
  });

  it("uses the server's message for DENIED without a missing capability, or a default", () => {
    showCommandRefusal("Ban", failure("Timed out until noon.", { code: "TIMED_OUT" }));
    expect(toast.error).toHaveBeenLastCalledWith("Ban: not done", {
      card: "denied",
      description: "Timed out until noon.",
    });
    showCommandRefusal("Ban", { response: { errors: [{ extensions: { refusal: "DENIED" } }] } });
    expect(toast.error).toHaveBeenLastCalledWith("Ban: not done", {
      card: "denied",
      description: "You don't have permission to do this.",
    });
  });

  it("offers Retry on a FAILED that is safe to repeat, and the action calls retry", () => {
    const retry = vi.fn();
    showCommandRefusal(
      "Sync",
      failure("Upstream timed out", { refusal: "FAILED", retrySafe: true }),
      retry,
    );
    const [title, options] = vi.mocked(toast.warning).mock.calls[0];
    expect(title).toBe("Sync: failed");
    expect(options?.description).toBe("Upstream timed out. It is safe to try again.");
    expect(options?.card).toBe("failed");
    expect(options?.action?.label).toBe("Retry");
    options?.action?.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("offers no action on a FAILED that may have gone through", () => {
    showCommandRefusal(
      "Sync",
      failure("Upstream timed out", { refusal: "FAILED", retrySafe: false }),
      vi.fn(),
    );
    expect(toast.warning).toHaveBeenCalledWith("Sync: failed", {
      card: "failed",
      description: "Upstream timed out. It may have gone through, so check before trying again.",
      action: undefined,
    });
  });

  it("offers no Retry on a safe FAILED when the caller gave none", () => {
    showCommandRefusal("Sync", failure("Slow.", { refusal: "FAILED", retrySafe: true }));
    expect(vi.mocked(toast.warning).mock.calls[0][1]?.action).toBeUndefined();
  });

  it("shows EXPIRED as a neutral card offering Ask again", () => {
    const retry = vi.fn();
    showCommandRefusal("Delete", failure("stale", { refusal: "EXPIRED" }), retry);
    const [title, options] = vi.mocked(toast.info).mock.calls[0];
    expect(title).toBe("Delete: expired");
    expect(options?.description).toBe("You didn't confirm in time. Nothing ran.");
    expect(options?.card).toBe("ended");
    expect(options?.action?.label).toBe("Ask again");
    options?.action?.onClick();
    expect(retry).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows INVALID and unknown errors as the title and message, with no action", () => {
    showCommandRefusal("Run", failure("Bad argument", { refusal: "INVALID" }), vi.fn());
    expect(toast.error).toHaveBeenLastCalledWith("Run: Bad argument");
    expect(vi.mocked(toast.error).mock.calls.at(-1)?.[1]).toBeUndefined();
    showCommandRefusal("Run", new Error("Network down"), vi.fn());
    expect(toast.error).toHaveBeenLastCalledWith("Run: Network down");
  });
});

describe("refusalForAgent", () => {
  it("words each kind for the model", () => {
    expect(refusalForAgent(failure("Nope.", { refusal: "DENIED" }))).toBe(
      "Denied by policy, do not retry. Tell the user: Nope.",
    );
    expect(refusalForAgent(failure("Slow.", { refusal: "FAILED", retrySafe: true }))).toBe(
      "Failed for a technical reason, safe to retry: Slow.",
    );
    expect(refusalForAgent(failure("Slow.", { refusal: "FAILED", retrySafe: false }))).toBe(
      "Failed for a technical reason. It may have run, so ask the user before retrying: Slow.",
    );
    expect(refusalForAgent(failure("x", { refusal: "EXPIRED" }))).toBe(
      "The confirmation expired and nothing ran. Ask the user before trying again.",
    );
    expect(refusalForAgent(failure("Bad.", { refusal: "INVALID" }))).toBe(
      "The call is wrong, nothing ran: Bad.",
    );
  });

  it("is null for a plain error", () => {
    expect(refusalForAgent(new Error("x"))).toBeNull();
  });
});
