import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandArgumentType,
  CommandExecutionTarget,
  CommandSensitivity,
} from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { AiToolDefinition } from "../providers/types";
import {
  commandsToBackendTools,
  executeCommandWithProof,
  loadAgentTools,
  makeBackendToolHandler,
  makeDesktopLocalToolHandler,
  mergeBackendWins,
} from "./loader";
import { getAllTools, getTool, registerTool, unregisterTool } from "./registry";
import { makeCommand } from "./test-helpers";
import type { AiToolHandler, RegisteredTool } from "./types";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn() },
}));

// The only hardcoded tool is `get_current_context`.
// Each test controls the hardcoded set by re-implementing this mock so it
// installs whatever the scenario needs via `registerTool`.
vi.mock("./getCurrentContext", () => ({
  registerGetCurrentContextTool: vi.fn(),
}));

import { graphqlClient } from "../../../core/graphql/client";
import { registerGetCurrentContextTool } from "./getCurrentContext";

function clearRegistry(): void {
  for (const tool of getAllTools()) {
    unregisterTool(tool.definition.name);
  }
}

function fakeRegisteredTool(name: string, handler?: AiToolHandler): RegisteredTool {
  const def: AiToolDefinition = {
    name,
    description: `desc for ${name}`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  };
  return {
    definition: def,
    handler: handler ?? (async () => "ok"),
  };
}

describe("mergeBackendWins (pure)", () => {
  it("0 backend + N hardcoded → N hardcoded winners, no drops", () => {
    const hardcoded = [fakeRegisteredTool("a"), fakeRegisteredTool("b"), fakeRegisteredTool("c")];
    const result = mergeBackendWins(hardcoded, []);
    expect(result.winners.map((d) => d.name).sort()).toEqual(["a", "b", "c"]);
    expect(result.droppedBuiltinNames).toEqual([]);
  });

  it("backend with unique name + hardcoded → all winners", () => {
    const hardcoded = [fakeRegisteredTool("a"), fakeRegisteredTool("b")];
    const backend = commandsToBackendTools([makeCommand({ id: "c" })]);
    const result = mergeBackendWins(hardcoded, backend);
    expect(result.winners.map((d) => d.name).sort()).toEqual(["a", "b", "c"]);
    expect(result.droppedBuiltinNames).toEqual([]);
  });

  it("backend with clashing name → backend wins, hardcoded dropped", () => {
    const hardcoded = [fakeRegisteredTool("send_message"), fakeRegisteredTool("b")];
    const backend = commandsToBackendTools([
      makeCommand({ id: "send_message", nlDescription: "from backend" }),
    ]);
    const result = mergeBackendWins(hardcoded, backend);
    expect(result.winners.map((d) => d.name).sort()).toEqual(["b", "send_message"]);
    expect(result.droppedBuiltinNames).toEqual(["send_message"]);
    const winner = result.winners.find((d) => d.name === "send_message")!;
    expect(winner.description).toContain("from backend");
  });

  it("multiple clashes → all hardcoded clashes dropped", () => {
    const hardcoded = [fakeRegisteredTool("a"), fakeRegisteredTool("b"), fakeRegisteredTool("c")];
    const backend = commandsToBackendTools([makeCommand({ id: "a" }), makeCommand({ id: "c" })]);
    const result = mergeBackendWins(hardcoded, backend);
    expect(result.winners.map((d) => d.name).sort()).toEqual(["a", "b", "c"]);
    expect(result.droppedBuiltinNames.sort()).toEqual(["a", "c"]);
  });
});

describe("makeBackendToolHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls executeCommand mutation with commandId, args, and initiator=AGENT", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "SUCCESS",
        message: "ok",
        payload: { result: "done" },
      },
    });
    const handler = makeBackendToolHandler("chat.send_message");
    await handler({ conversation_id: "conv-1", text: "hi" });

    const call = vi.mocked(graphqlClient.request).mock.calls[0]!;
    const variables = call[1] as { input: Record<string, unknown> };
    expect(variables.input.commandId).toBe("chat.send_message");
    expect(variables.input.args).toEqual({
      conversation_id: "conv-1",
      text: "hi",
    });
    expect(variables.input.initiator).toBe("AGENT");
  });

  it("returns the payload as a JSON string on SUCCESS", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "SUCCESS",
        message: "ok",
        payload: { channels: ["a", "b"] },
      },
    });
    const handler = makeBackendToolHandler("chat.list_channels");
    const result = await handler({});
    expect(JSON.parse(result)).toEqual({ channels: ["a", "b"] });
  });

  it("returns string payload verbatim (no double-encoding)", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: "plain text" },
    });
    const handler = makeBackendToolHandler("chat.echo");
    const result = await handler({});
    expect(result).toBe("plain text");
  });

  it("returns '{}' when payload is null/undefined", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: null },
    });
    const handler = makeBackendToolHandler("chat.no_op");
    expect(await handler({})).toBe("{}");
  });

  it("throws with the message when status is ERROR", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "ERROR",
        message: "permission denied",
        payload: null,
      },
    });
    const handler = makeBackendToolHandler("chat.delete_message");
    await expect(handler({ id: "m1" })).rejects.toThrow("permission denied");
  });

  it("throws with a default message when status is ERROR and message is null", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "ERROR", message: null, payload: null },
    });
    const handler = makeBackendToolHandler("chat.broken");
    await expect(handler({})).rejects.toThrow("Command execution failed");
  });

  it("throws ConfirmationRequiredError carrying the server challenge on CONFIRMATION_REQUIRED", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "needs confirmation",
        payload: null,
        confirmationRequired: {
          token: "tok-123",
          argsHash: "hash-abc",
          expiresAt: "2026-04-24T12:00:05Z",
        },
      },
    });
    const handler = makeBackendToolHandler("chat.delete_workspace");
    await expect(handler({ id: "ws-1" })).rejects.toMatchObject({
      name: "ConfirmationRequiredError",
      challenge: {
        commandId: "chat.delete_workspace",
        toolName: "chat.delete_workspace",
        args: { id: "ws-1" },
        token: "tok-123",
        argsHash: "hash-abc",
        expiresAt: "2026-04-24T12:00:05Z",
        serverMessage: "needs confirmation",
      },
    });
  });

  it("threads the registered `description` into the ConfirmationRequiredError challenge", async () => {
    unregisterTool("chat.archive_channel");
    registerTool(
      {
        name: "chat.archive_channel",
        description: "tool description (LLM-facing, unused here)",
        input_schema: { type: "object", properties: {}, additionalProperties: false },
      },
      async () => "unused",
      {
        sensitivity: CommandSensitivity.MUTATING,
        nlDescription: "Archive the channel",
        description:
          "Archive a channel. Members can still read it, but nobody can post until it is unarchived.",
      },
    );

    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "needs confirmation",
        payload: null,
        confirmationRequired: {
          token: "tok-archive",
          argsHash: "hash-archive",
          expiresAt: "2026-04-24T12:00:05Z",
        },
      },
    });

    const handler = makeBackendToolHandler("chat.archive_channel");
    await expect(handler({ conversationId: "conv-1" })).rejects.toMatchObject({
      name: "ConfirmationRequiredError",
      challenge: {
        commandId: "chat.archive_channel",
        description:
          "Archive a channel. Members can still read it, but nobody can post until it is unarchived.",
        nlDescription: "Archive the channel",
      },
    });

    unregisterTool("chat.archive_channel");
  });

  it("throws plain Error when CONFIRMATION_REQUIRED is missing the challenge payload", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "missing challenge",
        payload: null,
      },
    });
    const handler = makeBackendToolHandler("chat.delete_workspace");
    await expect(handler({})).rejects.toThrow(
      "CONFIRMATION_REQUIRED status returned without a challenge payload",
    );
  });
});

describe("executeCommandWithProof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits confirmation.inBandToken on the re-call mutation", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "SUCCESS",
        message: "ok",
        payload: { ok: true },
      },
    });
    const result = await executeCommandWithProof(
      "chat.delete_message",
      { id: "m1" },
      "chat.delete_message",
      { token: "tok-xyz", argsHash: "hash-9" },
    );

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input.commandId).toBe("chat.delete_message");
    expect(variables.input.args).toEqual({ id: "m1" });
    expect(variables.input.initiator).toBe("AGENT");
    expect(variables.input.confirmation).toEqual({
      inBandToken: { token: "tok-xyz", argsHash: "hash-9" },
    });
    expect(JSON.parse(result)).toEqual({ ok: true });
  });

  it("re-throws ConfirmationRequiredError when the server re-issues a challenge (stale-token path)", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "stale",
        payload: null,
        confirmationRequired: {
          token: "tok-fresh",
          argsHash: "hash-9",
          expiresAt: "2026-04-24T12:01:00Z",
        },
      },
    });
    await expect(
      executeCommandWithProof("chat.delete_message", { id: "m1" }, "chat.delete_message", {
        token: "tok-stale",
        argsHash: "hash-9",
      }),
    ).rejects.toMatchObject({
      name: "ConfirmationRequiredError",
      challenge: { token: "tok-fresh" },
    });
  });

  it("throws plain Error on ERROR status", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "ERROR", message: "permission denied", payload: null },
    });
    await expect(
      executeCommandWithProof("chat.x", {}, "chat.x", { token: "t", argsHash: "h" }),
    ).rejects.toThrow("permission denied");
  });
});

describe("loadAgentTools (side-effecting integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
  });

  it("0 backend + 3 hardcoded → registry has 3 tools", async () => {
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("a").definition, async () => "a");
      registerTool(fakeRegisteredTool("b").definition, async () => "b");
      registerTool(fakeRegisteredTool("c").definition, async () => "c");
    });
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({ commands: [] });

    const result = await loadAgentTools();
    expect(getAllTools().length).toBe(3);
    expect(result.droppedBuiltinNames).toEqual([]);
  });

  it("1 unique backend + 3 hardcoded → registry has 4 tools", async () => {
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("a").definition, async () => "a");
      registerTool(fakeRegisteredTool("b").definition, async () => "b");
      registerTool(fakeRegisteredTool("c").definition, async () => "c");
    });
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      commands: [makeCommand({ id: "d", nlDescription: "from backend" })],
    });

    const result = await loadAgentTools();
    expect(getAllTools().length).toBe(4);
    expect(getTool("d")).toBeDefined();
    expect(result.droppedBuiltinNames).toEqual([]);
  });

  it("1 clashing backend + 3 hardcoded → registry has 3 tools, backend version wins (verify by handler identity)", async () => {
    const builtinHandler: AiToolHandler = async () => "BUILTIN";
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("a").definition, async () => "a");
      registerTool(fakeRegisteredTool("send_message").definition, builtinHandler);
      registerTool(fakeRegisteredTool("c").definition, async () => "c");
    });
    vi.mocked(graphqlClient.request)
      .mockResolvedValueOnce({
        // First call: AI commands list during loadAgentTools
        commands: [makeCommand({ id: "send_message", nlDescription: "BACKEND VERSION" })],
      })
      .mockResolvedValueOnce({
        // Second call: executeCommand from invoking the winning handler
        executeCommand: { status: "SUCCESS", message: "ok", payload: { ok: true } },
      });

    const result = await loadAgentTools();

    expect(getAllTools().length).toBe(3);
    expect(result.droppedBuiltinNames).toEqual(["send_message"]);

    const winner = getTool("send_message");
    expect(winner).toBeDefined();
    // Handler identity check: builtin handler is gone, replaced by the backend
    // handler from makeBackendToolHandler (which routes via executeCommand).
    expect(winner!.handler).not.toBe(builtinHandler);
    const result2 = await winner!.handler({});
    expect(JSON.parse(result2)).toEqual({ ok: true });
    expect(winner!.definition.description).toContain("BACKEND VERSION");
  });

  it("backend fetch error → registry keeps hardcoded tools, no throw", async () => {
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("a").definition, async () => "a");
      registerTool(fakeRegisteredTool("b").definition, async () => "b");
      registerTool(fakeRegisteredTool("c").definition, async () => "c");
    });
    vi.mocked(graphqlClient.request).mockRejectedValueOnce(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await loadAgentTools();

    expect(getAllTools().length).toBe(3);
    expect(result.droppedBuiltinNames).toEqual([]);
    expect(result.winners.map((d) => d.name).sort()).toEqual(["a", "b", "c"]);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("preserves sensitivity on RegisteredTool metadata for clashing backend tool", async () => {
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("send_message").definition, async () => "B");
    });
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      commands: [
        makeCommand({
          id: "send_message",
          sensitivity: CommandSensitivity.MUTATING,
          dangerous: true,
        }),
      ],
    });

    await loadAgentTools();

    const winner = getTool("send_message");
    expect(winner!.sensitivity).toBe(CommandSensitivity.MUTATING);
    expect(winner!.requiresConfirmation).toBe(true);
  });

  it("calling loadAgentTools twice keeps backend winners (idempotency, no race window)", async () => {
    const builtinHandler: AiToolHandler = async () => "BUILTIN_VERSION";
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("a").definition, async () => "a");
      registerTool(fakeRegisteredTool("send_message").definition, builtinHandler);
    });
    vi.mocked(graphqlClient.request)
      .mockResolvedValueOnce({
        commands: [makeCommand({ id: "send_message", nlDescription: "BACKEND_VERSION" })],
      })
      .mockResolvedValueOnce({
        commands: [makeCommand({ id: "send_message", nlDescription: "BACKEND_VERSION" })],
      })
      .mockResolvedValueOnce({
        executeCommand: { status: "SUCCESS", message: "ok", payload: { ok: true } },
      });

    await loadAgentTools();
    await loadAgentTools();

    // After two boots, the registry must contain the backend winner — not
    // the builtin handler the hardcoded-tool registration installs on the
    // second boot — so the dropped builtin never shadows the backend handler
    // under the same name, even briefly.
    expect(getAllTools().length).toBe(2);
    const winner = getTool("send_message");
    expect(winner).toBeDefined();
    expect(winner!.handler).not.toBe(builtinHandler);
    const result = await winner!.handler({});
    expect(JSON.parse(result)).toEqual({ ok: true });
    expect(winner!.definition.description).toContain("BACKEND_VERSION");
  });
});

describe("loadAgentTools — workspace context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
  });

  // The AI surface is per workspace, so the loader sends the active workspace.
  it("sends the active workspace as commandContext when loading the AI surface", async () => {
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {});
    useWorkspaceStore.setState({ workspaceId: "ws-feature" });
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({ commands: [] });

    await loadAgentTools();

    expect(vi.mocked(graphqlClient.request).mock.calls[0][1]).toEqual({
      commandContext: { workspaceId: "ws-feature" },
    });
  });

  it("sends no commandContext when no workspace is active", async () => {
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {});
    useWorkspaceStore.setState({ workspaceId: null });
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({ commands: [] });

    await loadAgentTools();

    expect(vi.mocked(graphqlClient.request).mock.calls[0][1]).toEqual({});
  });
});

describe("desktop-local agent tools run in the client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.getState().clearWorkspaceId();
  });

  it("routes a DESKTOP_LOCAL command to its local handler, not executeCommand", async () => {
    const [tool] = commandsToBackendTools([
      makeCommand({
        id: "workspace.navigate_to_channel",
        executionTarget: CommandExecutionTarget.DESKTOP_LOCAL,
      }),
    ]);

    const result = await tool!.handler({ conversation_id: "conv-9" });

    expect(graphqlClient.request).not.toHaveBeenCalled();
    expect(useShellStore.getState().selectedConversationId).toBe("conv-9");
    expect(JSON.parse(result)).toEqual({
      status: "done",
      commandId: "workspace.navigate_to_channel",
    });
  });

  it("converts workspace_id for workspace.switch_workspace", async () => {
    await makeDesktopLocalToolHandler("workspace.switch_workspace")({ workspace_id: "ws-2" });

    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
  });

  it("sends a non-Safe DESKTOP_LOCAL command to the server gate instead of running it", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: null },
    });
    const [tool] = commandsToBackendTools([
      makeCommand({
        id: "workspace.toggle_sidebar",
        executionTarget: CommandExecutionTarget.DESKTOP_LOCAL,
        sensitivity: CommandSensitivity.MUTATING,
      }),
    ]);

    await tool!.handler({});

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input.commandId).toBe("workspace.toggle_sidebar");
  });

  it("keeps BACKEND commands on executeCommand", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: null },
    });
    const [tool] = commandsToBackendTools([makeCommand({ id: "state.get" })]);

    await tool!.handler({ key: "deploy.lock" });

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input.commandId).toBe("state.get");
  });

  it("opens a thread from chat.open_thread's root_message_id", async () => {
    await makeDesktopLocalToolHandler("chat.open_thread")({ root_message_id: "msg-4" });

    expect(useShellStore.getState().isThreadOpen).toBe(true);
    expect(useShellStore.getState().selectedRootMessageId).toBe("msg-4");
  });

  it("throws for a desktop-local command this client has no handler for", async () => {
    await expect(makeDesktopLocalToolHandler("workspace.not_a_command")({})).rejects.toThrow(
      "workspace.not_a_command is not available in this client",
    );
    expect(graphqlClient.request).not.toHaveBeenCalled();
  });
});

describe("commandContext bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useWorkspaceStore.getState().clearWorkspaceId();
    useShellStore.getState().reset();
    queryClient.clear();
  });

  it("makeBackendToolHandler omits commandContext when no workspace is selected", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: null },
    });

    await makeBackendToolHandler("chat.noop")({});

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input).not.toHaveProperty("commandContext");
  });

  it("makeBackendToolHandler attaches commandContext snapshot from shell + workspace stores", async () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-7");
    useShellStore.getState().setSelectedConversationId("conv-3");
    useShellStore.getState().setFocusedSurface("composer");

    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: null },
    });

    await makeBackendToolHandler("chat.noop")({});

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input.commandContext).toEqual({
      workspaceId: "ws-7",
      conversationId: "conv-3",
      focusedSurface: "composer",
    });
  });

  it("executeCommandWithProof attaches the same commandContext snapshot on the re-call", async () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-7");
    useShellStore.getState().setSelectedConversationId("conv-3");
    useShellStore.getState().openThreadForMessage("msg-root-2");
    queryClient.setQueryData(queryKeys.threadByRoot("ws-7", "conv-3", "msg-root-2"), {
      id: "thread-2",
    });

    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: { status: "SUCCESS", message: "ok", payload: null },
    });

    await executeCommandWithProof("chat.delete_message", { id: "m1" }, "chat.delete_message", {
      token: "tok",
      argsHash: "hash",
    });

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input.commandContext).toEqual({
      workspaceId: "ws-7",
      conversationId: "conv-3",
      threadId: "thread-2",
    });
    expect(variables.input.confirmation).toEqual({
      inBandToken: { token: "tok", argsHash: "hash" },
    });
  });
});

describe("end-to-end: agent → backend → result loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
  });

  it("loadAgentTools → invoke chat.list_channels handler → executeCommand returns channels", async () => {
    // Hardcoded builtin with the same name to prove backend-wins dedup.
    const builtinHandler: AiToolHandler = async () => "BUILTIN_LIST";
    vi.mocked(registerGetCurrentContextTool).mockImplementation(() => {
      registerTool(fakeRegisteredTool("chat.list_channels").definition, builtinHandler);
    });

    // Two-call mock chain: first AgentListAiCommands (returns the backend
    // command schema), second executeCommand (returns the channel list).
    vi.mocked(graphqlClient.request)
      .mockResolvedValueOnce({
        commands: [
          makeCommand({
            id: "chat.list_channels",
            title: "List Channels",
            description: "List all channels in the current workspace.",
            nlDescription: "List all channels in the current workspace, ordered by name.",
            sensitivity: CommandSensitivity.SAFE,
            dangerous: false,
            arguments: [
              {
                name: "server_id",
                title: "Workspace",
                description: "Workspace/server identifier.",
                argumentType: CommandArgumentType.WORKSPACE_ID,
                required: true,
                defaultValue: null,
                allowedValues: null,
              },
            ],
          }),
        ],
      })
      .mockResolvedValueOnce({
        executeCommand: {
          status: "SUCCESS",
          message: "ok",
          payload: {
            channels: [
              { id: "c1", name: "general" },
              { id: "c2", name: "random" },
            ],
          },
        },
      });

    const result = await loadAgentTools();

    // Backend version replaced the hardcoded builtin under the same name.
    expect(result.droppedBuiltinNames).toEqual(["chat.list_channels"]);
    expect(result.winners.map((d) => d.name)).toEqual(["chat.list_channels"]);

    const tool = getTool("chat.list_channels");
    expect(tool).toBeDefined();
    expect(tool!.handler).not.toBe(builtinHandler);

    // Tool definition reflects the real backend schema through the
    // generator: nl_description used, server_id required, type=string.
    expect(tool!.definition.description).toContain("List all channels");
    expect(tool!.definition.input_schema).toEqual({
      type: "object",
      properties: {
        server_id: {
          type: "string",
          description: "Workspace/server identifier.",
        },
      },
      required: ["server_id"],
      additionalProperties: false,
    });

    // Invoke the handler — should round-trip through executeCommand.
    const raw = await tool!.handler({ server_id: "test-server-id" });

    // Mutation was called with the right vars: commandId, args, AGENT.
    const execCall = vi.mocked(graphqlClient.request).mock.calls[1]!;
    const variables = execCall[1] as { input: Record<string, unknown> };
    expect(variables.input.commandId).toBe("chat.list_channels");
    expect(variables.input.args).toEqual({ server_id: "test-server-id" });
    expect(variables.input.initiator).toBe("AGENT");

    // Payload survives the JSON round-trip.
    expect(JSON.parse(raw)).toEqual({
      channels: [
        { id: "c1", name: "general" },
        { id: "c2", name: "random" },
      ],
    });
  });
});

/* ----------------------------------------------- no-parallel-registry guard */

describe("no parallel registry", () => {
  // Glob of the `tools/builtins/` directory, which must not exist. Vite's
  // `import.meta.glob` returns an empty object when the pattern matches zero
  // files. If any file appears under `./builtins/*`, this test fails: the
  // agent's tools come from the backend command registry, not a parallel
  // client-side one.
  it("tools/builtins/ has zero files (the parallel registry is deleted)", () => {
    const glob = import.meta.glob("./builtins/*");
    expect(Object.keys(glob)).toEqual([]);
  });

  it("get_current_context carve-out still exists at the top-level location", () => {
    // Globbing the module outside loader's mocked path proves it is still
    // reachable. If `getCurrentContext.ts` ever disappears, the agent loses
    // its one view of client runtime state.
    const mod = import.meta.glob("./getCurrentContext.ts");
    expect(Object.keys(mod)).toEqual(["./getCurrentContext.ts"]);
  });
});
