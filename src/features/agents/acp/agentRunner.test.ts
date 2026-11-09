import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.desktop,
  invoke: tauri.invoke,
}));
const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));

import {
  AGENT_RUN_EXIT_EVENT,
  AGENT_RUN_LINE_EVENT,
  DESKTOP_ONLY_MESSAGE,
  findAgentPrograms,
  listAgentRuns,
  onAgentRunExit,
  onAgentRunLine,
  sendAgentLine,
  startAgentRun,
  stopAgentRun,
} from "./agentRunner";

describe("agentRunner", () => {
  beforeEach(() => {
    tauri.desktop = true;
    tauri.invoke.mockReset().mockResolvedValue(null);
    events.handlers.clear();
    events.unlisten.mockReset();
    events.listen
      .mockReset()
      .mockImplementation((name: string, handler: (event: { payload: unknown }) => void) => {
        events.handlers.set(name, handler);
        return Promise.resolve(events.unlisten);
      });
  });

  it("starts a run and returns its id", async () => {
    tauri.invoke.mockResolvedValue({ runId: "ar_abc" });
    await expect(
      startAgentRun({ program: "claude-agent-acp", args: ["--x"], cwd: "/home/a/project" }),
    ).resolves.toBe("ar_abc");
    expect(tauri.invoke).toHaveBeenCalledWith("agent_runner_start", {
      program: "claude-agent-acp",
      args: ["--x"],
      cwd: "/home/a/project",
    });
  });

  it("sends a line and stops a run", async () => {
    await sendAgentLine("ar_abc", '{"jsonrpc":"2.0"}');
    expect(tauri.invoke).toHaveBeenCalledWith("agent_runner_send", {
      runId: "ar_abc",
      line: '{"jsonrpc":"2.0"}',
    });
    await stopAgentRun("ar_abc");
    expect(tauri.invoke).toHaveBeenCalledWith("agent_runner_stop", { runId: "ar_abc" });
  });

  it("finds programs and lists runs", async () => {
    tauri.invoke.mockResolvedValueOnce(["/usr/bin/gemini", null]);
    await expect(findAgentPrograms(["gemini", "nothing"])).resolves.toEqual([
      "/usr/bin/gemini",
      null,
    ]);
    expect(tauri.invoke).toHaveBeenCalledWith("agent_runner_find", {
      names: ["gemini", "nothing"],
    });
    const runs = [{ runId: "ar_abc", program: "/usr/bin/gemini", cwd: "/", startedAt: 1 }];
    tauri.invoke.mockResolvedValueOnce(runs);
    await expect(listAgentRuns()).resolves.toEqual(runs);
    expect(tauri.invoke).toHaveBeenCalledWith("agent_runner_list", undefined);
  });

  it("turns the runner's sentence into an Error", async () => {
    tauri.invoke.mockRejectedValue("That agent is not running.");
    await expect(sendAgentLine("ar_gone", "hi")).rejects.toThrow("That agent is not running.");
  });

  it("refuses everything off the desktop app", async () => {
    tauri.desktop = false;
    await expect(startAgentRun({ program: "a", args: [], cwd: "/" })).rejects.toThrow(
      DESKTOP_ONLY_MESSAGE,
    );
    await expect(sendAgentLine("ar_a", "x")).rejects.toThrow(DESKTOP_ONLY_MESSAGE);
    await expect(stopAgentRun("ar_a")).rejects.toThrow(DESKTOP_ONLY_MESSAGE);
    await expect(findAgentPrograms(["a"])).rejects.toThrow(DESKTOP_ONLY_MESSAGE);
    await expect(listAgentRuns()).rejects.toThrow(DESKTOP_ONLY_MESSAGE);
    expect(() => onAgentRunLine(() => undefined)).toThrow(DESKTOP_ONLY_MESSAGE);
    expect(() => onAgentRunExit(() => undefined)).toThrow(DESKTOP_ONLY_MESSAGE);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("hands lines and exits to their listeners until they stop listening", async () => {
    const lines = vi.fn();
    const exits = vi.fn();
    const stopLines = onAgentRunLine(lines);
    onAgentRunExit(exits);
    await Promise.resolve();

    const line = { runId: "ar_abc", line: "{}" };
    events.handlers.get(AGENT_RUN_LINE_EVENT)?.({ payload: line });
    const exit = {
      runId: "ar_abc",
      code: 0,
      signal: null,
      reason: null,
      stderrTail: ["bye"],
    };
    events.handlers.get(AGENT_RUN_EXIT_EVENT)?.({ payload: exit });
    expect(lines).toHaveBeenCalledWith(line);
    expect(exits).toHaveBeenCalledWith(exit);

    stopLines();
    expect(events.unlisten).toHaveBeenCalledTimes(1);
    events.handlers.get(AGENT_RUN_LINE_EVENT)?.({ payload: line });
    expect(lines).toHaveBeenCalledTimes(1);
  });

  it("stops a listener that is stopped before it started", async () => {
    const lines = vi.fn();
    const stop = onAgentRunLine(lines);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(events.unlisten).toHaveBeenCalledTimes(1);
    events.handlers.get(AGENT_RUN_LINE_EVENT)?.({ payload: { runId: "ar_a", line: "x" } });
    expect(lines).not.toHaveBeenCalled();
  });
});
