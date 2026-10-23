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
 * The join routes and the first screen, against a server in `registrationMode` that names
 * `defaultWorkspace` (or none) and answers `myServers` with `servers`. Its signup follows the
 * server's token rule: an open server refuses any token and an invite-only one needs exactly
 * one. A workspace invite token puts the invite's workspace in the signup's answer, and
 * `joinServerByInvite` joins that workspace.
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
  /** The server's answer to a signup with `input`, or its refusal. */
  function signupAnswer(input: { instanceInviteToken?: string; workspaceInviteToken?: string }) {
    const tokens = [input.instanceInviteToken, input.workspaceInviteToken].filter(Boolean).length;
    const refusal =
      registrationMode === "OPEN" && tokens > 0
        ? "tokens must not be supplied in open registration mode"
        : registrationMode === "INVITE_ONLY" && tokens !== 1
          ? "exactly one token is required in invite-only mode"
          : null;
    if (refusal) {
      return HttpResponse.json({
        data: null,
        errors: [{ message: refusal, extensions: { code: "VALIDATION" } }],
      });
    }
    const serverId = input.workspaceInviteToken ? INVITE_WORKSPACE : null;
    return HttpResponse.json({
      data: { signupWithInvite: { userId: "user-new", serverId, csrfToken: "tok" } },
    });
  }

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
      const { operationName, variables } = (await request.json()) as {
        operationName?: string;
        variables?: { input?: Record<string, string> };
      };
      if (operationName === "SignupWithInvite") return signupAnswer(variables?.input ?? {});
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
    useRelayStore.setState({ status: "off", info: null });
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

  it("opens direct messages after signup with no workspace on a relay", async () => {
    useRelayStore.setState({
      status: "ready",
      info: { serverId: "relay", roles: [], directSpaceId: "direct" },
    });
    renderSignup("/join", { defaultWorkspace: null, servers: [] });
    await signUpWithPassword();
    expect(await screen.findByText("Workspace direct open")).toBeInTheDocument();
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

  it.each(["OPEN", "INVITE_ONLY"] as const)(
    "opens the invite's workspace over the default after a workspace invite signup (%s)",
    async (registrationMode) => {
      renderSignup("/join/workspace-token", {
        defaultWorkspace: DEFAULT_WORKSPACE,
        servers: [DEFAULT_WORKSPACE, INVITE_WORKSPACE],
        tokenType: "WORKSPACE",
        registrationMode,
      });

      await signUpWithPassword();

      expect(await screen.findByText(`Workspace ${INVITE_WORKSPACE} open`)).toBeInTheDocument();
    },
  );

  it("opens the default workspace after an instance invite signup on an invite-only server", async () => {
    renderSignup("/join/instance-token", {
      defaultWorkspace: DEFAULT_WORKSPACE,
      servers: [DEFAULT_WORKSPACE],
      registrationMode: "INVITE_ONLY",
    });

    await signUpWithPassword();

    expect(await screen.findByText(`Workspace ${DEFAULT_WORKSPACE} open`)).toBeInTheDocument();
  });

  it("opens the invite's workspace over the default after a key signup with a workspace invite", async () => {
    desktop.value = true;
    renderSignup("/join/workspace-token", {
      defaultWorkspace: DEFAULT_WORKSPACE,
      servers: [DEFAULT_WORKSPACE, INVITE_WORKSPACE],
      tokenType: "WORKSPACE",
    });

    await signUpWithKey();

    // An open server takes no token at signup: the invite is joined once the account exists.
    expect(await screen.findByText(`Workspace ${INVITE_WORKSPACE} open`)).toBeInTheDocument();
  });
});
