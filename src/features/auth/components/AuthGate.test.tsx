import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockLoginMutate = vi.fn();
const mockBootstrapMutate = vi.fn();

vi.mock("../api/useAuthMutations", () => ({
  useLoginMutation: () => ({
    mutate: mockLoginMutate,
    isPending: false,
    error: null,
  }),
  useBootstrapMutation: () => ({
    mutate: mockBootstrapMutate,
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../system/api/useHealthCheck", () => ({
  useHealthCheck: () => ({ isSuccess: true, isError: false, isPending: false }),
}));

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

import { AuthGate } from "./AuthGate";

describe("AuthGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderAuthGate() {
    return render(
      <MemoryRouter>
        <AuthGate />
      </MemoryRouter>,
    );
  }

  it("renders the login form by default", () => {
    renderAuthGate();
    expect(screen.getByText("RIM")).toBeInTheDocument();
    expect(screen.getByText("Sign in to your workspace")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("Bootstrap")).toBeInTheDocument();
  });

  it("renders login form fields", () => {
    renderAuthGate();
    expect(screen.getByPlaceholderText("owner")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("password")).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });

  it("login button is disabled when fields are empty", () => {
    renderAuthGate();
    const button = screen.getByText("Log in");
    expect(button).toBeDisabled();
  });

  it("enables login button when both fields filled", async () => {
    const user = userEvent.setup();
    renderAuthGate();

    await user.type(screen.getByPlaceholderText("owner"), "admin");
    await user.type(screen.getByPlaceholderText("password"), "pass123");

    const button = screen.getByText("Log in");
    expect(button).toBeEnabled();
  });

  it("calls login mutation on form submit", async () => {
    const user = userEvent.setup();
    renderAuthGate();

    await user.type(screen.getByPlaceholderText("owner"), "admin");
    await user.type(screen.getByPlaceholderText("password"), "pass123");
    await user.click(screen.getByText("Log in"));

    expect(mockLoginMutate).toHaveBeenCalledWith(
      { username: "admin", password: "pass123" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("switches to bootstrap mode when tab is clicked", async () => {
    const user = userEvent.setup();
    renderAuthGate();

    await user.click(screen.getByText("Bootstrap"));

    expect(screen.getByPlaceholderText("secret")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("admin")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("Bootstrap instance")).toBeInTheDocument();
  });

  it("bootstrap button is disabled when fields are empty", async () => {
    const user = userEvent.setup();
    renderAuthGate();
    await user.click(screen.getByText("Bootstrap"));

    const button = screen.getByText("Bootstrap instance");
    expect(button).toBeDisabled();
  });

  it("calls bootstrap mutation on form submit", async () => {
    const user = userEvent.setup();
    renderAuthGate();
    await user.click(screen.getByText("Bootstrap"));

    await user.type(screen.getByPlaceholderText("secret"), "my-secret");
    await user.type(screen.getByPlaceholderText("admin"), "admin");
    // There are two password fields in bootstrap mode
    const passwordFields = screen.getAllByPlaceholderText("password");
    await user.type(passwordFields[0], "pass123");
    await user.type(screen.getByPlaceholderText("My Workspace"), "TestWS");
    await user.click(screen.getByText("Bootstrap instance"));

    expect(mockBootstrapMutate).toHaveBeenCalledWith(
      {
        secret: "my-secret",
        username: "admin",
        password: "pass123",
        serverName: "TestWS",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows health indicator with backend status", () => {
    renderAuthGate();
    expect(screen.getByText("Backend reachable")).toBeInTheDocument();
    expect(screen.getByText("(http://localhost:8080/api)")).toBeInTheDocument();
  });

  it("shows forgot password link", () => {
    renderAuthGate();
    expect(screen.getByText("Forgot password?")).toBeInTheDocument();
  });
});
