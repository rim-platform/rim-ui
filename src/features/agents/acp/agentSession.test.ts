import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agentRunner", async () =>
  (await import("../../../test/fakeAcpAgent")).fakeAcpAgent.module(),
);

import { logger } from "../../../core/logger";
import { fakeAcpAgent as agent, helloAnswer } from "../../../test/fakeAcpAgent";
import type { AgentBridgeStatus } from "../api/agentBridge";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";
import {
  ADD_AGAIN,
  AgentSession,
  cannotReopenSentence,
  type AgentSessionStatus,
} from "./agentSession";

const TOKEN = "rimagent_session-test-token-0123456789abcdefghijklmnop";

const PROFILE: AgentProgramProfile = {
  id: "profile-1",
  name: "Fake Agent",
  program: "fake-agent",
  resolvedProgram: "/usr/local/bin/fake-agent",
  args: ["acp"],
  defaultFolder: "/home/a/project",
  presetId: null,
  agentId: "agent-1",
  token: TOKEN,
  addedAt: "2026-11-10T10:00:00.000Z",
};

const BRIDGE_ON: AgentBridgeStatus = { enabled: true, listening: true, error: null, port: 47821 };

function session(bridge: AgentBridgeStatus | Error = BRIDGE_ON) {
  return new AgentSession({
    bridgeStatus: () =>
      bridge instanceof Error ? Promise.reject(bridge) : Promise.resolve(bridge),
  });
}

function scriptAgent(http = true) {
  agent
    .on("initialize", () => helloAnswer(http))
    .on("session/new", () => ({
      sessionId: "sess_1",
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "code", name: "Code" },
        ],
      },
    }))
    .on("session/set_mode", () => ({}));
}

/** Records each status the session passes through. */
function statuses(subject: AgentSession): AgentSessionStatus[] {
  const seen: AgentSessionStatus[] = [subject.status];
  subject.subscribe(() => {
    if (seen[seen.length - 1] !== subject.status) seen.push(subject.status);
  });
  return seen;
}

describe("AgentSession", () => {
  const logged: unknown[][] = [];

  beforeEach(() => {
    agent.reset();
    logged.length = 0;
    for (const level of ["debug", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args));
  });

  afterEach(() => {
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    vi.restoreAllMocks();
  });

  it("starts the program in the folder and opens a session with RIM's tools", async () => {
    scriptAgent();
    const subject = session();
    const seen = statuses(subject);
    await subject.start({ profile: PROFILE, cwd: "/home/a/project" });
    expect(agent.startAgentRun).toHaveBeenCalledWith({
      program: "/usr/local/bin/fake-agent",
      args: ["acp"],
      cwd: "/home/a/project",
    });
    expect(agent.requests("session/new")[0].params).toEqual({
      cwd: "/home/a/project",
      mcpServers: [
        {
          type: "http",
          name: "rim",
          url: "http://127.0.0.1:47821/mcp",
          headers: [{ name: "Authorization", value: `Bearer ${TOKEN}` }],
        },
      ],
    });
    expect(subject.rimTools).toBe("available");
    expect(subject.modes.map((mode) => mode.id)).toEqual(["ask", "code"]);
    expect(subject.currentModeId).toBe("ask");
    expect(seen).toEqual(["starting", "ready"]);
    expect(JSON.stringify(subject.getSnapshot())).not.toContain(TOKEN);
  });

  it("opens the session without RIM's tools while agents may not connect", async () => {
    scriptAgent();
    const subject = session({ ...BRIDGE_ON, enabled: false, listening: false });
    await subject.start({ profile: PROFILE, cwd: "/p" });
    expect(agent.requests("session/new")[0].params).toEqual({ cwd: "/p", mcpServers: [] });
    expect(subject.rimTools).toBe("bridge_off");
    expect(JSON.stringify(agent.received)).not.toContain(TOKEN);
  });

  it("treats a bridge it cannot read as off", async () => {
    scriptAgent();
    const subject = session(new Error("ipc_unavailable"));
    await subject.start({ profile: PROFILE, cwd: "/p" });
    expect(subject.rimTools).toBe("bridge_off");
  });

  it("opens the session without RIM's tools when the agent can't reach them", async () => {
    scriptAgent(false);
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    expect(agent.requests("session/new")[0].params).toEqual({ cwd: "/p", mcpServers: [] });
    expect(subject.rimTools).toBe("agent_cannot");
  });

  it("fails with a sentence when the agent needs signing in", async () => {
    agent
      .on("initialize", () => helloAnswer())
      .on("session/new", (_params, id) => {
        queueMicrotask(() => agent.fail(id, -32000, "Authentication required"));
        return undefined;
      });
    const subject = session();
    await subject.start({ profile: { ...PROFILE, presetId: "codex" }, cwd: "/p" });
    expect(subject.status).toBe("failed");
    expect(subject.getSnapshot().error).toBe(
      "Fake Agent needs you to sign in first. Sign in once: run codex login in a terminal, or set CODEX_API_KEY.",
    );
    expect(agent.stopAgentRun).toHaveBeenCalled();
  });

  it("fails without starting anything when the profile's full path is not known", async () => {
    const subject = session();
    await subject.start({ profile: { ...PROFILE, resolvedProgram: null }, cwd: "/p" });
    expect(subject.status).toBe("failed");
    expect(subject.getSnapshot().error).toBe(ADD_AGAIN);
    expect(agent.startAgentRun).not.toHaveBeenCalled();
  });

  it("fails when the program does not start", async () => {
    agent.startAgentRun.mockRejectedValueOnce(new Error("fake-agent was not found."));
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    expect(subject.status).toBe("failed");
    expect(subject.getSnapshot().error).toBe("fake-agent was not found.");
  });

  it("merges a turn's chunks into messages and its updates into tool calls and one plan", async () => {
    scriptAgent();
    agent.on("session/prompt", (_params, id) => {
      queueMicrotask(() => {
        const say = (sessionUpdate: string, text: string, messageId?: string) =>
          agent.update("sess_1", { sessionUpdate, content: { type: "text", text }, messageId });
        say("agent_thought_chunk", "Look");
        say("agent_thought_chunk", "ing");
        say("agent_message_chunk", "Hel", "m1");
        say("agent_message_chunk", "lo", "m1");
        agent.update("sess_1", {
          sessionUpdate: "plan",
          entries: [{ content: "Read", priority: "high", status: "in_progress" }],
        });
        agent.update("sess_1", {
          sessionUpdate: "tool_call",
          toolCallId: "c1",
          title: "Read file",
          kind: "read",
          status: "in_progress",
        });
        agent.update("sess_1", {
          sessionUpdate: "plan",
          entries: [{ content: "Read", priority: "high", status: "completed" }],
        });
        agent.update("sess_1", {
          sessionUpdate: "tool_call_update",
          toolCallId: "c1",
          status: "completed",
        });
        say("agent_message_chunk", "Done", "m2");
        agent.update("other_session", {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "x" },
        });
        agent.respond(id, { stopReason: "end_turn" });
      });
      return undefined;
    });
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    const seen = statuses(subject);
    await expect(subject.prompt("Check the logs")).resolves.toBe("end_turn");
    expect(seen).toEqual(["ready", "working", "ready"]);
    expect(subject.transcript.map(({ id: _id, ...item }) => item)).toEqual([
      { kind: "user", text: "Check the logs" },
      { kind: "thought", messageId: null, content: [{ type: "text", text: "Looking" }] },
      { kind: "agent_message", messageId: "m1", content: [{ type: "text", text: "Hello" }] },
      {
        kind: "plan",
        entries: [{ content: "Read", priority: "high", status: "completed" }],
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "c1",
          title: "Read file",
          kind: "read",
          status: "completed",
          content: [],
          locations: [],
        },
      },
      { kind: "agent_message", messageId: "m2", content: [{ type: "text", text: "Done" }] },
    ]);
    expect(agent.requests("session/prompt")[0].params).toEqual({
      sessionId: "sess_1",
      prompt: [{ type: "text", text: "Check the logs" }],
    });
  });

  it("waits for the person on a permission request and sends their answer", async () => {
    scriptAgent();
    let promptId = -1;
    agent.on("session/prompt", (_params, id) => {
      promptId = id;
      queueMicrotask(() =>
        agent.ask(9, "session/request_permission", {
          sessionId: "sess_1",
          toolCall: {
            toolCallId: "c2",
            title: "Run npm test",
            kind: "execute",
            rawInput: { cmd: "npm test" },
          },
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        }),
      );
      return undefined;
    });
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    const seen = statuses(subject);
    const turn = subject.prompt("Run the tests");
    await vi.waitFor(() => expect(subject.status).toBe("waiting"));
    const [pending] = subject.pendingPermissions;
    expect(pending.toolCall).toMatchObject({
      toolCallId: "c2",
      title: "Run npm test",
      rawInput: { cmd: "npm test" },
    });
    expect(pending.options.map((option) => option.optionId)).toEqual(["allow", "reject"]);
    expect(() =>
      subject.answerPermission(pending.requestId, { outcome: "selected", optionId: "nope" }),
    ).toThrow("The agent did not offer that answer.");
    subject.answerPermission(pending.requestId, { outcome: "selected", optionId: "allow" });
    expect(subject.status).toBe("working");
    expect(subject.pendingPermissions).toEqual([]);
    await vi.waitFor(() =>
      expect(agent.received.find((message) => message.id === 9)?.result).toEqual({
        outcome: { outcome: "selected", optionId: "allow" },
      }),
    );
    agent.respond(promptId, { stopReason: "end_turn" });
    await turn;
    expect(seen).toEqual(["ready", "working", "waiting", "working", "ready"]);
  });

  it("cancels a turn: waiting requests answer cancelled and unfinished calls are marked", async () => {
    scriptAgent();
    let promptId = -1;
    agent.on("session/prompt", (_params, id) => {
      promptId = id;
      queueMicrotask(() => {
        agent.update("sess_1", {
          sessionUpdate: "tool_call",
          toolCallId: "c3",
          title: "Edit",
          status: "in_progress",
        });
        agent.ask(10, "session/request_permission", {
          sessionId: "sess_1",
          toolCall: { toolCallId: "c3" },
          options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
        });
      });
      return undefined;
    });
    agent.on("session/cancel", () => undefined);
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    const turn = subject.prompt("Edit it");
    await vi.waitFor(() => expect(subject.status).toBe("waiting"));
    await subject.cancel();
    expect(subject.pendingPermissions).toEqual([]);
    expect(subject.status).toBe("working");
    await vi.waitFor(() =>
      expect(agent.received.find((message) => message.id === 10)?.result).toEqual({
        outcome: { outcome: "cancelled" },
      }),
    );
    expect(agent.requests("session/cancel")).toHaveLength(1);
    agent.respond(promptId, { stopReason: "cancelled" });
    await expect(turn).resolves.toBe("cancelled");
    const items = subject.transcript;
    expect(items.find((item) => item.kind === "tool_call")).toMatchObject({
      call: { status: "cancelled" },
    });
    expect(items[items.length - 1]).toMatchObject({ kind: "notice", text: "Stopped." });
    expect(subject.status).toBe("ready");
  });

  it("takes prompts only when ready", async () => {
    scriptAgent();
    const subject = session();
    await expect(subject.prompt("too early")).rejects.toThrow(
      "The agent can't take a prompt right now.",
    );
    await subject.start({ profile: PROFILE, cwd: "/p" });
    await expect(subject.prompt("   ")).rejects.toThrow("Write something for the agent first.");
    expect(agent.requests("session/prompt")).toHaveLength(0);
  });

  it("sets a mode the agent offers and follows the agent's own changes", async () => {
    scriptAgent();
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    await subject.setMode("code");
    expect(subject.currentModeId).toBe("code");
    await expect(subject.setMode("root")).rejects.toThrow("The agent has no such mode.");
    agent.update("sess_1", { sessionUpdate: "current_mode_update", currentModeId: "ask" });
    expect(subject.currentModeId).toBe("ask");
  });

  it("ends when stopped and fails when the program dies", async () => {
    scriptAgent();
    const stopped = session();
    await stopped.start({ profile: PROFILE, cwd: "/p" });
    await stopped.stop();
    expect(stopped.status).toBe("ended");
    expect(stopped.getSnapshot().error).toBeNull();

    agent.reset();
    scriptAgent();
    const died = session();
    await died.start({ profile: PROFILE, cwd: "/p" });
    agent.exit({ code: 2, stderrTail: ["panic: out of tokens"] });
    expect(died.status).toBe("failed");
    expect(died.getSnapshot().error).toBe("The agent program ended with exit code 2.");
    expect(died.getSnapshot().stderrTail).toEqual(["panic: out of tokens"]);
  });

  it("ends, not fails, when the runner stops the program, as it does when the app quits", async () => {
    scriptAgent();
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    agent.exit({ code: null, signal: 15, reason: "stopped" });
    expect(subject.status).toBe("ended");
    expect(subject.getSnapshot().error).toBeNull();
  });

  it("takes the session's title from the agent", async () => {
    scriptAgent();
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p" });
    expect(subject.getSnapshot().title).toBeNull();
    agent.update("sess_1", { sessionUpdate: "session_info_update", title: "Fix the flaky test" });
    expect(subject.getSnapshot().title).toBe("Fix the flaky test");
    agent.update("sess_1", { sessionUpdate: "session_info_update", title: "  " });
    expect(subject.getSnapshot().title).toBe("Fix the flaky test");
  });

  it("reopens an earlier session with session/load, and the agent replays it", async () => {
    agent
      .on("initialize", () => helloAnswer())
      .on("session/load", (_params, id) => {
        queueMicrotask(() => {
          agent.update("sess_old", {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Check the logs" },
          });
          agent.update("sess_old", {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "They look fine." },
          });
          agent.respond(id, {
            modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
          });
        });
        return undefined;
      });
    const subject = session();
    const seen = statuses(subject);
    await subject.start({ profile: PROFILE, cwd: "/home/a/project", reopen: "sess_old" });
    expect(seen).toEqual(["starting", "ready"]);
    expect(agent.requests("session/new")).toHaveLength(0);
    expect(agent.requests("session/load")[0].params).toEqual({
      sessionId: "sess_old",
      cwd: "/home/a/project",
      mcpServers: [
        {
          type: "http",
          name: "rim",
          url: "http://127.0.0.1:47821/mcp",
          headers: [{ name: "Authorization", value: `Bearer ${TOKEN}` }],
        },
      ],
    });
    expect(subject.getSnapshot().sessionId).toBe("sess_old");
    expect(subject.currentModeId).toBe("ask");
    expect(subject.transcript.map(({ id: _id, ...item }) => item)).toEqual([
      { kind: "user", text: "Check the logs" },
      {
        kind: "agent_message",
        messageId: null,
        content: [{ type: "text", text: "They look fine." }],
      },
    ]);
  });

  it("fails to reopen with a sentence when the agent can't load sessions", async () => {
    agent.on("initialize", () => helloAnswer(true, { loadSession: false }));
    const subject = session();
    await subject.start({ profile: PROFILE, cwd: "/p", reopen: "sess_old" });
    expect(subject.status).toBe("failed");
    expect(subject.getSnapshot().error).toBe(cannotReopenSentence("Fake Agent"));
    expect(cannotReopenSentence("Fake Agent")).toBe(
      "Fake Agent can't reopen past sessions. Start a new one.",
    );
    expect(agent.requests("session/load")).toHaveLength(0);
    expect(agent.stopAgentRun).toHaveBeenCalled();
  });
});
