import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const available = vi.hoisted(() => ({ agent: true }));
vi.mock("../../agent/agentAvailability", () => ({ agentAvailable: () => available.agent }));

import { useShellStore } from "../../../shell/state/useShellStore";
import type { AgentSession, AgentSessionStatus } from "../../agents/acp/agentSession";
import { AgentSessionList } from "../../agents/components/sessions/AgentSessionList";
import { useAgentSessionRows } from "../../agents/components/sessions/useAgentSessionRows";
import {
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
  type RecentAgentSession,
} from "../../agents/state/useAgentSessionsStore";
import { useStartAgentSessionStore } from "../../agents/state/useStartAgentSessionStore";
import { defaultLayout } from "../layout/homeLayout";
import { boxKind, type HomeBoxData } from "./registry";

/** A running session as the box reads it: its status and the agent's name. */
function running(name: string, status: AgentSessionStatus): AgentSession {
  return {
    status,
    getSnapshot: () => ({ name }),
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

function recent(key: string, minutesAgo: number, fields: Partial<RecentAgentSession> = {}) {
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
    ...fields,
  };
}

/** The box as Home shows it, with its count. */
function Box() {
  const agentSessions = useAgentSessionRows();
  const kind = boxKind("agentSessions")!;
  const count = kind.count({ agentSessions } as HomeBoxData);
  return (
    <section aria-label="Agent sessions">
      <span data-testid="count">{count ?? "none"}</span>
      {kind.render({ agentSessions } as HomeBoxData, {
        id: "agentSessions",
        kind: "agentSessions",
        width: "half",
      })}
    </section>
  );
}

function rowNames(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

describe("Agent sessions box", () => {
  beforeEach(() => {
    available.agent = true;
    useShellStore.getState().reset();
  });

  afterEach(() => {
    useRunningAgentSessionsStore.setState({ sessions: {}, unseen: {} });
    useAgentSessionsStore.setState({ recent: [] });
    useStartAgentSessionStore.getState().close();
  });

  it("lists the running sessions first, then the recent ones, at most six", () => {
    useAgentSessionsStore.setState({
      recent: [
        recent("w", 1),
        recent("r", 2),
        ...["a", "b", "c", "d", "e"].map((key, index) => recent(key, 10 + index)),
      ],
    });
    useRunningAgentSessionsStore.setState({
      sessions: {
        r: running("Claude", "ready"),
        w: running("Goose", "waiting"),
        ended: running("Claude", "ended"),
      },
      unseen: { r: true },
    });
    render(<Box />);
    expect(rowNames()).toEqual([
      "Open Goose: Session w",
      "Open Claude: Session r, new",
      "Open Claude: Session a",
      "Open Claude: Session b",
      "Open Claude: Session c",
      "Open Claude: Session d",
    ]);
    const list = screen.getByRole("list");
    expect(within(list).getByText("Waiting for you")).toBeInTheDocument();
    expect(within(list).getByText("Ready")).toBeInTheDocument();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("opens a session's page from its row", async () => {
    useAgentSessionsStore.setState({ recent: [recent("a", 5)] });
    const user = userEvent.setup();
    render(<Box />);
    await user.click(screen.getByRole("button", { name: "Open Claude: Session a" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-session", key: "a" });
  });

  it("counts nothing while no session waits, and offers New session and All sessions", async () => {
    useAgentSessionsStore.setState({ recent: [recent("a", 5)] });
    useRunningAgentSessionsStore.setState({ sessions: { a: running("Claude", "working") } });
    const user = userEvent.setup();
    render(<Box />);
    expect(screen.getByTestId("count")).toHaveTextContent("none");
    expect(screen.getByText("Working")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New session" }));
    expect(useStartAgentSessionStore.getState().open).toBe(true);
    await user.click(screen.getByRole("button", { name: "All sessions" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-sessions" });
  });

  it("says when there are no sessions, with New session", async () => {
    const user = userEvent.setup();
    render(<Box />);
    expect(screen.getByText("No agent sessions yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All sessions" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "New session" }));
    expect(useStartAgentSessionStore.getState().open).toBe(true);
  });

  it("follows a session's unseen mark", () => {
    useAgentSessionsStore.setState({ recent: [recent("a", 5)] });
    render(<Box />);
    expect(rowNames()).toEqual(["Open Claude: Session a"]);
    act(() => useRunningAgentSessionsStore.setState({ unseen: { a: true } }));
    expect(rowNames()).toEqual(["Open Claude: Session a, new"]);
  });

  it("needs the desktop app, and lists nothing on the web", () => {
    available.agent = false;
    useAgentSessionsStore.setState({ recent: [recent("a", 5)] });
    expect(boxKind("agentSessions")?.unavailableReason()).toBe(
      "Agent sessions needs the desktop app",
    );
    render(<Box />);
    expect(screen.getByText("No agent sessions yet.")).toBeInTheDocument();
    available.agent = true;
    expect(boxKind("agentSessions")?.unavailableReason()).toBeNull();
  });

  it("is one box without settings, on the desktop's default Home after the agents' runs", () => {
    const kind = boxKind("agentSessions")!;
    expect(kind.name).toBe("Agent sessions");
    expect(kind.multiple).toBe(false);
    expect(kind.settingsReadable).toBeUndefined();
    expect(defaultLayout(true, true).boxes.map((box) => box.kind)).toEqual([
      "waiting",
      "mentions",
      "unread",
      "agentRuns",
      "agentSessions",
    ]);
    expect(defaultLayout(false, false).boxes.map((box) => box.kind)).not.toContain("agentSessions");
  });
});

describe("AgentSessionList", () => {
  it("marks an unseen row", () => {
    render(
      <AgentSessionList
        rows={[
          {
            key: "a",
            agentName: "Claude",
            title: null,
            status: "ready",
            lastActivityAt: null,
            unseen: true,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open Claude: New session, new" }),
    ).toBeInTheDocument();
  });
});
