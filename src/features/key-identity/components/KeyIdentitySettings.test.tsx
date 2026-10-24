import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { limitsQueryClient } from "../../../test/limits";
import type { ServerLimits } from "../../../core/graphql/generated/schema-types";
import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  fetchMyKeyIdentity: vi.fn(),
  reconcileDeviceKeys: vi.fn(),
  defaultDeviceName: vi.fn(),
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

vi.mock("../api/keyIdentity", () => api);
const own = vi.hoisted(() => ({
  view: { origin: "http://localhost:8080" as string | null, failed: false },
}));
vi.mock("../../relay/state/serverOrigin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/state/serverOrigin")>()),
  useServerOrigin: () => own.view,
}));
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
    api.profileCardRelays.mockReturnValue(["http://localhost:8080"]);
    api.reconcileDeviceKeys.mockResolvedValue(null);
    api.defaultDeviceName.mockResolvedValue("Laptop");
    api.deviceKeepsRecoveryKit.mockReturnValue(false);
    api.requestKeyStorage.mockResolvedValue("persisted");
    api.confirmRecoveryKitSaved.mockResolvedValue(undefined);
    api.profileCardIsStale.mockReturnValue(false);
    api.publishProfileCard.mockResolvedValue(undefined);
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

    expect(await screen.findByText("This account has no key identity.")).toBeInTheDocument();
    expect(screen.queryByText(/kept only in this browser/i)).toBeNull();
  });
});
