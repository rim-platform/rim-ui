import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSpaceRouter } from "../../../core/graphql/client";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const COMMAND_ID = "chat.mark_as_read";

vi.mock("../api/usePluginList", () => ({
  fetchPluginList: async () => [
    {
      plugin_id: "acme.tools",
      display_name: "Acme",
      enabled: true,
      runs_commands: [COMMAND_ID],
      granted_commands: [COMMAND_ID],
    },
  ],
}));

vi.mock("../api/pluginCommandGrants", () => ({
  recordPluginCommandRun: async () => null,
}));

import { runCommandForPlugin } from "./pluginCommandRunner";

const REMOTE = "remote-ws";
const LOCAL = "local-ws";
const HOST = "host-b";

const COMMAND = {
  id: COMMAND_ID,
  title: "Mark As Read",
  description: "",
  category: "chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: true,
  keybindCapable: true,
  dangerous: false,
  sensitivity: "SAFE",
  arguments: [],
};

function answer(body: string): Response {
  const { query } = JSON.parse(body) as { query: string };
  const data = query.includes("executeCommand")
    ? { executeCommand: { status: "SUCCESS", message: "" } }
    : { commands: [COMMAND] };
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Body = { query: string; variables: Record<string, unknown> };

const send = vi.fn(async (_host: string, body: string) => answer(body));
const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => answer(init?.body as string));

beforeEach(() => {
  send.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  useRelayStore.setState({
    spaces: { [REMOTE]: { account: "a", spaceId: REMOTE, hostServerId: HOST, kind: "workspace" } },
  });
  setSpaceRouter({ hostOf: (id) => (id === REMOTE ? HOST : null), send });
});

afterEach(() => {
  setSpaceRouter(null);
  useRelayStore.setState({ spaces: {} });
  useWorkspaceStore.setState({ workspaceId: null });
  vi.unstubAllGlobals();
});

describe("a plugin's run in a workspace on another server", () => {
  it("lists and runs the command on the workspace's host", async () => {
    useWorkspaceStore.setState({ workspaceId: REMOTE });
    const result = await runCommandForPlugin("acme.tools", COMMAND_ID, {});
    expect(result.status).toBe("success");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([host]) => host)).toEqual([HOST, HOST, HOST]);
    const bodies = send.mock.calls.map(([, body]) => JSON.parse(body) as Body);
    for (const body of bodies) expect(body.variables.workspaceId).toBe(REMOTE);
    const run = bodies.find((body) => body.query.includes("executeCommand"));
    expect(run?.variables.input).toMatchObject({
      commandId: COMMAND_ID,
      commandContext: { workspaceId: REMOTE },
      initiator: "PLUGIN",
    });
  });

  it("lists and runs the command on this server for a workspace it hosts", async () => {
    useWorkspaceStore.setState({ workspaceId: LOCAL });
    const result = await runCommandForPlugin("acme.tools", COMMAND_ID, {});
    expect(result.status).toBe("success");
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchSpy.mock.calls) {
      expect(JSON.parse(init?.body as string).variables).not.toHaveProperty("workspaceId");
    }
  });
});
