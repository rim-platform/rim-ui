import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { KEY_PRINCIPAL, RECOVERY_KIT, RECOVERY_PHRASE } from "../../../test/keyIdentity";
import { useShellStore } from "../../../shell/state/useShellStore";

const api = vi.hoisted(() => ({
  unsavedRecoveryKit: vi.fn(),
  confirmRecoveryKitSaved: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ platform: "web" as "desktop" | "web" }));

vi.mock("../api/keyIdentity", () => api);
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: runtime.platform, capabilities: { identityKeys: true } }),
}));
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: { id: "u-alice", username: "alice", displayName: "Alice", principalId: KEY_PRINCIPAL },
  }),
}));

import { RecoveryKitBanner } from "./RecoveryKitBanner";

const KIT = {
  principalId: KEY_PRINCIPAL,
  recoveryKit: RECOVERY_KIT,
  recoveryPhrase: RECOVERY_PHRASE,
};

function renderBanner() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RecoveryKitBanner />
    </QueryClientProvider>,
  );
}

const banner = () => screen.queryByTestId("recovery-kit-banner");

describe("RecoveryKitBanner", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    runtime.platform = "web";
    // The kit stays unsaved until confirmed.
    let saved = false;
    api.unsavedRecoveryKit.mockImplementation(async () => (saved ? null : KIT));
    api.confirmRecoveryKitSaved.mockImplementation(async () => {
      saved = true;
    });
  });

  it("warns until the kit is confirmed, then goes away", async () => {
    const user = userEvent.setup();
    renderBanner();

    expect(await screen.findByTestId("recovery-kit-banner")).toHaveTextContent(
      "Save your recovery kit. Losing this browser's data can permanently remove your ability to manage this account.",
    );
    await user.click(screen.getByRole("button", { name: "Show recovery kit" }));
    expect(await screen.findByLabelText("Recovery phrase")).toBeInTheDocument();
    expect(screen.getByText(KEY_PRINCIPAL)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I saved it" }));

    expect(api.confirmRecoveryKitSaved).toHaveBeenCalledWith(KEY_PRINCIPAL);
    await waitFor(() => expect(banner()).toBeNull());
    expect(screen.getByText("Recovery kit saved")).toBeInTheDocument();
    expect(screen.getByText(/second device also keeps you signed in/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Recovery kit saved")).toBeNull();
  });

  it("stays after Later", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(await screen.findByRole("button", { name: "Show recovery kit" }));
    await user.click(await screen.findByRole("button", { name: "Later" }));

    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    expect(api.confirmRecoveryKitSaved).not.toHaveBeenCalled();
    expect(banner()).toBeInTheDocument();
  });

  it("opens Settings > Security from the second device line", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ mainSurface: { kind: "conversation" } });
    renderBanner();

    await user.click(await screen.findByRole("button", { name: "Show recovery kit" }));
    await user.click(await screen.findByRole("button", { name: "Settings > Security" }));

    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "security" });
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
  });

  it("speaks of this device's data on the desktop", async () => {
    runtime.platform = "desktop";
    renderBanner();

    expect(await screen.findByTestId("recovery-kit-banner")).toHaveTextContent(
      "Losing this device's data can permanently remove",
    );
  });

  it("shows nothing when this device keeps no unsaved kit", async () => {
    api.unsavedRecoveryKit.mockResolvedValue(null);
    renderBanner();

    await waitFor(() => expect(api.unsavedRecoveryKit).toHaveBeenCalledWith(KEY_PRINCIPAL));
    expect(banner()).toBeNull();
  });
});
