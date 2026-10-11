import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type {
  AiChatRequest,
  AiMessage,
  AiProvider,
  AiProviderConfig,
  AiStreamChunk,
} from "../providers/types";
import { useAgentStore } from "../state/useAgentStore";
import { useLiveModelsStore } from "../state/useLiveModelsStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { commandsToBackendTools } from "../tools/loader";
import { getAllTools, registerTool, unregisterTool } from "../tools/registry";
import { makeCommand } from "../tools/test-helpers";

// Singleton rate limiter is module-state — reset via private-cast between tests
// so the 10/min cap doesn't bleed across the matrix.
import { agentRateLimiter } from "./rateLimiter";

// graphqlClient.request is the chokepoint for every backend handler call. We
// mock it module-wide so each test can stage `executeCommand` responses.
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn() },
}));

import { graphqlClient } from "../../../core/graphql/client";

// getProvider is the only path agentEngine uses to obtain a chat stream.
// We mock the registry and inject a stub that yields scripted chunks.
vi.mock("../providers/registry", () => ({
  getProvider: vi.fn(),
}));

import { getProvider } from "../providers/registry";

import { runAgent } from "./agentEngine";

/* ------------------------------------------------------------------ helpers */

function clearRegistry(): void {
  for (const tool of getAllTools()) {
    unregisterTool(tool.definition.name);
  }
}

function resetRateLimiter(): void {
  // Singleton state — reach in to reset between tests so the per-minute cap
  // doesn't bleed. Private-cast is intentional and scoped to the test harness.
  const rl = agentRateLimiter as unknown as {
    runTimestamps: number[];
    sessionCost: number;
  };
  rl.runTimestamps = [];
  rl.sessionCost = 0;
}

interface ScriptedProviderOptions {
  rounds: AiStreamChunk[][];
  config?: Partial<AiProviderConfig>;
  onRequest?: (req: AiChatRequest) => void;
}

/**
 * Build a provider that yields one scripted chunk-stream per call to `chat`.
 * The agent engine calls `chat` once per LLM round (initial turn + one per
 * tool-result follow-up). Each inner array drains in order; the next call to
 * `chat` advances to the next array.
 *
 * If the engine asks for more rounds than scripted, the stream closes empty
 * (no `done` chunk) — the test will hang. Always script enough rounds.
 */
function makeScriptedProvider(opts: ScriptedProviderOptions): AiProvider {
  let round = 0;
  const config: AiProviderConfig = {
    id: "test-provider",
    name: "Test",
    models: [
      {
        id: "test-model",
        name: "Test Model",
        contextWindow: 100_000,
        supportsTools: true,
        supportsStreaming: true,
        inputPricePerMToken: 0,
        outputPricePerMToken: 0,
      },
    ],
    ...opts.config,
  };

  return {
    config,
    async *chat(req: AiChatRequest): AsyncIterable<AiStreamChunk> {
      opts.onRequest?.(req);
      const chunks = opts.rounds[round] ?? [
        { kind: "done", usage: { inputTokens: 0, outputTokens: 0 } },
      ];
      round += 1;
      for (const c of chunks) {
        yield c;
      }
    },
  };
}

/**
 * Drive `runAgent` to completion. The engine signals done via store status,
 * not a returned promise resolution value, so we await the run promise
 * (which resolves when the engine's while-loop exits) then read store state.
 */
async function runOneTurn(prompt: string, providerId = "test-provider"): Promise<void> {
  await runAgent({
    prompt,
    providerId,
    modelId: "test-model",
  });
}

/* ------------------------------------------------------------------ fixtures */

/**
 * Backend command IDs + arg shapes that ship today (post-#36 + #48).
 *
 * **Arg names are load-bearing** — they must match
 * `rim_infra_services/src/command/registry.rs` exactly. The agent engine
 * passes them through verbatim to `executeCommand.args`; a drift here
 * shadows a real backend regression that this harness is designed to catch.
 * Post-#49 the matrix also covers the five new AI-callable builtins
 * (list_members, search_messages, get_recent_messages, pin_message,
 * toggle_reaction) — arg names verified in Strange's ship report.
 */
const BACKEND_TOOL_FIXTURES: Array<{
  commandId: string;
  sensitivity: CommandSensitivity;
  sampleArgs: Record<string, unknown>;
  backendPayload: unknown;
  /** True if this command has `dangerous: true` and would gate through confirmation. */
  dangerous?: boolean;
}> = [
  {
    commandId: "chat.list_channels",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: { server_id: "ws-1" },
    backendPayload: {
      channels: [
        { id: "c1", name: "general" },
        { id: "c2", name: "random" },
      ],
    },
  },
  {
    commandId: "workspace.navigate_to_channel",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: { conversation_id: "c1" },
    backendPayload: { ok: true },
  },
  {
    commandId: "workspace.switch_workspace",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: { workspace_id: "ws-2" },
    backendPayload: { ok: true },
  },
  {
    commandId: "workspace.open_settings",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: {},
    backendPayload: { ok: true },
  },
  {
    commandId: "chat.open_thread",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: { root_message_id: "m-7" },
    backendPayload: { ok: true },
  },
  {
    commandId: "chat.post_message",
    sensitivity: CommandSensitivity.MUTATING,
    sampleArgs: { server_id: "ws-1", conversation_id: "c1", text: "hi" },
    backendPayload: { messageId: "msg-99" },
  },
  {
    commandId: "chat.create_channel",
    sensitivity: CommandSensitivity.MUTATING,
    sampleArgs: {
      server_id: "ws-1",
      name: "new-room",
      description: "Optional channel topic.",
    },
    backendPayload: { channelId: "c-new" },
  },
  // #49 additions — arg names verified against
  // `rim_infra_services/src/command/registry.rs:1222..1465`.
  {
    commandId: "chat.list_members",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: { server_id: "ws-1" },
    backendPayload: {
      members: [
        { username: "alice", role: "admin", joined: "2026-01-10" },
        { username: "bob", role: "member", joined: "2026-02-03" },
      ],
    },
  },
  {
    commandId: "chat.search_messages",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: {
      server_id: "ws-1",
      query: "deploy",
      conversation_id: "c1",
      limit: 10,
    },
    backendPayload: {
      results: [
        {
          id: "m-1",
          channel: "general",
          author: "alice",
          text: "deploy went green",
          sentAt: "2026-04-24T09:12:00Z",
        },
      ],
    },
  },
  {
    commandId: "chat.get_recent_messages",
    sensitivity: CommandSensitivity.SAFE,
    sampleArgs: { server_id: "ws-1", conversation_id: "c1", limit: 30 },
    backendPayload: {
      messages: [
        { author: "alice", text: "hey", sentAt: "2026-04-24T09:00:00Z" },
        { author: "bob", text: "what's up", sentAt: "2026-04-24T09:01:00Z" },
      ],
    },
  },
  {
    commandId: "chat.pin_message",
    sensitivity: CommandSensitivity.MUTATING,
    sampleArgs: { server_id: "ws-1", conversation_id: "c1", message_id: "m-7" },
    backendPayload: { success: true, pinned: "m-7" },
  },
  {
    commandId: "chat.toggle_reaction",
    sensitivity: CommandSensitivity.MUTATING,
    sampleArgs: {
      server_id: "ws-1",
      conversation_id: "c1",
      message_id: "m-7",
      emoji: "thumbsup",
    },
    backendPayload: {
      success: true,
      toggled: "m-7",
      emoji: "thumbsup",
      action: "added",
    },
  },
];

/* --------------------------------------------------------------------- setup */

beforeEach(() => {
  vi.clearAllMocks();
  clearRegistry();
  resetRateLimiter();
  useAgentStore.getState().reset();
  useShellStore.getState().reset();
  useWorkspaceStore.getState().clearWorkspaceId();
  useLiveModelsStore.setState({ byProvider: {} });
});

afterEach(() => {
  clearRegistry();
});

/* ---------------------------------------------------------------- harness it */

describe("runAgent — engine harness sanity", () => {
  it("text-only response (no tools) appends text and ends in 'done'", async () => {
    vi.mocked(getProvider).mockReturnValue(
      makeScriptedProvider({
        rounds: [
          [
            { kind: "text_delta", text: "Hello " },
            { kind: "text_delta", text: "world" },
            { kind: "done", usage: { inputTokens: 5, outputTokens: 2 } },
          ],
        ],
      }),
    );

    await runOneTurn("hi");

    expect(useAgentStore.getState().status).toBe("done");
    expect(useAgentStore.getState().usage).toEqual({
      inputTokens: 5,
      outputTokens: 2,
    });
  });

  it("missing provider sets status=error and never invokes graphqlClient", async () => {
    vi.mocked(getProvider).mockReturnValue(undefined);

    await runOneTurn("hi", "nonexistent");

    expect(useAgentStore.getState().status).toBe("error");
    expect(vi.mocked(graphqlClient.request)).not.toHaveBeenCalled();
  });

  it("provider error chunk halts the loop and never re-enters chat()", async () => {
    let chatCalls = 0;
    vi.mocked(getProvider).mockReturnValue(
      makeScriptedProvider({
        rounds: [
          [{ kind: "error", message: "provider 401: bad key" }],
          // If the engine re-enters chat after error, this round drains.
          // The test would observe chatCalls > 1 and fail the round-counting
          // assertion below.
          [{ kind: "done", usage: { inputTokens: 0, outputTokens: 0 } }],
        ],
        onRequest: () => {
          chatCalls += 1;
        },
      }),
    );

    await runOneTurn("hi");

    expect(useAgentStore.getState().status).toBe("error");
    expect(chatCalls).toBe(1);
  });
});

describe("runAgent — context window", () => {
  /** An earlier turn of about 1 000 tokens: over 70% of a 1 000-token window, far under 100 000. */
  const earlier: AiMessage[] = [
    { role: "user", content: "x".repeat(4_000) },
    { role: "assistant", content: "ok" },
  ];

  /** How many messages the provider receives for a prompt that follows `earlier`. */
  async function sentMessageCount(): Promise<number> {
    let sent = 0;
    vi.mocked(getProvider).mockReturnValue(
      makeScriptedProvider({
        rounds: [[{ kind: "done", usage: { inputTokens: 0, outputTokens: 0 } }]],
        onRequest: (req) => {
          sent = req.messages.length;
        },
      }),
    );
    await runAgent({
      prompt: "hi",
      providerId: "test-provider",
      modelId: "test-model",
      existingMessages: earlier,
    });
    return sent;
  }

  it("trims the history to the live list's context window when it has the model", async () => {
    useLiveModelsStore.setState({
      byProvider: {
        "test-provider": [
          {
            id: "test-model",
            name: "Test Model",
            contextWindow: 1_000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
      },
    });
    expect(await sentMessageCount()).toBe(2);
  });

  it("keeps the fallback table's context window when the live list lacks the model", async () => {
    expect(await sentMessageCount()).toBe(3);
  });
});

/* -------------------------------------------------- per-tool engine matrix */

describe("runAgent — agent loop dispatches each backend-shipped tool", () => {
  for (const fixture of BACKEND_TOOL_FIXTURES) {
    // Skip dangerous tools for now — the confirmation modal flow would need
    // its own scaffolding (modal store stubbed to auto-approve). Cover those
    // in a separate `dangerous tools` describe block once #55 unblocks.
    if (fixture.dangerous) continue;

    it(`${fixture.commandId}: tool_use → executeCommand({commandId, args, AGENT}) → tool_result fed back`, async () => {
      // 1) Register the backend tool exactly the way `loadAgentTools` would,
      // routing the handler through `commandsToBackendTools` (which itself
      // wraps `makeBackendToolHandler` → graphqlClient.request).
      const [backendTool] = commandsToBackendTools([
        makeCommand({
          id: fixture.commandId,
          sensitivity: fixture.sensitivity,
          dangerous: false,
        }),
      ]);
      registerTool(backendTool!.definition, backendTool!.handler, backendTool!.options);

      // 2) Stage the executeCommand response BEFORE running the engine.
      vi.mocked(graphqlClient.request).mockResolvedValueOnce({
        executeCommand: {
          status: "SUCCESS",
          message: "ok",
          payload: fixture.backendPayload,
        },
      });

      // 3) Script two rounds: first emits a tool_use targeting the fixture
      // command, second emits text after the tool_result is fed back, then done.
      let secondRoundMessages: AiChatRequest["messages"] | undefined;
      vi.mocked(getProvider).mockReturnValue(
        makeScriptedProvider({
          rounds: [
            [
              {
                kind: "tool_use",
                id: "call-1",
                name: fixture.commandId,
                input: fixture.sampleArgs,
              },
              { kind: "done", usage: { inputTokens: 10, outputTokens: 4 } },
            ],
            [
              { kind: "text_delta", text: "Done." },
              { kind: "done", usage: { inputTokens: 12, outputTokens: 6 } },
            ],
          ],
          onRequest: (req) => {
            // Capture the messages array on the second round so we can assert
            // the engine fed the tool_result back into the prompt.
            if (
              !secondRoundMessages &&
              req.messages.some(
                (m) =>
                  m.role === "user" &&
                  Array.isArray(m.content) &&
                  m.content.some((b) => b.type === "tool_result"),
              )
            ) {
              secondRoundMessages = req.messages;
            }
          },
        }),
      );

      // 4) Run the engine.
      await runOneTurn("do the thing");

      // 5) Assert the executeCommand mutation was dispatched correctly.
      expect(vi.mocked(graphqlClient.request)).toHaveBeenCalledOnce();
      const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
        input: Record<string, unknown>;
      };
      expect(variables.input.commandId).toBe(fixture.commandId);
      expect(variables.input.args).toEqual(fixture.sampleArgs);
      expect(variables.input.initiator).toBe("AGENT");

      // 6) Assert the tool_result was appended to the message history and the
      // engine looped into a second LLM round with it included.
      expect(secondRoundMessages).toBeDefined();
      const toolResultMsg = secondRoundMessages!.find(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === "tool_result"),
      );
      expect(toolResultMsg).toBeDefined();
      const toolResultBlock = (
        toolResultMsg!.content as Array<{
          type: string;
          tool_use_id?: string;
          content?: string;
        }>
      ).find((b) => b.type === "tool_result");
      expect(toolResultBlock).toBeDefined();
      expect(toolResultBlock!.tool_use_id).toBe("call-1");
      // Payload survives the JSON round-trip from backend → handler → tool_result.
      expect(JSON.parse(toolResultBlock!.content!)).toEqual(fixture.backendPayload);

      // 7) Final state is `done`, not `error`.
      expect(useAgentStore.getState().status).toBe("done");
    });
  }
});

/* ------------------------------------------------------- error-path coverage */

describe("runAgent — backend errors surface as is_error tool_result", () => {
  it("ERROR status → tool_result.is_error=true, engine continues to next round", async () => {
    const [backendTool] = commandsToBackendTools([
      makeCommand({
        id: "chat.list_channels",
        sensitivity: CommandSensitivity.SAFE,
        dangerous: false,
      }),
    ]);
    registerTool(backendTool!.definition, backendTool!.handler, backendTool!.options);

    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "ERROR",
        message: "permission denied",
        payload: null,
      },
    });

    let secondRoundMessages: AiChatRequest["messages"] | undefined;
    vi.mocked(getProvider).mockReturnValue(
      makeScriptedProvider({
        rounds: [
          [
            {
              kind: "tool_use",
              id: "call-1",
              name: "chat.list_channels",
              input: { server_id: "ws-1" },
            },
            { kind: "done", usage: { inputTokens: 5, outputTokens: 2 } },
          ],
          [
            { kind: "text_delta", text: "Sorry, that failed." },
            { kind: "done", usage: { inputTokens: 6, outputTokens: 3 } },
          ],
        ],
        onRequest: (req) => {
          if (
            !secondRoundMessages &&
            req.messages.some(
              (m) =>
                m.role === "user" &&
                Array.isArray(m.content) &&
                m.content.some((b) => b.type === "tool_result"),
            )
          ) {
            secondRoundMessages = req.messages;
          }
        },
      }),
    );

    await runOneTurn("list channels");

    const toolResultMsg = secondRoundMessages!.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "tool_result"),
    );
    const block = (
      toolResultMsg!.content as Array<{
        type: string;
        is_error?: boolean;
        content?: string;
      }>
    ).find((b) => b.type === "tool_result")!;
    expect(block.is_error).toBe(true);
    // sanitizeToolError strips PII — content should be a non-empty string but
    // we don't assert exact wording (sanitization rules live in turnBudget.ts).
    expect(typeof block.content).toBe("string");
    expect(block.content!.length).toBeGreaterThan(0);

    expect(useAgentStore.getState().status).toBe("done");
  });
});
