import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  enrollmentDraft,
  KEY_ACCOUNT,
  KEY_PRINCIPAL,
  localKeyAccount,
} from "../../../test/keyIdentity";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { KEY_SETUP_LATER_MS, useKeySetupOfferStore } from "../state/keySetupOffer";
import { useOfferKeySetup } from "..";

const api = vi.hoisted(() => ({
  listDeviceKeyAccounts: vi.fn(),
  defaultDeviceName: vi.fn(),
  reconcileDeviceKeys: vi.fn(),
  beginEnrollment: vi.fn(),
  completeEnrollment: vi.fn(),
  abandonEnrollment: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ platform: "desktop" as "desktop" | "web" }));
const account = vi.hoisted(() => ({ principalId: null as string | null }));

vi.mock("../api/keyIdentity", () => api);
vi.mock("../../e2ee/runtime/session", () => ({
  e2eeSession: vi.fn(() => Promise.resolve(null)),
  resetE2eeSession: vi.fn(),
}));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    platform: runtime.platform,
    deviceKeyStore: runtime.platform === "web" ? "browser" : "keyring",
    capabilities: { deviceKeys: true, identityKeys: runtime.platform === "desktop" },
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
    api.listDeviceKeyAccounts.mockResolvedValue([]);
    api.defaultDeviceName.mockResolvedValue("Laptop");
    api.reconcileDeviceKeys.mockResolvedValue(null);
    api.abandonEnrollment.mockResolvedValue(undefined);
    runtime.platform = "desktop";
    account.principalId = null;
    localStorage.clear();
    useKeySetupOfferStore.setState({ available: null, requested: false });
    // A password sign-in: a session, and no key for it on this device.
    useAuthStore.setState({ session: { userId: KEY_ACCOUNT.userId } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("offers to create the keys after a password sign-in to an account without one, and closes once they are set up", async () => {
    api.beginEnrollment.mockResolvedValue(enrollmentDraft);
    api.completeEnrollment.mockResolvedValue(undefined);
    renderStep();

    expect(stepTitle()).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /create keys/i }));
    expect(await screen.findByLabelText("Recovery phrase")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/i saved my recovery kit/i));
    await userEvent.click(screen.getByRole("button", { name: "Set up encryption" }));

    expect(api.completeEnrollment).toHaveBeenCalledWith(
      enrollmentDraft,
      expect.objectContaining(KEY_ACCOUNT),
    );
    await waitFor(() => expect(stepTitle()).toBeNull());
  });

  it("is not offered to an account whose key this device holds", async () => {
    account.principalId = KEY_PRINCIPAL;
    api.listDeviceKeyAccounts.mockResolvedValue([localKeyAccount]);
    renderStep();

    await waitFor(() => expect(api.listDeviceKeyAccounts).toHaveBeenCalled());
    expect(stepTitle()).toBeNull();
    expect(useKeySetupOfferStore.getState().available).toBeNull();
  });

  it("hides on Later and stays hidden for this account at the next start", async () => {
    const { unmount } = renderStep();

    await userEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(stepTitle()).toBeNull();
    expect(Number(localStorage.getItem(LATER_STORAGE_KEY))).toBeGreaterThan(0);
    unmount();
    renderStep();
    expect(stepTitle()).toBeNull();
  });

  it("is offered again once seven days have passed since Later", () => {
    localStorage.setItem(LATER_STORAGE_KEY, String(Date.now() - KEY_SETUP_LATER_MS + 60_000));
    const { unmount } = renderStep();
    expect(stepTitle()).toBeNull();
    unmount();

    localStorage.setItem(LATER_STORAGE_KEY, String(Date.now() - KEY_SETUP_LATER_MS - 1));
    renderStep();
    expect(stepTitle()).toBeInTheDocument();
  });

  it("comes back within the seven days when useOfferKeySetup asks for it", () => {
    localStorage.setItem(LATER_STORAGE_KEY, String(Date.now()));
    renderStep();
    const { result } = renderHook(() => useOfferKeySetup());
    expect(stepTitle()).toBeNull();
    expect(result.current.available).toBe(true);

    act(() => result.current.offer());

    expect(stepTitle()).toBeInTheDocument();
  });

  it("offers to link this browser when the account has keys on another device", async () => {
    runtime.platform = "web";
    account.principalId = KEY_PRINCIPAL;
    renderStep();

    expect(await screen.findByText(/already has keys on another device/i)).toBeInTheDocument();
    expect(screen.getByText(/link this browser to them/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/link code/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create keys/i })).toBeNull();
    expect(api.beginEnrollment).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(stepTitle()).toBeNull();
    expect(localStorage.getItem(LATER_STORAGE_KEY)).not.toBeNull();
  });

  it("is not offered in the web app to an account without keys, which only the desktop can create", () => {
    runtime.platform = "web";
    renderStep();

    expect(stepTitle()).toBeNull();
    expect(useKeySetupOfferStore.getState().available).toBeNull();
  });
});
