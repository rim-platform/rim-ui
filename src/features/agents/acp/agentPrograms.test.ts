import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  calls: [] as string[],
  allowAgentProgram: vi.fn(),
  forgetAgentProgram: vi.fn(),
}));
vi.mock("./agentRunner", () => ({
  allowAgentProgram: runner.allowAgentProgram,
  forgetAgentProgram: runner.forgetAgentProgram,
}));

import { logger } from "../../../core/logger";
import { sha256Base64Url } from "../runtime/agentCrypto";
import {
  migrateAgentPrograms,
  useAgentProgramsStore,
  type AgentProgramProfile,
} from "../state/useAgentProgramsStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import {
  FOLDER_NOT_FULL,
  NAME_NEEDED,
  addAgentProgram,
  disconnectAgent,
  editAgentProgram,
  removeAgentProgram,
} from "./agentPrograms";

const CLAUDE = {
  name: "Claude Code",
  program: "claude-agent-acp",
  args: [],
  defaultFolder: "/home/a/project",
  presetId: "claude-code",
};

describe("agent programs", () => {
  const logged: unknown[][] = [];

  beforeEach(() => {
    useAgentProgramsStore.setState({ profiles: [] });
    useConnectedAgentsStore.setState({ agents: [] });
    runner.calls = [];
    runner.allowAgentProgram.mockReset().mockImplementation((program: string, args: string[]) => {
      runner.calls.push(`allow ${[program, ...args].join(" ")}`);
      return Promise.resolve(true);
    });
    runner.forgetAgentProgram.mockReset().mockImplementation((program: string, args: string[]) => {
      runner.calls.push(`forget ${[program, ...args].join(" ")}`);
      return Promise.resolve();
    });
    logged.length = 0;
    for (const level of ["debug", "warn", "error"] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
  });

  afterEach(() => {
    for (const profile of useAgentProgramsStore.getState().profiles) {
      expect(JSON.stringify(logged)).not.toContain(profile.token);
    }
    vi.restoreAllMocks();
  });

  it("adds an allowed program with a connected agent of its own and nothing granted", async () => {
    const profile = await addAgentProgram(CLAUDE);
    expect(runner.calls).toEqual(["allow claude-agent-acp"]);
    expect(profile).not.toBeNull();
    const [stored] = useAgentProgramsStore.getState().profiles;
    expect(stored).toEqual(profile);
    expect(stored).toMatchObject({
      name: "Claude Code",
      program: "claude-agent-acp",
      args: [],
      defaultFolder: "/home/a/project",
      presetId: "claude-code",
    });
    expect(stored.token).toMatch(/^rimagent_[A-Za-z0-9_-]{43}$/u);
    const [agent] = useConnectedAgentsStore.getState().agents;
    expect(agent).toMatchObject({
      id: stored.agentId,
      name: "Claude Code",
      grants: {},
      pluginApprovals: {},
      commandApprovals: [],
    });
    expect(agent.tokenHash).toBe(await sha256Base64Url(stored.token));
    expect(JSON.stringify(agent)).not.toContain(stored.token);
  });

  it("adds nothing when the person does not allow the program", async () => {
    runner.allowAgentProgram.mockResolvedValue(false);
    await expect(addAgentProgram(CLAUDE)).resolves.toBeNull();
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
  });

  it("adds nothing when the runner refuses the program", async () => {
    runner.allowAgentProgram.mockRejectedValue(new Error("claude-agent-acp was not found."));
    await expect(addAgentProgram(CLAUDE)).rejects.toThrow("claude-agent-acp was not found.");
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
  });

  it("checks the name and folder before asking", async () => {
    await expect(addAgentProgram({ ...CLAUDE, name: " ​ " })).rejects.toThrow(NAME_NEEDED);
    await expect(addAgentProgram({ ...CLAUDE, defaultFolder: "project" })).rejects.toThrow(
      FOLDER_NOT_FULL,
    );
    expect(runner.allowAgentProgram).not.toHaveBeenCalled();
  });

  it("allows a new command line before forgetting the old one", async () => {
    const profile = (await addAgentProgram(CLAUDE)) as AgentProgramProfile;
    runner.calls = [];
    await expect(
      editAgentProgram(profile.id, { program: "/opt/claude-agent-acp", args: ["--verbose"] }),
    ).resolves.toBe("changed");
    expect(runner.calls).toEqual([
      "allow /opt/claude-agent-acp --verbose",
      "forget claude-agent-acp",
    ]);
    expect(useAgentProgramsStore.getState().profiles[0]).toMatchObject({
      program: "/opt/claude-agent-acp",
      args: ["--verbose"],
      token: profile.token,
      agentId: profile.agentId,
    });
  });

  it("keeps the old command line when the new one is not allowed", async () => {
    const profile = (await addAgentProgram(CLAUDE)) as AgentProgramProfile;
    runner.calls = [];
    runner.allowAgentProgram.mockResolvedValue(false);
    await expect(editAgentProgram(profile.id, { args: ["--x"] })).resolves.toBe("refused");
    expect(runner.forgetAgentProgram).not.toHaveBeenCalled();
    expect(useAgentProgramsStore.getState().profiles[0].args).toEqual([]);
  });

  it("changes the name and folder without asking", async () => {
    const profile = (await addAgentProgram(CLAUDE)) as AgentProgramProfile;
    runner.calls = [];
    await editAgentProgram(profile.id, {
      name: "Claude at work",
      program: "claude-agent-acp",
      args: [],
      defaultFolder: "",
    });
    expect(runner.calls).toEqual([]);
    expect(useAgentProgramsStore.getState().profiles[0]).toMatchObject({
      name: "Claude at work",
      defaultFolder: null,
    });
  });

  it("removes a profile, disconnects its agent and forgets its command line", async () => {
    const profile = (await addAgentProgram(CLAUDE)) as AgentProgramProfile;
    await expect(removeAgentProgram(profile.id)).resolves.toBe(true);
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    expect(runner.calls).toEqual(["allow claude-agent-acp", "forget claude-agent-acp"]);
  });

  it("keeps a command line another profile still starts", async () => {
    const first = (await addAgentProgram(CLAUDE)) as AgentProgramProfile;
    await addAgentProgram({ ...CLAUDE, name: "Claude two", defaultFolder: null });
    await removeAgentProgram(first.id);
    expect(runner.forgetAgentProgram).not.toHaveBeenCalled();
    expect(useAgentProgramsStore.getState().profiles.map((p) => p.name)).toEqual(["Claude two"]);
  });

  it("disconnects at once even when forgetting fails", async () => {
    const profile = (await addAgentProgram(CLAUDE)) as AgentProgramProfile;
    runner.forgetAgentProgram.mockRejectedValue(new Error("not found"));
    const done = disconnectAgent(profile.agentId);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    await expect(done).resolves.toBe(false);
  });

  it("disconnects an agent that has no profile", async () => {
    useConnectedAgentsStore.getState().add({
      id: "paired",
      name: "Paired",
      tokenHash: "h",
      pairedAt: "2026-11-10T10:00:00.000Z",
      grants: {},
      pluginApprovals: {},
      commandApprovals: [],
    });
    await expect(disconnectAgent("paired")).resolves.toBe(true);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    expect(runner.forgetAgentProgram).not.toHaveBeenCalled();
  });
});

describe("migrateAgentPrograms", () => {
  it("keeps well-formed profiles and leaves out the rest", () => {
    const good = {
      id: "p1",
      name: "Goose",
      program: "goose",
      args: ["acp", 3],
      defaultFolder: "",
      presetId: "goose",
      agentId: "a1",
      token: "rimagent_x",
      addedAt: "2026-11-10T10:00:00.000Z",
    };
    expect(migrateAgentPrograms({ profiles: [good, { id: "p2" }, null, "x"] })).toEqual({
      profiles: [{ ...good, args: ["acp"], defaultFolder: null }],
    });
    expect(migrateAgentPrograms(undefined)).toEqual({ profiles: [] });
    expect(migrateAgentPrograms({ profiles: "x" })).toEqual({ profiles: [] });
  });
});
