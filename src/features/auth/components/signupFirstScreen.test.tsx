import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { serverInfoQueryClient } from "../../../test/serverInfo";
import { WorkspaceSelector } from "../../workspaces/components/WorkspaceSelector";
import { useRelayStore } from "../../relay/state/useRelayStore";
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

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    platform: "desktop",
    capabilities: { deviceKeys: true, identityKeys: true },
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
 * The join routes and the first screen, against a server in `registrationMode` that names
 * `defaultWorkspace` (or none) and answers `myServers` with `servers`; `joinServerByInvite`
 * joins the invite's workspace.
 */
function renderSignup(
  path: string,
  {
    defaultWorkspace,
    servers,
    tokenType = "INSTANCE",
    registrationMode = "OPEN",
  }: {
    defaultWorkspace: string | null;
    servers: string[];
    tokenType?: "INSTANCE" | "WORKSPACE";
    registrationMode?: "OPEN" | "INVITE_ONLY";
  },
) {
  const answers: Record<string, unknown> = {
    RegistrationMode: { registrationMode },
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
    JoinServerByInvite: { joinServerByInvite: { serverId: INVITE_WORKSPACE } },
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

async function signUpWithKey() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "finish key signup" }));
}

describe("the first screen after signup", () => {
  beforeEach(() => {
    useRelayStore.setState({ status: "off", info: null });
    useAuthStore.setState({ session: null, csrfToken: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it.each([
    ["an open signup", "/join"],
    ["a signup with an instance invite", "/join/instance-token"],
  ])("opens the default workspace after %s", async (_, path) => {
    renderSignup(path, { defaultWorkspace: DEFAULT_WORKSPACE, servers: [DEFAULT_WORKSPACE] });

    await signUpWithKey();

    expect(await screen.findByText(`Workspace ${DEFAULT_WORKSPACE} open`)).toBeInTheDocument();
    expect(useAuthStore.getState().session).toEqual({ userId: "user-key" });
  });

  it("opens direct messages after signup with no workspace on a relay", async () => {
    useRelayStore.setState({
      status: "ready",
      info: { serverId: "relay", roles: [], directSpaceId: "direct" },
    });
    renderSignup("/join", { defaultWorkspace: null, servers: [] });
    await signUpWithKey();
    expect(await screen.findByText("Workspace direct open")).toBeInTheDocument();
  });

  it("shows the empty state when the server names a default the account did not join", async () => {
    renderSignup("/join", { defaultWorkspace: DEFAULT_WORKSPACE, servers: [] });

    await signUpWithKey();

    expect(await screen.findByText("Welcome to RIM")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it("shows the empty state when the server names no default workspace", async () => {
    renderSignup("/join", { defaultWorkspace: null, servers: [] });

    await signUpWithKey();

    expect(await screen.findByText("Welcome to RIM")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it.each(["OPEN", "INVITE_ONLY"] as const)(
    "opens the invite's workspace over the default after a workspace invite signup (%s)",
    async (registrationMode) => {
      renderSignup("/join/workspace-token", {
        defaultWorkspace: DEFAULT_WORKSPACE,
        servers: [DEFAULT_WORKSPACE, INVITE_WORKSPACE],
        tokenType: "WORKSPACE",
        registrationMode,
      });

      await signUpWithKey();

      // An open server takes no token at signup: the invite is joined once the account exists.
      // An invite-only one takes it, and its answer names the workspace (the stand-in's
      // `server-key`).
      const opened = registrationMode === "OPEN" ? INVITE_WORKSPACE : "server-key";
      expect(await screen.findByText(`Workspace ${opened} open`)).toBeInTheDocument();
    },
  );

  it("opens the default workspace after an instance invite signup on an invite-only server", async () => {
    renderSignup("/join/instance-token", {
      defaultWorkspace: DEFAULT_WORKSPACE,
      servers: [DEFAULT_WORKSPACE],
      registrationMode: "INVITE_ONLY",
    });

    await signUpWithKey();

    expect(await screen.findByText(`Workspace ${DEFAULT_WORKSPACE} open`)).toBeInTheDocument();
  });
});
