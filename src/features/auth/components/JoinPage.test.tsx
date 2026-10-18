import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { renderWithServerInfo } from "../../../test/serverInfo";

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
      ownerDisplayName: "Olga",
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

// The server's registration mode, and whether it is still being read.
const config = vi.hoisted(() => ({ mode: "INVITE_ONLY", isPending: false }));

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => ({
    data: config.isPending ? undefined : { registrationMode: config.mode },
    isPending: config.isPending,
  }),
}));

// Mutable session state — defaults to no session
let mockSession: { userId: string } | null = null;

vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: {
      session: { userId: string } | null;
      setSession: (s: { userId: string }) => void;
    }) => unknown,
  ) => selector({ session: mockSession, setSession: mockSetSession }),
}));

// Whether the session cookie is still being checked; the session it restores is `mockSession`.
const hydration = vi.hoisted(() => ({ isHydrating: false }));

vi.mock("../api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: hydration.isHydrating, isAuthenticated: false }),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (
    selector: (s: { workspaceId: string | null; setWorkspaceId: (id: string) => void }) => unknown,
  ) => selector({ workspaceId: null, setWorkspaceId: mockSetWorkspaceId }),
}));

// The signed-in account's workspaces.
const myServers = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => myServers,
}));

const desktop = vi.hoisted(() => ({ value: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value } }),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { JoinPage } from "./JoinPage";
import { expectReachableByKeyboard } from "../../../test/keyboard";

beforeEach(() => {
  config.mode = "INVITE_ONLY";
  config.isPending = false;
});

describe("JoinPage — no-referrer meta tag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    mockUsePreviewInviteToken.mockReturnValue({ ...mockPreviewData, refetch: vi.fn() });
  });

  it("injects a no-referrer meta tag into document.head on mount", () => {
    const { unmount } = renderWithServerInfo(
      <MemoryRouter initialEntries={["/join/tok-abc"]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const meta = document.querySelector("meta[name='referrer']");
    expect(meta).not.toBeNull();
    expect(meta!.getAttribute("content")).toBe("no-referrer");

    // Unmount explicitly so that the useEffect cleanup removes the meta before
    // this test's scope ends. RTL's auto-cleanup would also do this, but being
    // explicit keeps the assertion and cleanup co-located.
    unmount();
  });

  it("removes the no-referrer meta tag from document.head on unmount", () => {
    const { unmount } = renderWithServerInfo(
      <MemoryRouter initialEntries={["/join/tok-abc"]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.querySelector("meta[name='referrer']")).not.toBeNull();

    unmount();

    expect(document.querySelector("meta[name='referrer']")).toBeNull();
  });
});

describe("JoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    hydration.isHydrating = false;
    myServers.data = [];
    mockUsePreviewInviteToken.mockReturnValue({ ...mockPreviewData, refetch: vi.fn() });
  });

  function renderAtPath(path: string) {
    return renderWithServerInfo(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/join" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("WORKSPACE preview → JoinForm renders with workspace-variant copy", () => {
    renderAtPath("/join/ws-token-abc");
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText("Create account")).toBeInTheDocument();
    // Negation: workspace variant must NOT show the generic instance heading
    expect(screen.queryByText("Create your RIM account")).not.toBeInTheDocument();
  });

  it("reaches its primary actions by keyboard", async () => {
    const user = userEvent.setup();
    renderAtPath("/join/ws-token-abc");
    const username = screen.getByPlaceholderText("yourname");
    const email = screen.getByPlaceholderText("you@example.com");
    const password = screen.getByPlaceholderText("password");
    await expectReachableByKeyboard(user, [username, email, password]);
    username.focus();
    await user.keyboard("alice");
    email.focus();
    await user.keyboard("alice@example.com");
    password.focus();
    await user.keyboard("password123");
    await expectReachableByKeyboard(user, [screen.getByRole("button", { name: "Create account" })]);
  });

  it("workspace token: signup mutation called with workspaceInviteToken on submit", async () => {
    mockSignupMutate.mockImplementation(
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void;
        },
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

  it("waits for the registration mode before showing the form", () => {
    config.isPending = true;
    renderAtPath("/join/ws-token-abc");

    expect(screen.getByText("Loading invite...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("yourname")).not.toBeInTheDocument();
  });

  it("workspace token on an open server: signs up with no token", async () => {
    config.mode = "OPEN";
    const user = userEvent.setup();
    renderAtPath("/join/ws-token-abc");

    await user.type(screen.getByPlaceholderText("yourname"), "alice");
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledTimes(1);
    expect(mockSignupMutate.mock.calls[0][0]).not.toHaveProperty("workspaceInviteToken");
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

  it("INSTANCE preview → JoinForm renders with instance-variant copy and submits with instanceInviteToken", async () => {
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
        opts.onSuccess({ signupWithInvite: { userId: "u-instance", serverId: null } });
      },
    );

    const user = userEvent.setup();
    renderAtPath("/join/inst-token-xyz");

    // Instance variant shows the generic heading, not a workspace name
    expect(screen.getByText("Create your RIM account")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("yourname"), "charlie");
    await user.type(screen.getByPlaceholderText("you@example.com"), "charlie@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "charlie",
        email: "charlie@example.com",
        instanceInviteToken: "inst-token-xyz",
      }),
      expect.any(Object),
    );

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(Object.prototype.hasOwnProperty.call(input, "workspaceInviteToken")).toBe(false);
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
      screen.getByText("This invite link is no longer valid. Ask your admin for a fresh invite."),
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

  it("waits for the session cookie, then offers the restored account the workspace", () => {
    hydration.isHydrating = true;
    const { rerender } = renderAtPath("/join/ws-token-abc");
    expect(screen.getByText("Restoring session...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("yourname")).not.toBeInTheDocument();

    hydration.isHydrating = false;
    mockSession = { userId: "existing-user" };
    rerender(
      <MemoryRouter initialEntries={["/join/ws-token-abc"]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Join workspace")).toBeInTheDocument();
    expect(screen.queryByText("Create account")).not.toBeInTheDocument();
  });

  it("names the inviter and the workspace owner, signed in or not", () => {
    const { unmount } = renderAtPath("/join/ws-token-abc");
    expect(screen.getByText("Invited by Alice · Owned by Olga")).toBeInTheDocument();
    unmount();

    mockSession = { userId: "existing-user" };
    mockUsePreviewInviteToken.mockReturnValue({
      ...mockPreviewData,
      data: {
        ...mockPreviewData.data,
        workspace: { ...mockPreviewData.data.workspace, ownerDisplayName: null },
      },
      refetch: vi.fn(),
    });
    renderAtPath("/join/ws-token-abc");
    expect(screen.getByText("Invited by Alice")).toBeInTheDocument();
  });

  it("signed in: says when another of the account's workspaces shares the name", () => {
    mockSession = { userId: "existing-user" };
    const other = { id: "server-2", name: "acme corp ", owner: null };
    myServers.data = [other];
    const { unmount } = renderAtPath("/join/ws-token-abc");
    expect(
      screen.getByText("You already belong to a workspace named acme corp."),
    ).toBeInTheDocument();
    unmount();

    myServers.data = [{ ...other, owner: { id: "u-9", username: "bo", displayName: null } }];
    const { unmount: unmountOwned } = renderAtPath("/join/ws-token-abc");
    expect(
      screen.getByText("You already belong to a workspace named acme corp, owned by bo."),
    ).toBeInTheDocument();
    unmountOwned();

    // The invite's own workspace and a different name are not collisions.
    myServers.data = [
      { ...other, id: "server-1" },
      { id: "server-3", name: "Acme", owner: null },
    ];
    renderAtPath("/join/ws-token-abc");
    expect(screen.queryByText(/You already belong/)).not.toBeInTheDocument();
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

  it("email-bound instance invite: shows the server's refusal of another address", async () => {
    const refusal = "this invite admits only the email address it was issued for";
    mockUsePreviewInviteToken.mockReturnValue({
      data: { tokenType: "INSTANCE", expiresAt: null, workspace: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    // A graphql-request ClientError: its own message embeds the whole response.
    const err = Object.assign(new Error(`${refusal}: {"response":{"errors":[]}}`), {
      response: { errors: [{ message: refusal, extensions: { code: "VALIDATION" } }] },
    });
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => opts.onError(err),
    );

    const user = userEvent.setup();
    renderAtPath("/join/operator-tok-abc");

    await user.type(screen.getByPlaceholderText("yourname"), "newadmin");
    await user.type(screen.getByPlaceholderText("you@example.com"), "other@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
    await user.click(screen.getByText("Create account"));

    expect(screen.getByText(refusal)).toBeInTheDocument();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("already authenticated with instance token: renders instance-token error copy", () => {
    mockSession = { userId: "existing-user" };

    mockUsePreviewInviteToken.mockReturnValue({
      data: { tokenType: "INSTANCE", expiresAt: null, workspace: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtPath("/join/inst-tok-abc");

    expect(
      screen.getByText("You already have a RIM account; instance invites are only for new users."),
    ).toBeInTheDocument();
  });
});

describe("JoinPage — create account with a key (desktop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    desktop.value = true;
    mockUsePreviewInviteToken.mockReturnValue({ ...mockPreviewData, refetch: vi.fn() });
  });

  afterEach(() => {
    desktop.value = false;
  });

  function renderAtPath(path: string) {
    return renderWithServerInfo(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("workspace token: signs up with workspaceInviteToken and opens the workspace", async () => {
    const user = userEvent.setup();
    renderAtPath("/join/ws-token-abc");

    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({
      workspaceInviteToken: "ws-token-abc",
    });
    // The preview's workspace, for an account whose answer was lost.
    expect(screen.getByTestId("key-signup-workspace")).toHaveTextContent("server-1");
    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(mockSetSession).toHaveBeenCalledWith({ userId: "user-key" });
    expect(mockSetWorkspaceId).toHaveBeenCalledWith("server-key");
    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(mockSignupMutate).not.toHaveBeenCalled();
  });

  it("instance token: signs up with instanceInviteToken and lands with no workspace", async () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: { tokenType: "INSTANCE", expiresAt: null, workspace: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    renderAtPath("/join/inst-token-abc");

    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({
      instanceInviteToken: "inst-token-abc",
    });
    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(mockSetSession).toHaveBeenCalledWith({ userId: "user-key" });
    expect(mockSetWorkspaceId).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
