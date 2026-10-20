import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { limitsQueryClient } from "../../../test/limits";
import type { ServerLimits } from "../../../core/graphql/generated/schema-types";
import {
  enrollmentDraft,
  KEY_ACCOUNT,
  RECOVERY_KIT,
  RECOVERY_PHRASE,
} from "../../../test/keyIdentity";
import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  fetchMyKeyIdentity: vi.fn(),
  reconcileDeviceKeys: vi.fn(),
  defaultDeviceName: vi.fn(),
  beginEnrollment: vi.fn(),
  completeEnrollment: vi.fn(),
  abandonEnrollment: vi.fn(),
  deviceKeepsRecoveryKit: vi.fn(),
  requestKeyStorage: vi.fn(),
  confirmRecoveryKitSaved: vi.fn(),
  syncKeyLog: vi.fn(),
  settleDeviceKeys: vi.fn(),
  revokeDevice: vi.fn(),
  rotateIdentityKey: vi.fn(),
  publishProfileCard: vi.fn(),
  profileCardIsStale: vi.fn(),
  profileCardRelays: vi.fn(),
}));
const desktop = vi.hoisted(() => ({ value: true }));
const runtime = vi.hoisted(() => ({ platform: "desktop" as "desktop" | "web" }));
const deviceKeysChanged = vi.hoisted(() => vi.fn());

vi.mock("../api/keyIdentity", () => api);
const own = vi.hoisted(() => ({
  view: { origin: "http://localhost:8080" as string | null, failed: false },
}));
vi.mock("../../relay/state/serverOrigin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/state/serverOrigin")>()),
  useServerOrigin: () => own.view,
}));
vi.mock("../../e2ee/runtime/session", () => ({ deviceKeysChanged }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    platform: runtime.platform,
    capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value },
  }),
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

/** jsdom has no Clipboard API; stub it so the copy button is testable. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

/** Renders the settings, against a server reporting `caps` when given. */
function renderSettings(caps?: Partial<ServerLimits>) {
  const qc = caps ? limitsQueryClient(caps) : createTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <KeyIdentitySettings />
    </QueryClientProvider>,
  );
}

describe("KeyIdentitySettings", () => {
  beforeEach(() => {
    desktop.value = true;
    runtime.platform = "desktop";
    own.view = { origin: "http://localhost:8080", failed: false };
    Object.values(api).forEach((fn) => fn.mockReset());
    deviceKeysChanged.mockReset();
    api.profileCardRelays.mockReturnValue(["http://localhost:8080"]);
    api.reconcileDeviceKeys.mockResolvedValue(null);
    api.defaultDeviceName.mockResolvedValue("Laptop");
    api.abandonEnrollment.mockResolvedValue(undefined);
    api.deviceKeepsRecoveryKit.mockReturnValue(false);
    api.requestKeyStorage.mockResolvedValue("persisted");
    api.confirmRecoveryKitSaved.mockResolvedValue(undefined);
    api.profileCardIsStale.mockReturnValue(false);
    api.publishProfileCard.mockResolvedValue(undefined);
  });

  it("shows the recovery kit once and turns on key sign-in after the user saved it", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
    api.completeEnrollment.mockResolvedValue(undefined);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    expect(api.reconcileDeviceKeys).toHaveBeenCalledWith(expect.objectContaining(KEY_ACCOUNT));
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));

    expect(api.beginEnrollment).toHaveBeenCalledWith("Laptop");
    expect(await screen.findByLabelText("Recovery phrase")).toBeInTheDocument();
    const turnOn = screen.getByRole("button", { name: /turn on key sign-in/i });
    expect(turnOn).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(turnOn);

    expect(api.completeEnrollment).toHaveBeenCalledWith(
      enrollmentDraft,
      expect.objectContaining(KEY_ACCOUNT),
      "saved",
    );
    expect(deviceKeysChanged).toHaveBeenCalledTimes(1);
    // Once enrolled, the phrase is no longer on screen.
    await waitFor(() => expect(screen.queryByLabelText("Recovery phrase")).toBeNull());
    expect(screen.queryByText("liar")).toBeNull();
  });

  it("says the other sessions were signed out once key sign-in is on", async () => {
    api.fetchMyKeyIdentity.mockResolvedValueOnce(notEnrolled).mockResolvedValue(enrolled);
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
    api.completeEnrollment.mockResolvedValue(undefined);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /turn on key sign-in/i }));

    expect(await screen.findByText("rimp1_alice")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Every other session of your account was signed out",
    );
    // The server ended them at enrollment: there is nothing left to sign out here.
    expect(screen.queryByRole("button", { name: /sign out other sessions/i })).toBeNull();
  });

  it("shows the phrase as 12 numbered words with the account id, and copies the whole kit", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
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
      expect(item).toHaveTextContent(RECOVERY_PHRASE[i]);
    });
    expect(screen.getByText("rimp1_alice")).toBeInTheDocument();

    // userEvent installs its own clipboard; stub after it, and click without it.
    stubClipboard(writeText);
    fireEvent.click(screen.getByRole("button", { name: /copy kit/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RECOVERY_KIT));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("says when the kit could not be copied", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));
    await screen.findByLabelText("Recovery phrase");

    // userEvent installs its own clipboard; stub after it, and click without it.
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    fireEvent.click(screen.getByRole("button", { name: /copy kit/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not copy/i);
  });

  it("gives up on the started keys when the user cancels", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(api.abandonEnrollment).toHaveBeenCalledWith(
      enrollmentDraft,
      expect.objectContaining(KEY_ACCOUNT),
    );
    expect(await screen.findByRole("button", { name: /create keys/i })).toBeInTheDocument();
  });

  it("keeps the draft when the server refuses, so a retry uses the same keys", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
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

  it.each([
    [5, "2 of 5 devices", true],
    [2, "2 of 2 devices. This instance allows 2 devices per user.", false],
  ])("counts the active devices against a cap of %i", async (devicesPerUser, note, canLink) => {
    const removed = {
      ...enrolled.devices[1],
      deviceId: "d-old",
      revokedAt: "2026-10-10T07:00:00Z",
    };
    api.fetchMyKeyIdentity.mockResolvedValue({
      ...enrolled,
      devices: [...enrolled.devices, removed],
    });
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    renderSettings({ devicesPerUser });

    const link = await screen.findByRole("button", { name: /link a device/i });
    expect(screen.getByTestId("limit-note")).toHaveTextContent(note);
    if (canLink) {
      expect(link).toBeEnabled();
    } else {
      expect(link).toBeDisabled();
      expect(screen.getByText("Remove a device to link another.")).toBeInTheDocument();
    }
  });

  it("shows no device count on a server that reports no cap", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(enrolled);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    renderSettings();

    expect(await screen.findByRole("button", { name: /link a device/i })).toBeEnabled();
    expect(screen.queryByTestId("limit-note")).not.toBeInTheDocument();
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
    expect(api.profileCardIsStale).toHaveBeenCalledWith(enrolled, "Alice", "http://localhost:8080");
  });

  it("publishes no card while this server's origin is unknown", async () => {
    own.view = { origin: null, failed: true };
    api.fetchMyKeyIdentity.mockResolvedValue(enrolled);
    api.syncKeyLog.mockResolvedValue({
      principalId: "rimp1_alice",
      seq: 0,
      holdsIdentityKey: true,
    });
    api.settleDeviceKeys.mockResolvedValue({ deviceId: "d-this" });
    api.profileCardIsStale.mockReturnValue(true);
    renderSettings();

    expect(await screen.findByText(/holds the account's identity key/i)).toBeInTheDocument();
    expect(screen.getByText(/could not read this server's address/i)).toBeInTheDocument();
    expect(api.profileCardIsStale).not.toHaveBeenCalled();
    expect(api.publishProfileCard).not.toHaveBeenCalled();
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
    // The note on the other sessions follows an enrollment made here, not every visit.
    expect(screen.queryByText(/every other session of your account/i)).toBeNull();
  });

  it("only explains key sign-in in the web app", async () => {
    desktop.value = false;
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    renderSettings();

    expect(await screen.findByText(/set up from the desktop app/i)).toBeInTheDocument();
    expect(api.reconcileDeviceKeys).not.toHaveBeenCalled();
  });

  it("says in the web app that encrypted history stays in this browser", async () => {
    runtime.platform = "web";
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    renderSettings();

    expect(
      await screen.findByText(/encrypted messages are kept only in this browser/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/desktop app with its history archive set up/i)).toBeInTheDocument();
  });

  it("does not show the browser history notice in the desktop app", async () => {
    api.fetchMyKeyIdentity.mockResolvedValue(notEnrolled);
    renderSettings();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    expect(screen.queryByText(/kept only in this browser/i)).toBeNull();
  });
});
