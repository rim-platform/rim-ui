import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runtime = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../runtime/signOut", () => runtime);

import { renderWithProviders } from "../../../test/utils";
import { SignOutDialog } from "./SignOutDialog";

function renderDialog() {
  const onClose = vi.fn();
  renderWithProviders(<SignOutDialog open onClose={onClose} />);
  return { onClose };
}

describe("SignOutDialog", () => {
  beforeEach(() => {
    runtime.signOut.mockReset();
    runtime.signOut.mockResolvedValue(undefined);
  });

  it("says what each choice does to the account on this device", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByText(/keeps this account on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/deletes them from this device/i)).toBeInTheDocument();
  });

  it("signs out keeping the account", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(runtime.signOut).toHaveBeenCalledTimes(1);
    expect(runtime.signOut).toHaveBeenCalledWith(expect.anything(), { remove: false });
  });

  it("signs out removing the account from this device", async () => {
    renderDialog();

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out and remove from this device" }),
    );

    expect(runtime.signOut).toHaveBeenCalledTimes(1);
    expect(runtime.signOut).toHaveBeenCalledWith(expect.anything(), { remove: true });
  });

  it("holds every button while signing out", async () => {
    let finish = () => {};
    runtime.signOut.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    renderDialog();

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out and remove from this device" }),
    );

    expect(screen.getByRole("button", { name: "Removing..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish();
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(runtime.signOut).toHaveBeenCalledTimes(1);
  });

  it("cancels without signing out", async () => {
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runtime.signOut).not.toHaveBeenCalled();
  });
});
