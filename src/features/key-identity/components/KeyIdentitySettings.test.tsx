import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  fetchMyKeyIdentity: vi.fn(),
  reconcileDeviceKeys: vi.fn(),
  defaultDeviceName: vi.fn(),
  beginEnrollment: vi.fn(),
  completeEnrollment: vi.fn(),
  abandonEnrollment: vi.fn(),
  syncKeyLog: vi.fn(),
  settleDeviceKeys: vi.fn(),
  revokeDevice: vi.fn(),
  rotateIdentityKey: vi.fn(),
  publishProfileCard: vi.fn(),
  profileCardIsStale: vi.fn(),
}));
const deviceKeys = vi.hoisted(() => ({ value: true }));

vi.mock("../api/keyIdentity", () => api);
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: deviceKeys.value } }),
}));
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: { id: "u-alice", username: "alice", displayName: "Alice", principalId: null },
  }),
}));

import { KeyIdentitySettings } from "./KeyIdentitySettings";

const notEnrolled: MyKeyIdentity = {
  principalId: null,
  keySeq: null,
  keyLog: [],
  devices: [],
  profileCard: null,
};

const enrolled: MyKeyIdentity = {
  principalId: "rimp1_alice",
  keySeq: 0,
  keyLog: [],
  devices: [
    {
      deviceId: "d-this",
      publicKey: "pk1",
      name: "Laptop",
      keySeq: 0,
      certificate: { payload: "{}", signature: "ed25519:s" },
      addedAt: "2026-10-09T07:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
    },
    {
      deviceId: "d-other",
      publicKey: "pk2",
      name: "Desktop",
      keySeq: 0,
      certificate: { payload: "{}", signature: "ed25519:s" },
      addedAt: "2026-10-09T07:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
    },
  ],
  profileCard: null,
};

const me = { userId: "u-alice", username: "alice" };

const PHRASE = "abandon amount liar amount expire adjust cage candy arch gather drum buyer".split(
  " ",
);
const KIT = `RIM recovery kit (v2)\nAccount id: rimp1_alice\nRecovery phrase: ${PHRASE.join(" ")}\n`;
const draft = {
  draftId: "draft-1",
  principalId: "rimp1_alice",
  recoveryKit: KIT,
  recoveryPhrase: PHRASE,
};

/** jsdom has no Clipboard API; stub it so the copy button is testable. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

function renderSettings() {
  const qc = createTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <KeyIdentitySettings />
    </QueryClientProvider>,
  );
}

describe("KeyIdentitySettings", () => {
  beforeEach(() => {
    deviceKeys.value = true;
    Object.values(api).forEach((fn) => fn.mockReset());
    api.reconcileDeviceKeys.mockResolvedValue(null);
    api.defaultDeviceName.mockResolvedValue("Laptop");
    api.abandonEnrollment.mockResolvedValue(undefined);
    api.profileCardIsStale.mockReturnValue(false);
    api.publishProfileCard.mockResolvedValue(undefined);
  });

  it("shows the recovery kit once and turns on key sign-in after the user saved it", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(draft);
    api.completeEnrollment.mockResolvedValue(undefined);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    expect(api.reconcileDeviceKeys).toHaveBeenCalledWith(expect.objectContaining(me));
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));

    expect(api.beginEnrollment).toHaveBeenCalledWith("Laptop");
    expect(await screen.findByLabelText("Recovery phrase")).toBeInTheDocument();
    const turnOn = screen.getByRole("button", { name: /turn on key sign-in/i });
    expect(turnOn).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(turnOn);

    expect(api.completeEnrollment).toHaveBeenCalledWith(draft, expect.objectContaining(me));
    // Once enrolled, the phrase is no longer on screen.
    await waitFor(() => expect(screen.queryByLabelText("Recovery phrase")).toBeNull());
    expect(screen.queryByText("liar")).toBeNull();
  });

  it("shows the phrase as 12 numbered words with the account id, and copies the whole kit", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(draft);
    const writeText = vi.fn().mockResolvedValue(undefined);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));

    const grid = await screen.findByLabelText("Recovery phrase");
    const items = within(grid).getAllByRole("listitem");
    expect(items).toHaveLength(12);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(`${i + 1}.`);
      expect(item).toHaveTextContent(PHRASE[i]);
    });
    expect(screen.getByText("rimp1_alice")).toBeInTheDocument();

    // userEvent installs its own clipboard; stub after it, and click without it.
    stubClipboard(writeText);
    fireEvent.click(screen.getByRole("button", { name: /copy kit/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KIT));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("gives up on the started keys when the user cancels", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(draft);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(api.abandonEnrollment).toHaveBeenCalledWith(draft, expect.objectContaining(me));
    expect(await screen.findByRole("button", { name: /create keys/i })).toBeInTheDocument();
  });

  it("keeps the draft when the server refuses, so a retry uses the same keys", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(draft);
    api.completeEnrollment.mockRejectedValueOnce(new Error("Server busy"));
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /turn on key sign-in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/server busy/i);
    expect(within(screen.getByLabelText("Recovery phrase")).getAllByRole("listitem")).toHaveLength(
      12,
    );
    expect(api.abandonEnrollment).not.toHaveBeenCalled();
  });

  it("lets the device holding the identity key remove other devices, not itself", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(enrolled);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    api.revokeDevice.mockResolvedValue(undefined);
    renderSettings();

    expect(await screen.findByText("rimp1_alice")).toBeInTheDocument();
    const remove = await screen.findAllByRole("button", { name: /^remove$/i });
    expect(remove).toHaveLength(1);
    expect(screen.getByText(/this device$/i)).toBeInTheDocument();

    await userEvent.click(remove[0]);
    await userEvent.click(screen.getByRole("button", { name: /remove device/i }));

    expect(api.revokeDevice).toHaveBeenCalledWith(enrolled, "d-other");
    expect(screen.getByRole("button", { name: /link a device/i })).toBeInTheDocument();
  });

  it("replaces the identity key after a confirmation", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(enrolled);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    api.rotateIdentityKey.mockResolvedValue(undefined);
    renderSettings();

    await userEvent.click(
      await screen.findByRole("button", { name: /replace identity key\.\.\./i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^replace identity key$/i }));

    expect(api.rotateIdentityKey).toHaveBeenCalledWith(enrolled);
  });

  it("publishes a stale profile card once", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(enrolled);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    api.profileCardIsStale.mockReturnValue(true);
    renderSettings();

    await waitFor(() => expect(api.publishProfileCard).toHaveBeenCalledWith(enrolled, "Alice"));
    expect(api.publishProfileCard).toHaveBeenCalledTimes(1);
  });

  it("offers no device management without the identity key", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(enrolled);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: false,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-other" });
    renderSettings();

    expect(await screen.findByText(/signs in with its own key/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^remove$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /replace identity key/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /link a device/i })).toBeNull();
  });

  it("only explains key sign-in in the web app", async () => {
    deviceKeys.value = false;
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    renderSettings();

    expect(await screen.findByText(/set up from the desktop app/i)).toBeInTheDocument();
    expect(api.reconcileDeviceKeys).not.toHaveBeenCalled();
  });
});
