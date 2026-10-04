import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockLoginMutate = vi.fn();
const mockNavigate = vi.fn();
const mockSetSession = vi.fn();

vi.mock("../api/useAuthMutations", () => ({
  useLoginMutation: () => ({
    mutate: mockLoginMutate,
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Not hydrating, no existing session
vi.mock("../api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: false, isAuthenticated: false }),
}));

// Auth store: always null session to avoid redirect-to-login side effects.
// The LoginPage component renders null when session is truthy, so keeping it
// consistently null ensures the form is always rendered during tests.
vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (selector: (s: { session: null; setSession: typeof mockSetSession }) => unknown) =>
    selector({ session: null, setSession: mockSetSession }),
}));

// Default server config: INVITE_ONLY
const mockUseServerConfig = vi.fn(() => ({
  data: { registrationMode: "INVITE_ONLY" },
  isPending: false,
  isError: false,
}));

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

import { LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "INVITE_ONLY" },
      isPending: false,
      isError: false,
    });
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
  }

  it("renders the login form with no signup affordances in default state", () => {
    renderPage();
    expect(screen.getByText("RIM")).toBeInTheDocument();
    expect(screen.getByText("Sign in to your workspace")).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });

  it("renders the exact locked invite-only copy when registrationMode is INVITE_ONLY", () => {
    renderPage();
    expect(
      screen.getByText("No account? Ask your workspace admin for an invite."),
    ).toBeInTheDocument();
  });

  it("renders the Create account link when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
      isError: false,
    });
    renderPage();
    const link = screen.getByRole("link", { name: "Create account" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/join");
  });

  it("hides the Create account link while registrationMode is loading — defaults to invite-only", () => {
    mockUseServerConfig.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderPage();
    expect(
      screen.getByText("No account? Ask your workspace admin for an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("calls login mutation on submit and navigates on success", async () => {
    mockLoginMutate.mockImplementation(
      (_: unknown, opts: { onSuccess: (d: { login: { userId: string } }) => void }) => {
        opts.onSuccess({ login: { userId: "user-123" } });
      },
    );

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("owner"), "admin");
    await user.type(screen.getByPlaceholderText("password"), "pass123");
    await user.click(screen.getByText("Log in"));

    expect(mockLoginMutate).toHaveBeenCalledWith(
      { username: "admin", password: "pass123" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("renders the Forgot password? link", () => {
    renderPage();
    expect(screen.getByText("Forgot password?")).toBeInTheDocument();
  });
});
