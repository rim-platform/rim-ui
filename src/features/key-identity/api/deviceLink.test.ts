import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

const invokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

// The desktop app: device key work goes to the Tauri side.
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));

import {
  cancelLink,
  confirmLink,
  DEVICE_LINK_MESSAGES,
  DeviceLinkError,
  linkNewDevice,
  pollDelay,
  resumePendingDeviceLinks,
  startLinkingDevice,
  waitForOffer,
  type StartedLink,
} from "./deviceLink";
import type { MyKeyIdentity } from "./keyIdentity";

const ENDPOINT = "http://localhost:8080/api";
const PRINCIPAL = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
const LINK_ID = "AAECAwQFBgcICQoLDA0ODw";
const CODE = `rim-link:1:${LINK_ID}:secret:${ENDPOINT}`;
const STATEMENT = { payload: "{}", signature: "sig" };
const SEALED = { nonce: "n", ciphertext: "c" };
const ANSWER_SEALED = { nonce: "an", ciphertext: "ac" };
const DEVICE_ID = "01999999-0000-7000-8000-000000000001";
const DEVICE_KEY = "ed25519:new";

/** The operation name of a request: its document's first `query X` / `mutation X`. */
function operation(call: unknown[]): string {
  const doc = String(call[0]);
  return /(?:query|mutation)\s+(\w+)/.exec(doc)?.[1] ?? doc;
}

function serverError(code: string) {
  return new ClientError(
    { status: 200, headers: new Headers(), errors: [{ message: code, extensions: { code } }] },
    { query: "" },
  );
}

/** Answers in turn, the last one repeating. */
function inTurn(...answers: unknown[]) {
  let i = 0;
  return () => answers[Math.min(i++, answers.length - 1)];
}

/**
 * Answer server operations and Tauri commands by name. A function answer is called with the
 * variables or args; an Error answer is thrown (a Tauri one as a command failure).
 */
function backend(server: Record<string, unknown>, tauri: Record<string, unknown> = {}) {
  requestMock.mockImplementation(async (doc: unknown, vars: unknown) => {
    const name = operation([doc]);
    if (!(name in server)) throw new Error(`unexpected request ${name}`);
    const answer = server[name];
    const value = typeof answer === "function" ? answer(vars) : answer;
    if (value instanceof Error) throw value;
    return value;
  });
  invokeMock.mockImplementation(async (command: string, args: unknown) => {
    if (!(command in tauri)) return { ok: true, value: null };
    const answer = tauri[command];
    const value = typeof answer === "function" ? answer(args) : answer;
    if (value instanceof Error) {
      return {
        ok: false,
        error: { kind: "backend_error", code: "INVALID", message: value.message },
      };
    }
    return { ok: true, value };
  });
}

function requests(): string[] {
  return requestMock.mock.calls.map(operation);
}

function commands(): string[] {
  return invokeMock.mock.calls.map((call) => call[0] as string);
}

function argsOf(command: string): unknown {
  return invokeMock.mock.calls.find((call) => call[0] === command)?.[1];
}

const sleep = vi.fn(async () => undefined);

/**
 * The password prompt's sign-in, as the page wires it: the device key signs a proof and the
 * server answers with the user id.
 */
const signIn = vi.fn(async (principalId: string) => {
  await invokeMock("key_identity_sign_login", { principalId });
  const res = (await requestMock("mutation LoginWithKey { loginWithKey { userId } }", {})) as {
    loginWithKey: { userId: string };
  };
  return res.loginWithKey.userId;
});

beforeEach(() => {
  requestMock.mockReset();
  invokeMock.mockReset();
  sleep.mockClear();
  signIn.mockClear();
});

describe("pollDelay", () => {
  it("polls every 2 seconds for a minute, then every 5", () => {
    expect(pollDelay(0)).toBe(2_000);
    expect(pollDelay(59_999)).toBe(2_000);
    expect(pollDelay(60_000)).toBe(5_000);
    expect(pollDelay(600_000)).toBe(5_000);
  });
});

// ─── New device ─────────────────────────────────────────────────────────────

const SENT = { linkId: LINK_ID, fingerprint: "QSFX-VHMA", offer: SEALED };
const KEY_LOG = { keyLog: [{ seq: 0, statement: STATEMENT }] };

function newDeviceBackend(
  server: Record<string, unknown> = {},
  tauri: Record<string, unknown> = {},
) {
  backend(
    {
      SendDeviceLinkOffer: { sendDeviceLinkOffer: true },
      DeviceLinkAnswer: inTurn({ deviceLinkAnswer: null }, { deviceLinkAnswer: ANSWER_SEALED }),
      KeyLog: KEY_LOG,
      KeyLoginChallenge: { keyLoginChallenge: { challengeId: "c-1", nonce: "n-1" } },
      LoginWithKey: { loginWithKey: { userId: "user-1" } },
      MeKeyAccount: {
        me: { id: "user-1", username: "ada", displayName: "Ada", principalId: PRINCIPAL },
      },
      CompleteDeviceLink: { completeDeviceLink: true },
      CancelDeviceLink: { cancelDeviceLink: true },
      ...server,
    },
    {
      key_identity_link_offer: SENT,
      key_identity_link_open_answer: { principalId: PRINCIPAL },
      key_identity_link_accept: {
        principalId: PRINCIPAL,
        deviceId: DEVICE_ID,
        deviceName: "Laptop",
      },
      key_identity_sign_login: STATEMENT,
      ...tauri,
    },
  );
}

describe("linkNewDevice", () => {
  it("offers, waits for the answer, verifies it, signs in and completes the link", async () => {
    newDeviceBackend();
    const onOffered = vi.fn();

    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep, onOffered })).resolves.toBe(
      "user-1",
    );

    expect(argsOf("key_identity_link_offer")).toEqual({
      endpoint: ENDPOINT,
      code: CODE,
      deviceName: "Laptop",
    });
    const offer = requestMock.mock.calls.find((c) => operation(c) === "SendDeviceLinkOffer");
    expect(offer?.[1]).toEqual({ linkId: LINK_ID, offer: SEALED });
    expect(onOffered).toHaveBeenCalledWith({ linkId: LINK_ID, fingerprint: "QSFX-VHMA" });
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
    expect(argsOf("key_identity_link_open_answer")).toEqual({
      linkId: LINK_ID,
      answer: ANSWER_SEALED,
    });
    expect(argsOf("key_identity_link_accept")).toEqual({ linkId: LINK_ID, keyLog: [STATEMENT] });
    // Keys are stored (accept) before the sign-in uses them, and the link completes once.
    const order = commands();
    expect(order.indexOf("key_identity_link_accept")).toBeLessThan(
      order.indexOf("key_identity_sign_login"),
    );
    expect(signIn).toHaveBeenCalledWith(PRINCIPAL);
    expect(requests().filter((r) => r === "CompleteDeviceLink")).toHaveLength(1);
    expect(requests()).not.toContain("CancelDeviceLink");
  });

  it("resends the same offer when only the network failed", async () => {
    newDeviceBackend({
      SendDeviceLinkOffer: inTurn(new TypeError("fetch failed"), { sendDeviceLinkOffer: true }),
    });
    await linkNewDevice(CODE, "Laptop", signIn, { sleep });
    const offers = requestMock.mock.calls.filter((c) => operation(c) === "SendDeviceLinkOffer");
    expect(offers).toHaveLength(2);
    expect(offers[1][1]).toEqual(offers[0][1]);
  });

  it("refuses a code the Tauri side cannot use, before asking the server", async () => {
    newDeviceBackend(
      {},
      { key_identity_link_offer: new Error("this code is for another server (https://x)") },
    );
    const err = await linkNewDevice(CODE, "Laptop", signIn, { sleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceLinkError);
    expect((err as Error).message).toContain("another server");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not cancel when the limiter refuses the offer", async () => {
    newDeviceBackend({ SendDeviceLinkOffer: serverError("RATE_LIMITED") });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      DEVICE_LINK_MESSAGES.rateLimited,
    );
    expect(requests()).not.toContain("CancelDeviceLink");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("shows the fallback for a server error without GraphQL errors", async () => {
    newDeviceBackend({
      SendDeviceLinkOffer: new ClientError(
        { status: 400, headers: new Headers(), errors: undefined },
        { query: "" },
      ),
    });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      DEVICE_LINK_MESSAGES.failed,
    );
  });

  it("says the code is used up when the server refuses the offer", async () => {
    newDeviceBackend({ SendDeviceLinkOffer: serverError("UNAUTHENTICATED") });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      DEVICE_LINK_MESSAGES.codeUnusable,
    );
    expect(commands()).toContain("key_identity_link_end");
    expect(requests()).not.toContain("CancelDeviceLink");
  });

  it("drops the keys when the link ends before an answer", async () => {
    newDeviceBackend({ DeviceLinkAnswer: serverError("UNAUTHENTICATED") });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      DEVICE_LINK_MESSAGES.linkEnded,
    );
    expect(argsOf("key_identity_link_end")).toEqual({ linkId: LINK_ID });
    expect(commands()).not.toContain("key_identity_link_accept");
  });

  it("cancels the link when the answer names another device", async () => {
    newDeviceBackend(
      {},
      {
        key_identity_link_open_answer: new Error(
          "the answer from your other device did not verify (the certificate is for another device)",
        ),
      },
    );
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      /did not verify/,
    );
    expect(requests()).toContain("CancelDeviceLink");
    expect(commands()).toContain("key_identity_link_end");
    expect(commands()).not.toContain("key_identity_link_accept");
    expect(requests()).not.toContain("LoginWithKey");
  });

  it("cancels the link when the certificate does not verify against the served log", async () => {
    newDeviceBackend(
      {},
      {
        key_identity_link_accept: new Error(
          "the answer from your other device did not verify (a device certificate does not verify)",
        ),
      },
    );
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      /did not verify/,
    );
    expect(requests()).toContain("CancelDeviceLink");
    expect(requests()).not.toContain("KeyLoginChallenge");
  });

  it("removes the keys when the other device revoked this one before it signed in", async () => {
    newDeviceBackend({ LoginWithKey: serverError("FORBIDDEN") });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      DEVICE_LINK_MESSAGES.revoked,
    );
    expect(argsOf("key_identity_forget")).toEqual({ principalId: PRINCIPAL });
  });

  it("keeps the keys when signing in fails otherwise", async () => {
    newDeviceBackend({ LoginWithKey: serverError("RATE_LIMITED") });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).rejects.toThrow(
      /device is linked/,
    );
    expect(commands()).not.toContain("key_identity_forget");
  });

  it("tries completeDeviceLink twice at most and succeeds anyway", async () => {
    newDeviceBackend({ CompleteDeviceLink: serverError("CONFLICT") });
    await expect(linkNewDevice(CODE, "Laptop", signIn, { sleep })).resolves.toBe("user-1");
    expect(requests().filter((r) => r === "CompleteDeviceLink")).toHaveLength(2);
  });

  it("cancels the link and drops the keys when aborted while waiting", async () => {
    newDeviceBackend({ DeviceLinkAnswer: { deviceLinkAnswer: null } });
    const controller = new AbortController();
    const abortingSleep = vi.fn(async () => controller.abort());
    const err = await linkNewDevice(CODE, "Laptop", signIn, {
      sleep: abortingSleep,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect((err as DeviceLinkError).reason).toBe("aborted");
    expect(requests()).toContain("CancelDeviceLink");
    expect(commands()).toContain("key_identity_link_end");
  });
});

// ─── Old device ─────────────────────────────────────────────────────────────

function identity(devices: Partial<MyKeyIdentity["devices"][number]>[] = []): {
  myKeyIdentity: MyKeyIdentity;
} {
  return {
    myKeyIdentity: {
      principalId: PRINCIPAL,
      keySeq: 0,
      keyLog: [{ seq: 0, statement: STATEMENT }],
      devices: devices.map((d) => ({
        deviceId: "d-1",
        publicKey: "ed25519:old",
        name: "Desktop",
        keySeq: 0,
        addedAt: "2026-10-09T00:00:00Z",
        lastUsedAt: "2026-10-09T00:00:00Z",
        revokedAt: null,
        certificate: STATEMENT,
        ...d,
      })),
      profileCard: null,
    },
  };
}

const LINK: StartedLink = {
  linkId: LINK_ID,
  code: CODE,
  expiresAt: "2026-10-09T00:10:00Z",
  principalId: PRINCIPAL,
};
const REVIEW = {
  deviceId: DEVICE_ID,
  name: "Laptop",
  platform: "desktop",
  fingerprint: "QSFX-VHMA",
};
const LINK_ANSWER = {
  deviceId: DEVICE_ID,
  deviceKey: DEVICE_KEY,
  certificate: STATEMENT,
  answer: ANSWER_SEALED,
};
const NEW_DEVICE = { deviceId: DEVICE_ID, publicKey: DEVICE_KEY, name: "Laptop" };

function status(state: string, offer: unknown = null) {
  return { deviceLink: { state, expiresAt: "2026-10-09T00:10:00Z", offer } };
}

function oldDeviceBackend(
  server: Record<string, unknown> = {},
  tauri: Record<string, unknown> = {},
) {
  backend(
    {
      StartDeviceLink: { startDeviceLink: { linkId: LINK_ID, expiresAt: LINK.expiresAt } },
      MyKeyIdentity: identity([{}]),
      DeviceLink: inTurn(status("OPEN"), status("OFFERED", SEALED)),
      CancelDeviceLink: { cancelDeviceLink: true },
      AddDeviceKey: { addDeviceKey: { deviceId: DEVICE_ID } },
      SendDeviceLinkAnswer: { sendDeviceLinkAnswer: status("ANSWERED").deviceLink },
      PublishProfileCard: { publishProfileCard: { version: 1 } },
      RevokeDeviceKey: { revokeDeviceKey: { deviceId: DEVICE_ID, revokedAt: "now" } },
      MeKeyAccount: {
        me: { id: "user-1", username: "ada", displayName: "Ada", principalId: PRINCIPAL },
      },
      ...server,
    },
    {
      key_identity_link_begin: { linkId: LINK_ID, code: CODE },
      key_identity_link_review_offer: REVIEW,
      key_identity_link_confirm: LINK_ANSWER,
      key_identity_link_resume: LINK_ANSWER,
      key_identity_sign_profile_card: STATEMENT,
      key_identity_sign_revocation: STATEMENT,
      ...tauri,
    },
  );
}

describe("startLinkingDevice", () => {
  it("starts a link on the server and makes the code on the Tauri side", async () => {
    oldDeviceBackend();
    await expect(startLinkingDevice(identity().myKeyIdentity)).resolves.toEqual(LINK);
    expect(argsOf("key_identity_link_begin")).toEqual({
      principalId: PRINCIPAL,
      endpoint: ENDPOINT,
      linkId: LINK_ID,
    });
  });

  it("explains an account without a key identity", async () => {
    oldDeviceBackend({ StartDeviceLink: serverError("VALIDATION") });
    await expect(startLinkingDevice(identity().myKeyIdentity)).rejects.toThrow(
      DEVICE_LINK_MESSAGES.noKeyIdentity,
    );
  });
});

describe("waitForOffer", () => {
  it("opens and checks the offer against the account's log and every device", async () => {
    oldDeviceBackend({
      MyKeyIdentity: identity([{}, { deviceId: "d-2", revokedAt: "2026-10-09T00:00:00Z" }]),
    });
    await expect(waitForOffer(LINK, { sleep })).resolves.toEqual(REVIEW);
    expect(argsOf("key_identity_link_review_offer")).toEqual({
      linkId: LINK_ID,
      keyLog: [STATEMENT],
      devices: [
        { deviceId: "d-1", publicKey: "ed25519:old" },
        { deviceId: "d-2", publicKey: "ed25519:old" },
      ],
      offer: SEALED,
    });
    expect(requests()).not.toContain("CancelDeviceLink");
    expect(commands()).not.toContain("key_identity_link_end");
  });

  it("cancels the link when the offer does not open or breaks a rule", async () => {
    oldDeviceBackend(
      {},
      {
        key_identity_link_review_offer: new Error(
          "someone other than your new device used this code, so the link was cancelled",
        ),
      },
    );
    await expect(waitForOffer(LINK, { sleep })).rejects.toThrow(/someone other than/);
    expect(requests()).toContain("CancelDeviceLink");
    expect(argsOf("key_identity_link_end")).toEqual({ linkId: LINK_ID });
  });

  it("reports an expired code", async () => {
    oldDeviceBackend({ DeviceLink: status("EXPIRED") });
    await expect(waitForOffer(LINK, { sleep })).rejects.toThrow(DEVICE_LINK_MESSAGES.expired);
    expect(commands()).toContain("key_identity_link_end");
  });

  it("retries the identity fetch on a network failure and cancels nothing after", async () => {
    oldDeviceBackend({ MyKeyIdentity: new TypeError("fetch failed") });
    await expect(waitForOffer(LINK, { sleep })).rejects.toThrow("fetch failed");
    expect(requests().filter((r) => r === "MyKeyIdentity")).toHaveLength(3);
    expect(requests()).not.toContain("CancelDeviceLink");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("treats a GraphQL error without a code as final", async () => {
    oldDeviceBackend({
      DeviceLink: new ClientError(
        { status: 200, headers: new Headers(), errors: [{ message: "boom" }] },
        { query: "" },
      ),
    });
    await expect(waitForOffer(LINK, { sleep })).rejects.toBeInstanceOf(ClientError);
    expect(requests().filter((r) => r === "DeviceLink")).toHaveLength(1);
  });
});

describe("confirmLink", () => {
  it("writes the pending record, adds the device, answers, republishes and waits", async () => {
    oldDeviceBackend({ DeviceLink: inTurn(status("ANSWERED"), status("CONSUMED")) });

    await confirmLink(LINK, "Work laptop", "Ada", { sleep });

    expect(argsOf("key_identity_link_confirm")).toEqual({
      linkId: LINK_ID,
      keyLog: [STATEMENT],
      deviceName: "Work laptop",
    });
    const add = requestMock.mock.calls.find((c) => operation(c) === "AddDeviceKey");
    expect(add?.[1]).toEqual({ certificate: STATEMENT });
    const answer = requestMock.mock.calls.find((c) => operation(c) === "SendDeviceLinkAnswer");
    expect(answer?.[1]).toEqual({ linkId: LINK_ID, answer: ANSWER_SEALED });
    const order = requests();
    expect(order.indexOf("AddDeviceKey")).toBeLessThan(order.indexOf("SendDeviceLinkAnswer"));
    expect(order.indexOf("SendDeviceLinkAnswer")).toBeLessThan(order.indexOf("PublishProfileCard"));
    expect(commands()).toContain("key_identity_link_end");
    expect(requests()).not.toContain("RevokeDeviceKey");
  });

  it("does not let a profile card failure hold up the link", async () => {
    oldDeviceBackend({
      DeviceLink: status("CONSUMED"),
      PublishProfileCard: serverError("VALIDATION"),
    });
    await expect(confirmLink(LINK, "Laptop", "Ada", { sleep })).resolves.toBeUndefined();
  });

  it("carries on after a lost addDeviceKey answer when the device is already there", async () => {
    oldDeviceBackend({
      AddDeviceKey: serverError("CONFLICT"),
      MyKeyIdentity: identity([{}, { ...NEW_DEVICE, lastUsedAt: null }]),
      DeviceLink: status("CONSUMED"),
    });
    await confirmLink(LINK, "Laptop", "Ada", { sleep });
    expect(requests()).toContain("SendDeviceLinkAnswer");
  });

  it("cancels on any other refusal of addDeviceKey", async () => {
    oldDeviceBackend({ AddDeviceKey: serverError("CONFLICT") });
    await expect(confirmLink(LINK, "Laptop", "Ada", { sleep })).rejects.toBeInstanceOf(
      DeviceLinkError,
    );
    expect(requests()).toContain("CancelDeviceLink");
    expect(requests()).not.toContain("SendDeviceLinkAnswer");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("revokes the device when the link expires before the device was used", async () => {
    oldDeviceBackend({
      DeviceLink: status("EXPIRED"),
      MyKeyIdentity: identity([{}, { ...NEW_DEVICE, lastUsedAt: null }]),
    });
    await expect(confirmLink(LINK, "Laptop", "Ada", { sleep })).rejects.toThrow(
      DEVICE_LINK_MESSAGES.expired,
    );
    expect(argsOf("key_identity_sign_revocation")).toMatchObject({ deviceId: DEVICE_ID });
    expect(requests()).toContain("RevokeDeviceKey");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("keeps a device that signed in even if the link was cancelled", async () => {
    oldDeviceBackend({
      DeviceLink: status("CANCELLED"),
      MyKeyIdentity: identity([{}, NEW_DEVICE]),
    });
    await expect(confirmLink(LINK, "Laptop", "Ada", { sleep })).resolves.toBeUndefined();
    expect(requests()).not.toContain("RevokeDeviceKey");
  });

  it("keeps the pending record when the network fails before the answer", async () => {
    oldDeviceBackend({ SendDeviceLinkAnswer: new TypeError("fetch failed") });
    await expect(confirmLink(LINK, "Laptop", "Ada", { sleep })).rejects.toBeInstanceOf(
      DeviceLinkError,
    );
    expect(commands()).not.toContain("key_identity_link_end");
  });

  it("declines the link when the identity cannot be fetched", async () => {
    oldDeviceBackend({ MyKeyIdentity: serverError("UNAUTHENTICATED") });
    await expect(confirmLink(LINK, "Laptop", "Ada", { sleep })).rejects.toBeInstanceOf(
      DeviceLinkError,
    );
    expect(requests()).toContain("CancelDeviceLink");
    expect(commands()).not.toContain("key_identity_link_confirm");
  });
});

describe("cancelLink", () => {
  it("cancels a link nobody confirmed", async () => {
    oldDeviceBackend();
    await expect(cancelLink(LINK)).resolves.toBe(false);
    expect(requests()).toEqual(["CancelDeviceLink"]);
    expect(commands()).toEqual(["key_identity_link_end"]);
  });

  it("revokes a confirmed device nobody used", async () => {
    oldDeviceBackend({ MyKeyIdentity: identity([{}, { ...NEW_DEVICE, lastUsedAt: null }]) });
    await expect(cancelLink(LINK, DEVICE_ID)).resolves.toBe(false);
    expect(requests()).toContain("RevokeDeviceKey");
  });

  it("keeps a device whose link was already consumed", async () => {
    oldDeviceBackend({ CancelDeviceLink: serverError("CONFLICT") });
    await expect(cancelLink(LINK, DEVICE_ID)).resolves.toBe(true);
    expect(requests()).not.toContain("RevokeDeviceKey");
  });

  it("leaves the record of a link another account confirmed", async () => {
    oldDeviceBackend({
      MyKeyIdentity: { myKeyIdentity: { ...identity().myKeyIdentity, principalId: "rimp1_x" } },
    });
    await cancelLink(LINK, DEVICE_ID);
    expect(requests()).not.toContain("RevokeDeviceKey");
    expect(commands()).not.toContain("key_identity_link_end");
  });
});

describe("resumePendingDeviceLinks", () => {
  const PENDING = {
    linkId: LINK_ID,
    principalId: PRINCIPAL,
    deviceId: DEVICE_ID,
    deviceKey: DEVICE_KEY,
  };

  it("sends the answer again for a link still OFFERED", async () => {
    oldDeviceBackend(
      { DeviceLink: inTurn(status("OFFERED", SEALED), status("CONSUMED")) },
      { key_identity_link_pending: [PENDING] },
    );
    await resumePendingDeviceLinks({ sleep });
    expect(argsOf("key_identity_link_resume")).toEqual({ linkId: LINK_ID });
    expect(requests()).toEqual(
      expect.arrayContaining(["AddDeviceKey", "SendDeviceLinkAnswer", "PublishProfileCard"]),
    );
    expect(commands()).toContain("key_identity_link_end");
  });

  it("keeps waiting for a link ANSWERED", async () => {
    oldDeviceBackend(
      { DeviceLink: inTurn(status("ANSWERED"), status("ANSWERED"), status("CONSUMED")) },
      { key_identity_link_pending: [PENDING] },
    );
    await resumePendingDeviceLinks({ sleep });
    expect(requests()).not.toContain("SendDeviceLinkAnswer");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("revokes an unused device of a link that expired", async () => {
    oldDeviceBackend(
      {
        DeviceLink: status("EXPIRED"),
        MyKeyIdentity: identity([{}, { ...NEW_DEVICE, lastUsedAt: null }]),
      },
      { key_identity_link_pending: [PENDING] },
    );
    await resumePendingDeviceLinks({ sleep });
    expect(requests()).toContain("RevokeDeviceKey");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("leaves another account's pending links alone", async () => {
    oldDeviceBackend({}, { key_identity_link_pending: [{ ...PENDING, principalId: "rimp1_x" }] });
    await resumePendingDeviceLinks({ sleep });
    expect(requests()).toEqual(["MyKeyIdentity"]);
    expect(commands()).not.toContain("key_identity_link_end");
  });

  it("does nothing without pending links", async () => {
    oldDeviceBackend({}, { key_identity_link_pending: [] });
    await resumePendingDeviceLinks({ sleep });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("forgets a link the new device consumed", async () => {
    oldDeviceBackend({ DeviceLink: status("CONSUMED") }, { key_identity_link_pending: [PENDING] });
    await resumePendingDeviceLinks({ sleep });
    expect(argsOf("key_identity_link_end")).toEqual({ linkId: LINK_ID });
    expect(requests()).not.toContain("RevokeDeviceKey");
  });

  it("revokes an unused device of a cancelled link", async () => {
    oldDeviceBackend(
      {
        DeviceLink: status("CANCELLED"),
        MyKeyIdentity: identity([{}, { ...NEW_DEVICE, lastUsedAt: null }]),
      },
      { key_identity_link_pending: [PENDING] },
    );
    await resumePendingDeviceLinks({ sleep });
    expect(requests()).toContain("RevokeDeviceKey");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("settles a link the server no longer knows", async () => {
    oldDeviceBackend(
      {
        DeviceLink: serverError("NOT_FOUND"),
        MyKeyIdentity: identity([{}, { ...NEW_DEVICE, lastUsedAt: null }]),
      },
      { key_identity_link_pending: [PENDING] },
    );
    await resumePendingDeviceLinks({ sleep });
    expect(requests()).toContain("RevokeDeviceKey");
    expect(commands()).toContain("key_identity_link_end");
  });

  it("stops when aborted", async () => {
    oldDeviceBackend({ DeviceLink: status("ANSWERED") }, { key_identity_link_pending: [PENDING] });
    const controller = new AbortController();
    await resumePendingDeviceLinks({
      sleep: async () => controller.abort(),
      signal: controller.signal,
    });
    expect(commands()).not.toContain("key_identity_link_end");
  });
});
