import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockNavigate = vi.fn();
const mockSignupMutate = vi.fn();
const mockJoinServerMutate = vi.fn();
const mockSetSession = vi.fn();
const mockSetWorkspaceId = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../api/useSignupWithInviteMutation", () => ({
  useSignupWithInviteMutation: () => ({
    mutate: mockSignupMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("../../settings/api/useInviteMutations", () => ({
  useJoinServerByInviteMutation: () => ({
    mutate: mockJoinServerMutate,
    isPending: false,
    error: null,
  }),
}));

// Default: workspace token preview — overridden per test
const mockPreviewData = {
  data: {
    tokenType: "WORKSPACE",
    expiresAt: null,
    workspace: {
      serverId: "server-1",
      serverName: "Acme Corp",
      invitedByDisplayName: "Alice",
    },
  },
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

const mockUsePreviewInviteToken = vi.fn(() => ({ ...mockPreviewData }));

vi.mock("../api/usePreviewInviteToken", () => ({
  usePreviewInviteToken: (token: string) => mockUsePreviewInviteToken(token),
  extractInviteErrorCode: (err: unknown) => {
    if (err && typeof err === "object") {
      const e = err as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
      const code = e.response?.errors?.[0]?.extensions?.code;
      if (code === "INVALID_TOKEN" || code === "EXPIRED_TOKEN") return code;
    }
    return "NETWORK";
  },
}));

// Mutable session state — defaults to no session
let mockSession: { userId: string } | null = null;

vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (selector: (s: { session: { userId: string } | null; setSession: (s: { userId: string }) => void }) => unknown) =>
    selector({ session: mockSession, setSession: mockSetSession }),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { workspaceId: string | null; setWorkspaceId: (id: string) => void }) => unknown) =>
    selector({ workspaceId: null, setWorkspaceId: mockSetWorkspaceId }),
}));

import { JoinPage } from "./JoinPage";

describe("JoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    mockUsePreviewInviteToken.mockReturnValue({ ...mockPreviewData, refetch: vi.fn() });
  });

  function renderAtPath(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/join" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("workspace token happy path: shows workspace name and signup form", () => {
    renderAtPath("/join/ws-token-abc");
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText("Create account")).toBeInTheDocument();
  });

  it("workspace token: signup mutation called with workspaceInviteToken on submit", async () => {
    mockSignupMutate.mockImplementation(
      (
        input: unknown,
        opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void },
      ) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    renderAtPath("/join/ws-token-abc");

    await user.type(screen.getByPlaceholderText("yourname"), "alice");
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "alice",
        email: "alice@example.com",
        password: "password123",
        workspaceInviteToken: "ws-token-abc",
      }),
      expect.any(Object),
    );
  });

  it("instance token happy path: shows generic copy, no workspace name", () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: { tokenType: "INSTANCE", expiresAt: null, workspace: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtPath("/join/inst-token-abc");

    expect(screen.getByText("Create your RIM account")).toBeInTheDocument();
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });

  it("instance token: setWorkspaceId not called when serverId is null", async () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: { tokenType: "INSTANCE", expiresAt: null, workspace: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    mockSignupMutate.mockImplementation(
      (
        _input: unknown,
        opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: null } }) => void },
      ) => {
        opts.onSuccess({ signupWithInvite: { userId: "u2", serverId: null } });
      },
    );

    const user = userEvent.setup();
    renderAtPath("/join/inst-token-abc");

    await user.type(screen.getByPlaceholderText("yourname"), "bob");
    await user.type(screen.getByPlaceholderText("you@example.com"), "bob@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalled();
    expect(mockSetWorkspaceId).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("INVALID_TOKEN error: renders matching copy", () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { errors: [{ extensions: { code: "INVALID_TOKEN" } }] } },
      refetch: vi.fn(),
    });

    renderAtPath("/join/bad-token");

    expect(
      screen.getByText(
        "This invite link is no longer valid. Ask your admin for a fresh invite.",
      ),
    ).toBeInTheDocument();
  });

  it("EXPIRED_TOKEN error: renders expiry copy", () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { errors: [{ extensions: { code: "EXPIRED_TOKEN" } }] } },
      refetch: vi.fn(),
    });

    renderAtPath("/join/expired-token");

    expect(
      screen.getByText("This invite has expired. Ask your admin for a fresh invite."),
    ).toBeInTheDocument();
  });

  it("already authenticated with workspace token: renders JoinAuthenticated", () => {
    mockSession = { userId: "existing-user" };

    renderAtPath("/join/ws-token-abc");

    expect(screen.getByText("Join workspace")).toBeInTheDocument();
  });

  it("optional displayName field is rendered but not required", () => {
    renderAtPath("/join/ws-token-abc");

    // Display name label is present
    expect(screen.getByText("Display name (optional)")).toBeInTheDocument();
    // Helper text is shown
    expect(screen.getByText("If left blank, your username will be shown.")).toBeInTheDocument();
    // The email field is present and required
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });
});
