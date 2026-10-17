import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { serverInfoQueryClient } from "../../../test/serverInfo";
import { WorkspaceSelector } from "../../workspaces/components/WorkspaceSelector";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useAuthStore } from "../state/useAuthStore";
import { JoinPage } from "./JoinPage";
import { OpenJoinPage } from "./OpenJoinPage";

vi.mock("../../../core/graphql/config", async () => {
  const actual = await vi.importActual<typeof import("../../../core/graphql/config")>(
    "../../../core/graphql/config",
  );
  return { ...actual, getGraphqlEndpoint: () => "http://localhost:8080/api" };
});

vi.mock("../api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: false, isAuthenticated: false }),
}));

// Whether this app can hold an identity key, which puts the key signup first.
const desktop = vi.hoisted(() => ({ value: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    platform: desktop.value ? "desktop" : "web",
    capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value },
  }),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

const DEFAULT_WORKSPACE = "ws-default";
const INVITE_WORKSPACE = "ws-invite";

/** The app's first screen: the workspace selector until a workspace is open, as in the shell. */
function FirstScreen() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  return workspaceId ? <p>Workspace {workspaceId} open</p> : <WorkspaceSelector />;
}

/**
 * The join routes and the first screen, against a server that names `defaultWorkspace` (or
 * none) and answers the signup with `serverId` and `myServers` with `servers`.
 */
function renderSignup(
  path: string,
  {
    defaultWorkspace,
    serverId = null,
    servers,
    tokenType = "INSTANCE",
  }: {
    defaultWorkspace: string | null;
    serverId?: string | null;
    servers: string[];
    tokenType?: "INSTANCE" | "WORKSPACE";
  },
) {
  const answers: Record<string, unknown> = {
    RegistrationMode: { registrationMode: "OPEN" },
    PreviewInviteToken: {
      previewInviteToken: {
        tokenType,
        expiresAt: null,
        workspace:
          tokenType === "WORKSPACE"
            ? {
                serverId: INVITE_WORKSPACE,
                serverName: "Invited",
                invitedByDisplayName: "Alice",
                ownerDisplayName: "Olga",
              }
            : null,
      },
    },
    SignupWithInvite: { signupWithInvite: { userId: "user-new", serverId, csrfToken: "tok" } },
    MyServers: { myServers: servers.map((id) => ({ id, name: id, owner: null })) },
  };
  server.use(
    http.post("*/api", async ({ request }) => {
      const { operationName } = (await request.json()) as { operationName?: string };
      const data = operationName ? answers[operationName] : undefined;
      if (data) return HttpResponse.json({ data });
    }),
  );
  const client = serverInfoQueryClient({}, { defaultWorkspace });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join" element={<OpenJoinPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/" element={<FirstScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signUpWithPassword() {
  const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText("yourname"), "newbie");
  await user.type(screen.getByPlaceholderText("you@example.com"), "newbie@example.com");
  await user.type(screen.getByPlaceholderText("password"), "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

async function signUpWithKey() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "finish key signup" }));
}

describe("the first screen after signup", () => {
  beforeEach(() => {
    desktop.value = false;
    useAuthStore.setState({ session: null, csrfToken: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it.each([
    ["an open password signup", "/join"],
    ["a password signup with an instance invite", "/join/instance-token"],
  ])("opens the default workspace after %s", async (_, path) => {
    renderSignup(path, { defaultWorkspace: DEFAULT_WORKSPACE, servers: [DEFAULT_WORKSPACE] });

    await signUpWithPassword();

    expect(await screen.findByText(`Workspace ${DEFAULT_WORKSPACE} open`)).toBeInTheDocument();
    expect(useAuthStore.getState().session).toEqual({ userId: "user-new" });
  });

  it("opens the default workspace after a key signup", async () => {
    desktop.value = true;
    renderSignup("/join", { defaultWorkspace: DEFAULT_WORKSPACE, servers: [DEFAULT_WORKSPACE] });

    await signUpWithKey();

    expect(await screen.findByText(`Workspace ${DEFAULT_WORKSPACE} open`)).toBeInTheDocument();
  });

  it("shows the empty state when the server names a default the account did not join", async () => {
    renderSignup("/join", { defaultWorkspace: DEFAULT_WORKSPACE, servers: [] });

    await signUpWithPassword();

    expect(await screen.findByText("Welcome to RIM")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it("shows the empty state when the server names no default workspace", async () => {
    renderSignup("/join", { defaultWorkspace: null, servers: [] });

    await signUpWithPassword();

    expect(await screen.findByText("Welcome to RIM")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it("opens the invite's workspace over the default after a workspace invite signup", async () => {
    renderSignup("/join/workspace-token", {
      defaultWorkspace: DEFAULT_WORKSPACE,
      serverId: INVITE_WORKSPACE,
      servers: [DEFAULT_WORKSPACE, INVITE_WORKSPACE],
      tokenType: "WORKSPACE",
    });

    await signUpWithPassword();

    expect(await screen.findByText(`Workspace ${INVITE_WORKSPACE} open`)).toBeInTheDocument();
  });

  it("opens the invite's workspace over the default after a key signup with a workspace invite", async () => {
    desktop.value = true;
    renderSignup("/join/workspace-token", {
      defaultWorkspace: DEFAULT_WORKSPACE,
      servers: [DEFAULT_WORKSPACE, "server-key"],
      tokenType: "WORKSPACE",
    });

    await signUpWithKey();

    expect(await screen.findByText("Workspace server-key open")).toBeInTheDocument();
  });
});
