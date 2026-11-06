import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signIn = vi.hoisted(() => vi.fn());
vi.mock("../../key-identity/api/keyIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../key-identity/api/keyIdentity")>()),
  signInWithPassword: signIn,
}));

import { WrongPasswordError } from "../api/passwordApi";
import { PasswordSignInForm } from "./PasswordSignIn";

describe("PasswordSignInForm", () => {
  it("puts a wrong-password error under the field, above Keep me signed in, tied to the field", async () => {
    signIn.mockRejectedValue(new WrongPasswordError());
    const user = userEvent.setup();
    render(<PasswordSignInForm principalId="p" accountLabel="Ivana" onSignedIn={vi.fn()} />);
    const field = screen.getByLabelText("Password or PIN");
    expect(field).not.toHaveAttribute("aria-invalid");
    await user.type(field, "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Wrong password");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.querySelector("p")?.id);
    const keep = screen.getByRole("checkbox", { name: /Keep me signed in/ });
    expect(alert.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
