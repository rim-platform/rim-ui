import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ logoutOtherSessions: vi.fn() }));
vi.mock("../api/sessions", () => api);

import { SignOutOtherSessions } from "./SignOutOtherSessions";

function renderButton() {
  render(<SignOutOtherSessions description="Other sessions stay signed in until they expire." />);
  return screen.getByRole("button", { name: /sign out other sessions/i });
}

describe("SignOutOtherSessions", () => {
  beforeEach(() => {
    api.logoutOtherSessions.mockReset();
  });

  it("shows the explanation and how many sessions it signed out", async () => {
    api.logoutOtherSessions.mockResolvedValue(2);
    const button = renderButton();
    expect(screen.getByText(/stay signed in until they expire/i)).toBeInTheDocument();

    await userEvent.click(button);

    expect(api.logoutOtherSessions).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("Signed out 2 other sessions.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says one session in the singular", async () => {
    api.logoutOtherSessions.mockResolvedValue(1);
    await userEvent.click(renderButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Signed out 1 other session.");
  });

  it("says when there was nothing to sign out", async () => {
    api.logoutOtherSessions.mockResolvedValue(0);
    await userEvent.click(renderButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "No other sessions were signed in.",
    );
  });

  it("shows the server's error and lets the user try again", async () => {
    api.logoutOtherSessions.mockRejectedValueOnce({
      response: { errors: [{ message: "service unavailable" }] },
    });
    api.logoutOtherSessions.mockResolvedValueOnce(3);
    const button = renderButton();

    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("service unavailable");
    expect(screen.queryByRole("status")).toBeNull();

    await userEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Signed out 3 other sessions.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to a plain message for an error without one", async () => {
    api.logoutOtherSessions.mockRejectedValue({});
    await userEvent.click(renderButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not sign out the other sessions.",
    );
  });
});
