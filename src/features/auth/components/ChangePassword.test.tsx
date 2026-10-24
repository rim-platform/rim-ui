import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const changes = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock("../runtime/passwordChanges", () => changes);

import { WrongPasswordError } from "../api/passwordApi";
import { ChangePassword } from "./ChangePassword";

async function fill(current: string, next: string, repeat = next) {
  await userEvent.click(screen.getByRole("button", { name: "Change password" }));
  await userEvent.type(screen.getByLabelText(/current password/i), current);
  await userEvent.click(screen.getByRole("radio", { name: /PIN/ }));
  await userEvent.type(screen.getByLabelText("PIN"), next);
  await userEvent.type(screen.getByLabelText("PIN again"), repeat);
  await userEvent.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ChangePassword", () => {
  beforeEach(() => {
    changes.changePassword.mockReset();
  });

  it("changes the password with the current one, and says other devices ask for the new one", async () => {
    changes.changePassword.mockResolvedValue(undefined);
    render(<ChangePassword principalId="rimp1_ada" />);

    await fill("old passphrase", "246810");

    expect(changes.changePassword).toHaveBeenCalledWith("rimp1_ada", "old passphrase", "246810");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Other devices will ask for the new password.",
    );
    expect(screen.queryByLabelText(/current password/i)).toBeNull();
  });

  it("checks the new PIN before anything is sent", async () => {
    render(<ChangePassword principalId="rimp1_ada" />);

    await fill("old passphrase", "12345");
    expect(screen.getByText("A PIN has at least 6 digits.")).toBeInTheDocument();
    expect(changes.changePassword).not.toHaveBeenCalled();
  });

  it("says when the current password is wrong", async () => {
    changes.changePassword.mockRejectedValue(new WrongPasswordError());
    render(<ChangePassword principalId="rimp1_ada" />);

    await fill("not it", "246810");
    expect(await screen.findByRole("alert")).toHaveTextContent("The current password is wrong.");
    await waitFor(() => expect(screen.getByLabelText(/current password/i)).toHaveValue(""));
  });
});
