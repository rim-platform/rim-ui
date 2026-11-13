import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const available = vi.hoisted(() => ({ agent: true }));
vi.mock("../../../agent/agentAvailability", () => ({ agentAvailable: () => available.agent }));

import { useShellStore } from "../../../../shell/state/useShellStore";
import type { AgentSession, AgentSessionStatus } from "../../acp/agentSession";
import { useAgentProgramsStore, type AgentProgramProfile } from "../../state/useAgentProgramsStore";
import {
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
  type RecentAgentSession,
} from "../../state/useAgentSessionsStore";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { AgentSessionsButton } from "./AgentSessionsButton";

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Claude",
  program: "claude-agent-acp",
  resolvedProgram: "/usr/bin/claude-agent-acp",
  args: [],
  defaultFolder: null,
  presetId: null,
  agentId: "a1",
  token: "rimagent_button-token-0123456789abcdefghijklmnopq",
  addedAt: "2026-11-10T10:00:00.000Z",
  preferredModel: null,
};

/** A running session as the button reads it: its status and the agent's name. */
function running(name: string, status: AgentSessionStatus): AgentSession {
  return {
    status,
    getSnapshot: () => ({ name }),
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

function recent(key: string, minutesAgo: number): RecentAgentSession {
  const at = new Date(Date.UTC(2026, 10, 10, 12, 0) - minutesAgo * 60_000).toISOString();
  return {
    key,
    profileId: "p1",
    agentName: "Claude",
    cwd: "/home/a/project",
    acpSessionId: `acp-${key}`,
    title: `Session ${key}`,
    startedAt: at,
    lastActivityAt: at,
    canReopen: true,
  };
}

function setSessions(sessions: Record<string, AgentSession>, unseen: Record<string, true> = {}) {
  act(() => useRunningAgentSessionsStore.setState({ sessions, unseen }));
}

describe("Agent sessions button", () => {
  beforeEach(() => {
    available.agent = true;
    useAgentProgramsStore.setState({ profiles: [PROFILE] });
    useShellStore.getState().reset();
  });

  afterEach(() => {
    useRunningAgentSessionsStore.setState({ sessions: {}, unseen: {} });
    useAgentSessionsStore.setState({ recent: [] });
    useAgentProgramsStore.setState({ profiles: [] });
    useStartAgentSessionStore.getState().close();
  });

  it("is hidden on the web and while no agent program is added", () => {
    available.agent = false;
    const { rerender } = render(<AgentSessionsButton />);
    expect(screen.queryByRole("button", { name: /Agent sessions/u })).toBeNull();
    available.agent = true;
    act(() => useAgentProgramsStore.setState({ profiles: [] }));
    rerender(<AgentSessionsButton />);
    expect(screen.queryByRole("button", { name: /Agent sessions/u })).toBeNull();
    act(() => useAgentProgramsStore.setState({ profiles: [PROFILE] }));
    expect(screen.getByRole("button", { name: "Agent sessions" })).toBeInTheDocument();
  });

  it("counts the sessions waiting for the person, else marks one working with a dot", () => {
    render(<AgentSessionsButton />);
    expect(screen.queryByTestId("agent-sessions-count")).toBeNull();
    expect(screen.queryByTestId("agent-sessions-working")).toBeNull();

    setSessions({ a: running("Claude", "working") });
    expect(screen.getByRole("button", { name: "Agent sessions, 1 working" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-sessions-working")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-sessions-count")).toBeNull();

    setSessions({
      a: running("Claude", "working"),
      b: running("Goose", "waiting"),
      c: running("Codex", "waiting"),
    });
    expect(screen.getByRole("button", { name: "Agent sessions, 2 need you" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-sessions-count")).toHaveTextContent("2");
    expect(screen.queryByTestId("agent-sessions-working")).toBeNull();
  });

  it("opens the sessions, running first, and a row opens its session and closes the menu", async () => {
    act(() => useAgentSessionsStore.setState({ recent: [recent("b", 1), recent("a", 5)] }));
    setSessions({ a: running("Goose", "waiting") }, { b: true });
    const user = userEvent.setup();
    render(<AgentSessionsButton />);
    const button = screen.getByRole("button", { name: "Agent sessions, 1 needs you" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("region", { name: "Agent sessions" });
    expect(
      within(within(menu).getByRole("list"))
        .getAllByRole("button")
        .map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Open Goose: Session a", "Open Claude: Session b, new"]);
    expect(within(menu).getByText("Needs you")).toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "Open Claude: Session b, new" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-session", key: "b" });
    expect(screen.queryByRole("region", { name: "Agent sessions" })).toBeNull();
  });

  it("offers New session and All sessions, and closes on Escape", async () => {
    act(() => useAgentSessionsStore.setState({ recent: [recent("a", 5)] }));
    const user = userEvent.setup();
    render(<AgentSessionsButton />);
    await user.click(screen.getByRole("button", { name: "Agent sessions" }));
    await user.click(screen.getByRole("button", { name: "New session" }));
    expect(useStartAgentSessionStore.getState().open).toBe(true);
    expect(screen.queryByRole("region", { name: "Agent sessions" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Agent sessions" }));
    await user.click(screen.getByRole("button", { name: "All sessions" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-sessions" });

    await user.click(screen.getByRole("button", { name: "Agent sessions" }));
    expect(screen.getByRole("region", { name: "Agent sessions" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Agent sessions" })).toBeNull();
  });

  it("says when there are no sessions yet", async () => {
    const user = userEvent.setup();
    render(<AgentSessionsButton />);
    await user.click(screen.getByRole("button", { name: "Agent sessions" }));
    const menu = screen.getByRole("region", { name: "Agent sessions" });
    expect(within(menu).getByText("No agent sessions yet.")).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "New session" })).toBeInTheDocument();
  });
});
