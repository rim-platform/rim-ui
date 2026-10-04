import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockMutate = vi.fn();

vi.mock("../api/usePasswordResetMutations", () => ({
  useResetPasswordMutation: () => ({
    mutate: mockMutate,
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../system/api/useHealthCheck", () => ({
  useHealthCheck: () => ({ isSuccess: true, isError: false }),
}));

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

import { ResetPasswordPage } from "./ResetPasswordPage";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderWithToken(token: string) {
    return render(
      <MemoryRouter initialEntries={[`/reset-password/${token}`]}>
        <Routes>
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  function renderWithoutToken() {
    return render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows error when no token is provided", () => {
    renderWithoutToken();
    expect(screen.getByText("Invalid reset link.")).toBeInTheDocument();
  });

  it("renders form when token is provided", () => {
    renderWithToken("abc123");
    expect(screen.getByText("Set a new password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("new password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("confirm password")).toBeInTheDocument();
    expect(screen.getByText("Reset password")).toBeInTheDocument();
  });

  it("submit button is disabled when fields are empty", () => {
    renderWithToken("abc123");
    expect(screen.getByText("Reset password")).toBeDisabled();
  });

  it("shows mismatch error when passwords differ", async () => {
    const user = userEvent.setup();
    renderWithToken("abc123");

    await user.type(screen.getByPlaceholderText("new password"), "pass1");
    await user.type(screen.getByPlaceholderText("confirm password"), "pass2");

    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
  });

  it("does not show mismatch when passwords match", async () => {
    const user = userEvent.setup();
    renderWithToken("abc123");

    await user.type(screen.getByPlaceholderText("new password"), "pass1");
    await user.type(screen.getByPlaceholderText("confirm password"), "pass1");

    expect(screen.queryByText("Passwords do not match")).not.toBeInTheDocument();
  });

  it("enables submit when passwords match", async () => {
    const user = userEvent.setup();
    renderWithToken("abc123");

    await user.type(screen.getByPlaceholderText("new password"), "newpass");
    await user.type(screen.getByPlaceholderText("confirm password"), "newpass");

    expect(screen.getByText("Reset password")).toBeEnabled();
  });

  it("calls mutation on form submit", async () => {
    const user = userEvent.setup();
    renderWithToken("abc123");

    await user.type(screen.getByPlaceholderText("new password"), "newpass");
    await user.type(screen.getByPlaceholderText("confirm password"), "newpass");
    await user.click(screen.getByText("Reset password"));

    expect(mockMutate).toHaveBeenCalledWith(
      { token: "abc123", newPassword: "newpass" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows success message after reset", async () => {
    mockMutate.mockImplementation((_: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });

    const user = userEvent.setup();
    renderWithToken("abc123");

    await user.type(screen.getByPlaceholderText("new password"), "newpass");
    await user.type(screen.getByPlaceholderText("confirm password"), "newpass");
    await user.click(screen.getByText("Reset password"));

    expect(screen.getByText(/Password has been reset successfully/)).toBeInTheDocument();
  });
});
