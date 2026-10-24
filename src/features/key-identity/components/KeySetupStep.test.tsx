import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { KEY_ACCOUNT, KEY_PRINCIPAL, localKeyAccount } from "../../../test/keyIdentity";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { KEY_SETUP_LATER_MS, useKeySetupOfferStore } from "../state/keySetupOffer";
import { useOfferKeySetup } from "..";

const api = vi.hoisted(() => ({
  listDeviceKeyAccounts: vi.fn(),
  defaultDeviceName: vi.fn(),
  reconcileDeviceKeys: vi.fn(),
  deviceKeepsRecoveryKit: vi.fn(),
  requestKeyStorage: vi.fn(),
  confirmRecoveryKitSaved: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ platform: "desktop" as "desktop" | "web" }));
const account = vi.hoisted(() => ({ principalId: null as string | null }));
const deviceKeysChanged = vi.hoisted(() => vi.fn());

vi.mock("../api/keyIdentity", () => api);
vi.mock("../../e2ee/runtime/session", () => ({ deviceKeysChanged }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    platform: runtime.platform,
    deviceKeyStore: runtime.platform === "web" ? "browser" : "keyring",
    capabilities: {
      deviceKeys: true,
      identityKeys: runtime.platform === "desktop",
    },
  }),
}));
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: {
      id: KEY_ACCOUNT.userId,
      username: KEY_ACCOUNT.username,
      displayName: "Alice",
      principalId: account.principalId,
    },
  }),
}));

import { KeySetupStep } from "./KeySetupStep";

const LATER_STORAGE_KEY = `rim.keySetup.later.${KEY_ACCOUNT.userId}`;

function renderStep() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <KeySetupStep />
    </QueryClientProvider>,
  );
}

const stepTitle = () => screen.queryByText("Set up encryption for this account");

describe("KeySetupStep", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    deviceKeysChanged.mockReset();
    api.listDeviceKeyAccounts.mockResolvedValue([]);
    api.defaultDeviceName.mockResolvedValue("Laptop");
    api.reconcileDeviceKeys.mockResolvedValue(null);
    api.deviceKeepsRecoveryKit.mockReturnValue(false);
    api.requestKeyStorage.mockResolvedValue("persisted");
    api.confirmRecoveryKitSaved.mockResolvedValue(undefined);
    runtime.platform = "desktop";
    account.principalId = KEY_PRINCIPAL;
    localStorage.clear();
    useKeySetupOfferStore.setState({ available: null, requested: false });
    // A sign-in to an account with keys on another device, and none for it on this one.
    useAuthStore.setState({ session: { userId: KEY_ACCOUNT.userId } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("is not offered to an account whose key this device holds", async () => {
    api.listDeviceKeyAccounts.mockResolvedValue([localKeyAccount]);
    renderStep();

    await waitFor(() => expect(api.listDeviceKeyAccounts).toHaveBeenCalled());
    expect(stepTitle()).toBeNull();
    expect(useKeySetupOfferStore.getState().available).toBeNull();
  });

  it("hides on Later and stays hidden for this account at the next start", async () => {
    const { unmount } = renderStep();

    await userEvent.click(await screen.findByRole("button", { name: "Later" }));

    expect(stepTitle()).toBeNull();
    expect(Number(localStorage.getItem(LATER_STORAGE_KEY))).toBeGreaterThan(0);
    unmount();
    renderStep();
    await waitFor(() => expect(useKeySetupOfferStore.getState().available).toBe("link"));
    expect(stepTitle()).toBeNull();
  });

  it("is offered again once seven days have passed since Later", async () => {
    localStorage.setItem(LATER_STORAGE_KEY, String(Date.now() - KEY_SETUP_LATER_MS + 60_000));
    const { unmount } = renderStep();
    await waitFor(() => expect(useKeySetupOfferStore.getState().available).toBe("link"));
    expect(stepTitle()).toBeNull();
    unmount();

    localStorage.setItem(LATER_STORAGE_KEY, String(Date.now() - KEY_SETUP_LATER_MS - 1));
    renderStep();
    expect(await screen.findByText("Set up encryption for this account")).toBeInTheDocument();
  });

  it("comes back within the seven days when useOfferKeySetup asks for it", async () => {
    localStorage.setItem(LATER_STORAGE_KEY, String(Date.now()));
    renderStep();
    const { result } = renderHook(() => useOfferKeySetup());
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(stepTitle()).toBeNull();

    act(() => result.current.offer());

    expect(stepTitle()).toBeInTheDocument();
  });

  it("offers to link this browser when the account has keys on another device", async () => {
    runtime.platform = "web";
    renderStep();

    expect(await screen.findByText(/already has keys on another device/i)).toBeInTheDocument();
    expect(screen.getByText(/link this browser to them/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/link code/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create keys/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(stepTitle()).toBeNull();
    expect(localStorage.getItem(LATER_STORAGE_KEY)).not.toBeNull();
  });

  it("says in a browser that encrypted history stays in it", async () => {
    runtime.platform = "web";
    renderStep();
    expect(await screen.findByText(/already has keys on another device/i)).toBeInTheDocument();
    expect(
      screen.getByText(/encrypted messages are kept only in this browser/i),
    ).toBeInTheDocument();
  });

  it("does not show the browser history notice in the desktop app", async () => {
    renderStep();

    expect(await screen.findByText("Set up encryption for this account")).toBeInTheDocument();
    expect(screen.queryByText(/kept only in this browser/i)).toBeNull();
  });
});
