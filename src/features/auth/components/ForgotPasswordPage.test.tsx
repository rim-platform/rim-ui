import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockMutate = vi.fn();

vi.mock("../api/usePasswordResetMutations", () => ({
  useRequestPasswordResetMutation: () => ({
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

import { ForgotPasswordPage } from "./ForgotPasswordPage";

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
  }

  it("renders the page with form", () => {
    renderPage();
    expect(screen.getByText("Reset your password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("your username")).toBeInTheDocument();
    expect(screen.getByText("Request password reset")).toBeInTheDocument();
  });

  it("submit button is disabled when username is empty", () => {
    renderPage();
    expect(screen.getByText("Request password reset")).toBeDisabled();
  });

  it("calls mutation on form submit", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("your username"), "testuser");
    await user.click(screen.getByText("Request password reset"));

    expect(mockMutate).toHaveBeenCalledWith(
      "testuser",
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("shows success message after submit (via onSuccess)", async () => {
    mockMutate.mockImplementation((_: string, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("your username"), "testuser");
    await user.click(screen.getByText("Request password reset"));

    expect(screen.getByText(/If the account exists/)).toBeInTheDocument();
    expect(screen.getByText("Back to login")).toBeInTheDocument();
  });

  it("shows success message even on error (to prevent account enumeration)", async () => {
    mockMutate.mockImplementation((_: string, opts: { onError: () => void }) => {
      opts.onError();
    });

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("your username"), "testuser");
    await user.click(screen.getByText("Request password reset"));

    expect(screen.getByText(/If the account exists/)).toBeInTheDocument();
  });

  it("has back to login link", () => {
    renderPage();
    const links = screen.getAllByText("Back to login");
    expect(links.length).toBeGreaterThan(0);
  });
});
