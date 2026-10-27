import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { renderWithServerInfo } from "../../../test/serverInfo";

const mockNavigate = vi.fn();
const mockJoinServerMutate = vi.fn();
const mockSetSession = vi.fn();
const mockSetWorkspaceId = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

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

const desktop = vi.hoisted(() => ({ value: true }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value } }),
}));

// The accounts this device holds keys for, and their sign-in, which has its own tests.
const deviceAccounts = vi.hoisted(() => ({ data: [] as unknown[], isPending: false }));

vi.mock("../../key-identity/api/useDeviceKeyAccounts", () => ({
  useDeviceKeyAccounts: () => deviceAccounts,
}));

vi.mock("../../key-identity/components/DeviceKeySignIn", () => ({
  DeviceKeySignIn: ({ onSuccess }: { onSuccess: (userId: string) => void }) => (
    <button type="button" onClick={() => onSuccess("u-bob")}>
      Sign in as bob
    </button>
  ),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { JoinPage } from "./JoinPage";
import { DEAD_INVITE_MESSAGE } from "./InvalidTokenState";
import { expectReachableByKeyboard } from "../../../test/keyboard";

beforeEach(() => {
  config.mode = "INVITE_ONLY";
  config.isPending = false;
  desktop.value = true;
  deviceAccounts.data = [];
});

/** The navigation state the page arrived with, as JSON. */
function StateProbe() {
  return <p>{JSON.stringify(useLocation().state)}</p>;
}

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
          <Route path="/login" element={<StateProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("WORKSPACE preview → JoinForm renders with workspace-variant copy", () => {
    renderAtPath("/join/ws-token-abc");
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    // Negation: workspace variant must NOT show the generic instance heading
    expect(screen.queryByText("Create your RIM account")).not.toBeInTheDocument();
  });

  it("reaches its primary actions by keyboard", async () => {
    const user = userEvent.setup();
    renderAtPath("/join/ws-token-abc");
    await expectReachableByKeyboard(user, [
      screen.getByRole("button", { name: /start key signup/i }),
      screen.getByRole("button", { name: /finish key signup/i }),
    ]);
  });

  it("waits for the registration mode before showing the form", () => {
    config.isPending = true;
    renderAtPath("/join/ws-token-abc");

    expect(screen.getByText("Loading invite...")).toBeInTheDocument();
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();
  });

  it("workspace token on an open server: signs up with no token", () => {
    config.mode = "OPEN";
    renderAtPath("/join/ws-token-abc");

    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
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

  it("INVALID_TOKEN error: says the link is dead and offers Go to RIM", async () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { errors: [{ extensions: { code: "INVALID_TOKEN" } }] } },
      refetch: vi.fn(),
    });

    renderAtPath("/join/bad-token");

    expect(screen.getByText(DEAD_INVITE_MESSAGE)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Go to RIM" }));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("EXPIRED_TOKEN error: says the link is dead and offers Go to RIM", async () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { errors: [{ extensions: { code: "EXPIRED_TOKEN" } }] } },
      refetch: vi.fn(),
    });

    renderAtPath("/join/expired-token");

    expect(screen.getByText(DEAD_INVITE_MESSAGE)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Go to RIM" }));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("signed out with a stored account: offers Sign in as above the signup", async () => {
    deviceAccounts.data = [{ principalId: "rimp1_bob", username: "bob" }];
    renderAtPath("/join/ws-token-abc");

    expect(
      screen.getByText("Already have an account? Sign in to join Acme Corp."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in as bob" }));
    expect(mockSetSession).toHaveBeenCalledWith({ userId: "u-bob" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("signed out without a stored account: links to sign-in and back to the invite", async () => {
    renderAtPath("/join/ws-token-abc");

    await userEvent.setup().click(screen.getByRole("link", { name: "Sign in" }));
    expect(screen.getByText('{"returnTo":"/join/ws-token-abc"}')).toBeInTheDocument();
  });

  it("an instance invite offers no sign-in", () => {
    mockUsePreviewInviteToken.mockReturnValue({
      data: { tokenType: "INSTANCE", expiresAt: null, workspace: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAtPath("/join/inst-token-abc");

    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
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
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();

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
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();
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

describe("JoinPage — create account with a key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    mockUsePreviewInviteToken.mockReturnValue({ ...mockPreviewData, refetch: vi.fn() });
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
