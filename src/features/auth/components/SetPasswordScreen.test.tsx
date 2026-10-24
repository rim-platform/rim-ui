import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";

const changes = vi.hoisted(() => ({ setFirstPassword: vi.fn() }));
vi.mock("../runtime/passwordChanges", () => changes);
const gate = vi.hoisted(() => ({ principalOf: vi.fn() }));
vi.mock("../runtime/unlockGate", () => gate);
vi.mock("../runtime/signOut", () => ({ signOut: vi.fn(async () => undefined) }));

import { useAuthStore } from "../state/useAuthStore";
import { SetPasswordScreen } from "./SetPasswordScreen";

function renderScreen() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SetPasswordScreen />
    </QueryClientProvider>,
  );
}

describe("SetPasswordScreen", () => {
  beforeEach(() => {
    changes.setFirstPassword.mockReset();
    gate.principalOf.mockReset().mockResolvedValue("rimp1_ada");
    useAuthStore.setState({ session: { userId: "u-ada" }, mustSetPassword: true });
  });

  it("sets the first password, and the app opens once it is set", async () => {
    changes.setFirstPassword.mockResolvedValue(undefined);
    renderScreen();

    await userEvent.type(await screen.findByLabelText("Passphrase"), "correct horse battery");
    await userEvent.type(screen.getByLabelText("Passphrase again"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(changes.setFirstPassword).toHaveBeenCalledWith(
      "rimp1_ada",
      "correct horse battery",
      false,
    );
    await waitFor(() => expect(useAuthStore.getState().mustSetPassword).toBe(false));
  });

  it("refuses two entries that differ, and shows a refusal", async () => {
    changes.setFirstPassword.mockRejectedValue(new Error("set a password first"));
    renderScreen();

    await userEvent.type(await screen.findByLabelText("Passphrase"), "correct horse battery");
    await userEvent.type(screen.getByLabelText("Passphrase again"), "correct horse batter");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByText("The two entries do not match.")).toBeInTheDocument();
    expect(changes.setFirstPassword).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Passphrase again"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("set a password first");
    expect(useAuthStore.getState().mustSetPassword).toBe(true);
  });
});
