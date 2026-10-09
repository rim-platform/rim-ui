import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../api/useSignupWithInviteMutation", () => ({
  useSignupWithInviteMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (
    selector: (s: { workspaceId: string | null; setWorkspaceId: (id: string) => void }) => unknown,
  ) => selector({ workspaceId: null, setWorkspaceId: vi.fn() }),
}));

const mockSetSession = vi.fn();

vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: { session: null; setSession: (s: { userId: string }) => void }) => unknown,
  ) => selector({ session: null, setSession: mockSetSession }),
}));

const mockUseServerConfig = vi.fn();

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

const deviceKeys = vi.hoisted(() => ({ value: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: deviceKeys.value } }),
}));

// The key form has its own tests; this stand-in shows the token it got and finishes the way
// the real one does, with a server id only for a workspace invite.
vi.mock("./KeySignupForm", () => ({
  KeySignupForm: ({
    tokens,
    onSuccess,
  }: {
    tokens: Record<string, string>;
    onSuccess: (userId: string, serverId: string | null) => void;
  }) => (
    <div data-testid="key-signup">
      <span data-testid="key-signup-tokens">{JSON.stringify(tokens)}</span>
      <button
        type="button"
        onClick={() => onSuccess("user-key", tokens.workspaceInviteToken ? "server-key" : null)}
      >
        finish key signup
      </button>
    </div>
  ),
}));

import { OpenJoinPage } from "./OpenJoinPage";

describe("OpenJoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deviceKeys.value = false;
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <OpenJoinPage />
      </MemoryRouter>,
    );
  }

  it("renders the signup form when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });

    renderPage();

    expect(screen.getByText("Create account")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("yourname")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("password")).toBeInTheDocument();
  });

  it("renders invite-only forbidden state when registrationMode is INVITE_ONLY", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "INVITE_ONLY" },
      isPending: false,
    });

    renderPage();

    expect(
      screen.getByText("Registration is invite-only on this RIM instance."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Create account")).not.toBeInTheDocument();
  });

  it("renders loading state and does not redirect while isPending", () => {
    mockUseServerConfig.mockReturnValue({
      data: undefined,
      isPending: true,
    });

    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // No redirect should have fired yet
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("offers a key signup on the desktop, with no token, and signs the new account in", async () => {
    deviceKeys.value = true;
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /create account with a key/i }));
    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(mockSetSession).toHaveBeenCalledWith({ userId: "user-key" });
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("does not offer a key signup in the web app", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
    });
    renderPage();
    expect(screen.queryByRole("button", { name: /create account with a key/i })).toBeNull();
  });
});
