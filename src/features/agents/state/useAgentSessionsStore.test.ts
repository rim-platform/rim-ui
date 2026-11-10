import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({
  allowedAgentPrograms: vi.fn(() => Promise.resolve([] as { program: string; args: string[] }[])),
  findAgentPrograms: vi.fn((names: string[]) =>
    Promise.resolve(names.map(() => null as string | null)),
  ),
}));
vi.mock("../acp/agentRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../acp/agentRunner")>()),
  ...(await import("../../../test/fakeAcpAgent")).fakeAcpAgent.module(),
  ...lookup,
}));
const notifications = vi.hoisted(() => ({ show: vi.fn(() => Promise.resolve()) }));
vi.mock("../../notifications/runtime/desktopNotification", () => ({
  showDesktopNotification: notifications.show,
}));
const focus = vi.hoisted(() => ({ current: false }));
vi.mock("../../../shared/utils/windowFocus", () => ({ windowHasFocus: () => focus.current }));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => "desktop",
}));

import { queryClient } from "../../../core/query/queryClient";
import { useToastStore } from "../../../shared/toast/useToastStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { queryKeys } from "../../../core/query/keys";
import { fakeAcpAgent as agent, helloAnswer } from "../../../test/fakeAcpAgent";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { ADD_AGAIN } from "../acp/agentSession";
import { inQuietHours } from "../runtime/agentSessionNotifications";
import { useAgentProgramsStore, type AgentProgramProfile } from "./useAgentProgramsStore";
import {
  agentSessionOf,
  chooseAgentSessionModel,
  chooseAgentSessionOption,
  markAgentSessionSeen,
  migrateRecentSessions,
  reopenAgentSession,
  RECENT_SESSIONS_LIMIT,
  removeRecentAgentSession,
  setAgentSessionDepsForTests,
  startAgentSession,
  stopAllAgentSessions,
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
  type RecentAgentSession,
} from "./useAgentSessionsStore";

const TOKEN = "rimagent_sessions-store-token-0123456789abcdefghijk";

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Fake Agent",
  program: "fake-agent",
  resolvedProgram: "/usr/bin/fake-agent",
  args: [],
  defaultFolder: "/home/a/project",
  presetId: null,
  agentId: "a1",
  token: TOKEN,
  addedAt: "2026-11-10T10:00:00.000Z",
};

const SECRET = "the transcript text that must never be stored";

function entry(key: string, at: string, extra: Partial<RecentAgentSession> = {}) {
  return {
    key,
    profileId: "p1",
    agentName: "Fake Agent",
    cwd: "/p",
    acpSessionId: `acp-${key}`,
    title: null,
    startedAt: at,
    lastActivityAt: at,
    canReopen: true,
    ...extra,
  };
}

/** The agent answers a prompt with `text` and ends the turn. */
function answersWith(text: string) {
  agent.on("session/prompt", (_params, id) => {
    queueMicrotask(() => {
      agent.update("sess_1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      });
      agent.respond(id, { stopReason: "end_turn" });
    });
    return undefined;
  });
}

async function started(): Promise<string> {
  const key = startAgentSession(PROFILE, "/home/a/project");
  await vi.waitFor(() => expect(agentSessionOf(key)?.status).toBe("ready"));
  return key;
}

describe("agent sessions store", () => {
  beforeEach(() => {
    agent.reset();
    agent
      .on("initialize", () => helloAnswer())
      .on("session/new", () => ({ sessionId: "sess_1" }))
      .on("session/cancel", () => undefined);
    setAgentSessionDepsForTests({
      bridgeStatus: () =>
        Promise.resolve({ enabled: true, listening: true, error: null, port: 47821 }),
    });
    useAgentProgramsStore.setState({ profiles: [PROFILE] });
    focus.current = false;
  });

  afterEach(async () => {
    await stopAllAgentSessions();
    useAgentSessionsStore.setState({ recent: [] });
    useAgentProgramsStore.setState({ profiles: [] });
    useWorkspaceStore.setState({ workspaceId: null });
    useNotificationSettingsStore.setState({ enabled: true });
    useToastStore.setState({ toasts: [] });
    useShellStore.getState().reset();
    queryClient.clear();
    notifications.show.mockClear();
    setAgentSessionDepsForTests({});
  });

  it("lists a session once the agent opens it, titled by the first prompt", async () => {
    answersWith(SECRET);
    const key = await started();
    const [listed] = useAgentSessionsStore.getState().recent;
    expect(listed).toMatchObject({
      key,
      profileId: "p1",
      agentName: "Fake Agent",
      cwd: "/home/a/project",
      acpSessionId: "sess_1",
      title: null,
      canReopen: true,
    });
    const long = `Check what is in #incidents ${"and then some more ".repeat(10)}`;
    await agentSessionOf(key)!.prompt(long);
    const title = useAgentSessionsStore.getState().recent[0].title!;
    expect(title).toHaveLength(80);
    expect(title.startsWith("Check what is in #incidents and then")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    agent.update("sess_1", { sessionUpdate: "session_info_update", title: "Incident summary" });
    expect(useAgentSessionsStore.getState().recent[0].title).toBe("Incident summary");
  });

  it("finds a stored profile's allowed path before starting it", async () => {
    useAgentProgramsStore.setState({ profiles: [{ ...PROFILE, resolvedProgram: null }] });
    lookup.allowedAgentPrograms.mockResolvedValueOnce([{ program: "/opt/fake-agent", args: [] }]);
    lookup.findAgentPrograms.mockResolvedValueOnce(["/opt/fake-agent"]);
    const key = startAgentSession(useAgentProgramsStore.getState().profiles[0], "/home/a/project");
    await vi.waitFor(() => expect(agentSessionOf(key)?.status).toBe("ready"));
    expect(agent.startAgentRun).toHaveBeenCalledWith({
      program: "/opt/fake-agent",
      args: [],
      cwd: "/home/a/project",
    });
    expect(useAgentProgramsStore.getState().profiles[0].resolvedProgram).toBe("/opt/fake-agent");
  });

  it("fails with a sentence when the allowed path can't be found", async () => {
    const stale = { ...PROFILE, resolvedProgram: null };
    useAgentProgramsStore.setState({ profiles: [stale] });
    const key = startAgentSession(stale, "/home/a/project");
    await vi.waitFor(() => expect(agentSessionOf(key)?.status).toBe("failed"));
    expect(agentSessionOf(key)?.getSnapshot().error).toBe(ADD_AGAIN);
    expect(agent.startAgentRun).not.toHaveBeenCalled();
  });

  it("stores the session's metadata and none of its transcript", async () => {
    answersWith(SECRET);
    const key = await started();
    await agentSessionOf(key)!.prompt("Summarise it");
    expect(JSON.stringify(agentSessionOf(key)!.transcript)).toContain(SECRET);
    const { partialize } = useAgentSessionsStore.persist.getOptions();
    const stored = JSON.stringify(partialize!(useAgentSessionsStore.getState()));
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain(TOKEN);
    const [kept] = JSON.parse(stored).recent as Record<string, unknown>[];
    expect(Object.keys(kept).sort()).toEqual(
      [
        "acpSessionId",
        "agentName",
        "canReopen",
        "cwd",
        "key",
        "lastActivityAt",
        "profileId",
        "startedAt",
        "title",
      ].sort(),
    );
  });

  it("keeps the newest sessions within the limit", () => {
    const store = useAgentSessionsStore.getState();
    for (let i = 0; i < RECENT_SESSIONS_LIMIT + 3; i++) {
      store.upsert(entry(`k${i}`, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()));
    }
    const keys = useAgentSessionsStore.getState().recent.map((item) => item.key);
    expect(keys).toHaveLength(RECENT_SESSIONS_LIMIT);
    expect(keys[0]).toBe(`k${RECENT_SESSIONS_LIMIT + 2}`);
    expect(keys).not.toContain("k0");
    removeRecentAgentSession(keys[0]);
    expect(useAgentSessionsStore.getState().recent).toHaveLength(RECENT_SESSIONS_LIMIT - 1);
  });

  it("leaves out stored entries that lack what one needs", () => {
    const { recent } = migrateRecentSessions({
      recent: [entry("ok", "2026-11-01T00:00:00.000Z"), { key: "bad" }, null, 7],
    });
    expect(recent.map((item) => item.key)).toEqual(["ok"]);
    expect(migrateRecentSessions(null)).toEqual({ recent: [] });
  });

  it("reopens a recent session with session/load", async () => {
    useAgentSessionsStore.getState().upsert(entry("old", "2026-11-01T00:00:00.000Z"));
    agent.on("session/load", () => ({}));
    expect(reopenAgentSession("old")).toBeNull();
    await vi.waitFor(() => expect(agentSessionOf("old")?.status).toBe("ready"));
    expect(agent.requests("session/load")[0].params).toMatchObject({
      sessionId: "acp-old",
      cwd: "/p",
    });
    expect(agent.requests("session/new")).toHaveLength(0);
    expect(reopenAgentSession("old")).toBe("running");
  });

  it("refuses to reopen what can't be", () => {
    const store = useAgentSessionsStore.getState();
    store.upsert(entry("no-load", "2026-11-01T00:00:00.000Z", { canReopen: false }));
    store.upsert(entry("no-profile", "2026-11-01T00:00:00.000Z", { profileId: "gone" }));
    expect(reopenAgentSession("no-load")).toBe("cannot_reopen");
    expect(reopenAgentSession("no-profile")).toBe("profile_gone");
    expect(reopenAgentSession("missing")).toBe("unknown");
    expect(agent.startAgentRun).not.toHaveBeenCalled();
  });

  it("shows nothing as running once the runner ends the program, as at app exit", async () => {
    const key = await started();
    agent.exit({ code: null, signal: 15, reason: "stopped" });
    expect(agentSessionOf(key)?.status).toBe("ended");
  });

  it("stops every session when the account's vault locks", async () => {
    const key = await started();
    const session = agentSessionOf(key)!;
    await stopAllAgentSessions();
    expect(session.status).toBe("ended");
    expect(useRunningAgentSessionsStore.getState().sessions).toEqual({});
  });

  describe("the agent's settings", () => {
    const MODEL_OPTION = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "sonnet",
      options: [
        { value: "sonnet", name: "Sonnet" },
        { value: "opus", name: "Opus" },
      ],
    };
    const EFFORT_OPTION = {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    };

    it("remembers a chosen model for the agent program, and nothing else it sets", async () => {
      agent
        .on("session/new", () => ({
          sessionId: "sess_1",
          configOptions: [MODEL_OPTION, EFFORT_OPTION],
        }))
        .on("session/set_config_option", (params) => {
          const { configId, value } = params as { configId: string; value: string };
          return {
            configOptions: [MODEL_OPTION, EFFORT_OPTION].map((option) =>
              option.id === configId ? { ...option, currentValue: value } : option,
            ),
          };
        });
      const key = await started();
      await expect(chooseAgentSessionOption(key, "effort", "low")).resolves.toBe(true);
      expect(useAgentProgramsStore.getState().profiles[0].preferredModel ?? null).toBeNull();
      await expect(chooseAgentSessionOption(key, "model", "opus")).resolves.toBe(true);
      expect(useAgentProgramsStore.getState().profiles[0].preferredModel).toEqual({
        configId: "model",
        value: "opus",
      });
    });

    it("remembers nothing when the agent refuses the model", async () => {
      agent
        .on("session/new", () => ({ sessionId: "sess_1", configOptions: [MODEL_OPTION] }))
        .on("session/set_config_option", (_params, id) => {
          queueMicrotask(() => agent.fail(id, -32603, "No"));
          return undefined;
        });
      const key = await started();
      await expect(chooseAgentSessionOption(key, "model", "opus")).resolves.toBe(false);
      expect(useAgentProgramsStore.getState().profiles[0].preferredModel ?? null).toBeNull();
    });

    it("remembers a model of the older model list", async () => {
      agent
        .on("session/new", () => ({
          sessionId: "sess_1",
          models: {
            currentModelId: "m1",
            availableModels: [
              { modelId: "m1", name: "One" },
              { modelId: "m2", name: "Two" },
            ],
          },
        }))
        .on("session/set_model", () => ({}));
      const key = await started();
      await expect(chooseAgentSessionModel(key, "m2")).resolves.toBe(true);
      expect(useAgentProgramsStore.getState().profiles[0].preferredModel).toEqual({
        configId: null,
        value: "m2",
      });
    });
  });

  describe("notifications", () => {
    it("says when a turn ends while the window isn't focused, with the title only", async () => {
      answersWith(SECRET);
      const key = await started();
      await agentSessionOf(key)!.prompt("Summarise the incident");
      expect(notifications.show).toHaveBeenCalledTimes(1);
      const [shown] = notifications.show.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(shown).toMatchObject({
        title: "Fake Agent finished",
        body: "Summarise the incident",
        extra: { rimAgentSession: { key } },
      });
      expect(JSON.stringify(shown)).not.toContain(SECRET);
      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it("says when the agent starts waiting for the person", async () => {
      agent.on("session/prompt", () => {
        queueMicrotask(() =>
          agent.ask(9, "session/request_permission", {
            sessionId: "sess_1",
            toolCall: { toolCallId: "c1", title: `Run ${SECRET}` },
            options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
          }),
        );
        return undefined;
      });
      const key = await started();
      void agentSessionOf(key)!.prompt("Fix it");
      await vi.waitFor(() => expect(agentSessionOf(key)?.status).toBe("waiting"));
      expect(notifications.show).toHaveBeenCalledTimes(1);
      const [shown] = notifications.show.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(shown).toMatchObject({ title: "Fake Agent is waiting for you", body: "Fix it" });
      expect(JSON.stringify(shown)).not.toContain(SECRET);
    });

    it("shows a toast instead while the window is focused, and Open opens the session", async () => {
      focus.current = true;
      answersWith(SECRET);
      const key = await started();
      await agentSessionOf(key)!.prompt("Summarise the incident");
      expect(notifications.show).not.toHaveBeenCalled();
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({
        variant: "info",
        title: "Fake Agent finished",
        description: "Summarise the incident",
        action: { label: "Open" },
      });
      expect(JSON.stringify(toasts)).not.toContain(SECRET);
      toasts[0].action!.onClick();
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-session", key });
    });

    it("says waiting in a toast, replacing the session's toast before it", async () => {
      focus.current = true;
      answersWith("done");
      const key = await started();
      await agentSessionOf(key)!.prompt("First");
      agent.on("session/prompt", () => {
        queueMicrotask(() =>
          agent.ask(9, "session/request_permission", {
            sessionId: "sess_1",
            toolCall: { toolCallId: "c1", title: "Run it" },
            options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
          }),
        );
        return undefined;
      });
      void agentSessionOf(key)!.prompt("Second");
      await vi.waitFor(() => expect(agentSessionOf(key)?.status).toBe("waiting"));
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({
        variant: "warning",
        title: "Fake Agent is waiting for you",
      });
      expect(notifications.show).not.toHaveBeenCalled();
    });

    it("says nothing while the person is on the session's page", async () => {
      focus.current = true;
      answersWith("done");
      const key = await started();
      useShellStore.getState().setMainSurface({ kind: "agent-session", key });
      await agentSessionOf(key)!.prompt("Go");
      expect(useToastStore.getState().toasts).toEqual([]);
      expect(notifications.show).not.toHaveBeenCalled();
      expect(useRunningAgentSessionsStore.getState().unseen).toEqual({});
    });

    it("shows no toast with notifications off", async () => {
      focus.current = true;
      answersWith("done");
      const key = await started();
      useNotificationSettingsStore.setState({ enabled: false });
      await agentSessionOf(key)!.prompt("Go");
      expect(useToastStore.getState().toasts).toEqual([]);
    });

    it("marks a session unseen until its page is shown, which also takes its toast away", async () => {
      focus.current = true;
      answersWith("done");
      const key = await started();
      expect(useRunningAgentSessionsStore.getState().unseen).toEqual({});
      await agentSessionOf(key)!.prompt("Go");
      expect(useRunningAgentSessionsStore.getState().unseen).toEqual({ [key]: true });
      markAgentSessionSeen(key);
      expect(useRunningAgentSessionsStore.getState().unseen).toEqual({});
      expect(useToastStore.getState().toasts[0]?.dismissing).toBe(true);
    });

    it("says nothing with notifications off or the workspace paused", async () => {
      answersWith("done");
      const key = await started();
      useNotificationSettingsStore.setState({ enabled: false });
      await agentSessionOf(key)!.prompt("One");
      useNotificationSettingsStore.setState({ enabled: true });
      useWorkspaceStore.setState({ workspaceId: "ws-1" });
      queryClient.setQueryData(queryKeys.notificationSettings("ws-1"), {
        serverId: "ws-1",
        dnd: null,
        dndPaused: true,
        dndPausedUntil: null,
      });
      await agentSessionOf(key)!.prompt("Two");
      expect(notifications.show).not.toHaveBeenCalled();
    });

    it("knows quiet hours, across midnight too", () => {
      const at = (iso: string) => new Date(iso);
      const night = { start: "22:00", end: "07:00", timezone: "UTC" };
      expect(inQuietHours(night, at("2026-11-10T23:30:00Z"))).toBe(true);
      expect(inQuietHours(night, at("2026-11-10T06:59:00Z"))).toBe(true);
      expect(inQuietHours(night, at("2026-11-10T12:00:00Z"))).toBe(false);
      const day = { start: "09:00:00", end: "17:00:00", timezone: "UTC" };
      expect(inQuietHours(day, at("2026-11-10T10:00:00Z"))).toBe(true);
      expect(inQuietHours(day, at("2026-11-10T18:00:00Z"))).toBe(false);
      expect(inQuietHours(null)).toBe(false);
    });
  });
});
