import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../acp/agentRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../acp/agentRunner")>()),
  ...(await import("../../../../test/fakeAcpAgent")).fakeAcpAgent.module(),
  findAgentPrograms: (names: string[]) => Promise.resolve(names.map(() => "/usr/bin/fake-agent")),
}));
vi.mock("../../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/runtime/runtime")>()),
  detectPlatform: () => "desktop",
}));
vi.mock("../../../notifications/runtime/desktopNotification", () => ({
  showDesktopNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../conversations/api/useConversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../conversations/api/useConversation")>()),
  useConversation: (_workspaceId: string, conversationId: string) => ({
    data: conversationId === "conv-1" ? { id: "conv-1", title: "incidents" } : undefined,
  }),
}));

import { useShellStore } from "../../../../shell/state/useShellStore";
import { fakeAcpAgent as agent, helloAnswer } from "../../../../test/fakeAcpAgent";
import { AgentSession, type AgentSessionSnapshot } from "../../acp/agentSession";
import type { AgentBridgeStatus } from "../../api/agentBridge";
import type { AskSubject } from "../../runtime/askContext";
import { reportMissingGrant } from "../../runtime/grantRefusals";
import type { AgentGrants } from "../../runtime/grants";
import { useAgentProgramsStore, type AgentProgramProfile } from "../../state/useAgentProgramsStore";
import {
  setAgentSessionDepsForTests,
  startAgentSession,
  stopAllAgentSessions,
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
} from "../../state/useAgentSessionsStore";
import { askAgent, resetAskAgent, useAskAgentStore } from "../../state/useAskAgentStore";
import { useConnectedAgentsStore } from "../../state/useConnectedAgentsStore";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { AgentSessionPage } from "./AgentSessionPage";
import { AskAgentHost } from "./AskAgentDialogs";
import { StartAgentSessionDialogHost } from "./StartAgentSessionDialog";

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Fake Agent",
  program: "fake-agent",
  resolvedProgram: "/usr/bin/fake-agent",
  args: ["acp"],
  defaultFolder: "/home/a/project",
  presetId: null,
  agentId: "a1",
  token: "rimagent_ask-token-0123456789abcdefghijklmnopqrstu",
  addedAt: "2026-11-10T10:00:00.000Z",
};

const BRIDGE_ON: AgentBridgeStatus = { enabled: true, listening: true, error: null, port: 47821 };

const CHANNEL: AskSubject = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  messageId: null,
  channelName: "incidents",
  workspaceName: "Acme",
};

/** Text a message in the channel holds, which no prompt may carry. */
const MESSAGE_TEXT = "the database is down again";

function connect(grants: AgentGrants = {}) {
  useConnectedAgentsStore.setState({
    agents: [
      {
        id: "a1",
        name: "Fake Agent",
        tokenHash: "hash",
        pairedAt: "2026-11-10T10:00:00.000Z",
        grants,
        pluginApprovals: {},
        commandApprovals: [],
      },
    ],
  });
}

function grants(): AgentGrants {
  return useConnectedAgentsStore.getState().agents[0].grants;
}

/** The main surface as the app shell shows it, with the start dialog and the ask dialogs. */
function Shell() {
  const surface = useShellStore((s) => s.mainSurface);
  return (
    <>
      {surface.kind === "agent-session" && (
        <AgentSessionPage key={surface.key} sessionKey={surface.key} />
      )}
      <StartAgentSessionDialogHost />
      <AskAgentHost />
    </>
  );
}

/** Starts a session and waits until it takes prompts. */
async function readySession(): Promise<string> {
  let key = "";
  act(() => {
    key = startAgentSession(PROFILE, "/home/a/project");
  });
  await waitFor(() =>
    expect(useRunningAgentSessionsStore.getState().sessions[key]?.status).toBe("ready"),
  );
  return key;
}

/** A stand-in session reporting `status`, for the chooser's list. */
function standIn(key: string, status: AgentSessionSnapshot["status"], name: string) {
  const session = new AgentSession();
  vi.spyOn(session, "status", "get").mockReturnValue(status);
  vi.spyOn(session, "getSnapshot").mockReturnValue({
    ...session.getSnapshot(),
    status,
    name,
    profileId: "p1",
    cwd: `/home/a/${key}`,
    rimTools: "available",
  });
  vi.spyOn(session, "stop").mockResolvedValue();
  return session;
}

function prompts() {
  return agent.requests("session/prompt").map((request) => (request.params as never)["prompt"]);
}

describe("Ask agent", () => {
  beforeEach(() => {
    agent.reset();
    agent
      .on("initialize", () => helloAnswer())
      .on("session/new", () => ({ sessionId: "sess_1" }))
      .on("session/prompt", () => ({ stopReason: "end_turn" }));
    setAgentSessionDepsForTests({ bridgeStatus: () => Promise.resolve(BRIDGE_ON) });
    useAgentProgramsStore.setState({ profiles: [PROFILE] });
    connect();
  });

  afterEach(async () => {
    await act(() => stopAllAgentSessions());
    act(() => resetAskAgent());
    useAgentSessionsStore.setState({ recent: [] });
    useAgentProgramsStore.setState({ profiles: [] });
    useConnectedAgentsStore.setState({ agents: [] });
    useStartAgentSessionStore.getState().close();
    useShellStore.getState().reset();
    setAgentSessionDepsForTests({});
    vi.clearAllMocks();
  });

  describe("choosing a session", () => {
    it("lists the sessions that are ready or working, and New session…", () => {
      useRunningAgentSessionsStore.setState({
        sessions: {
          one: standIn("one", "ready", "Ready Agent"),
          two: standIn("two", "working", "Busy Agent"),
          three: standIn("three", "ended", "Ended Agent"),
          four: standIn("four", "waiting", "Waiting Agent"),
        },
      });
      useAgentSessionsStore.getState().upsert({
        key: "one",
        profileId: "p1",
        agentName: "Ready Agent",
        cwd: "/home/a/one",
        acpSessionId: "acp-1",
        title: "Fix the build",
        startedAt: "2026-11-10T10:00:00.000Z",
        lastActivityAt: "2026-11-10T10:00:00.000Z",
        canReopen: false,
      });
      render(<Shell />);
      act(() => askAgent(CHANNEL));
      const dialog = screen.getByRole("dialog", { name: "Ask an agent" });
      expect(within(dialog).getByText(/About: #incidents/u)).toBeInTheDocument();
      const list = within(dialog).getByRole("list", { name: "Agent sessions" });
      const choices = within(list).getAllByRole("button");
      expect(choices.map((choice) => choice.textContent)).toEqual([
        expect.stringContaining("Ready Agent"),
        expect.stringContaining("Busy Agent"),
        "New session…",
      ]);
      expect(choices[0]).toHaveTextContent("Fix the build");
      expect(choices[0]).toHaveTextContent("/home/a/one");
      expect(choices[1]).toHaveTextContent("Busy Agent");
      useRunningAgentSessionsStore.setState({ sessions: {} });
    });

    it("says when RIM's tools are off in a session, and still offers it", async () => {
      setAgentSessionDepsForTests({
        bridgeStatus: () => Promise.resolve({ ...BRIDGE_ON, enabled: false }),
      });
      await readySession();
      render(<Shell />);
      act(() => askAgent(CHANNEL));
      const choice = screen.getByRole("button", { name: /Fake Agent/u });
      expect(choice).toHaveTextContent(
        "Fake Agent can't read RIM in this session: RIM's tools are off in Settings → Agents.",
      );
      expect(choice).toBeEnabled();
    });

    it("starts a new session from the chooser and asks there once it is ready", async () => {
      const user = userEvent.setup();
      render(<Shell />);
      act(() => askAgent(CHANNEL));
      await user.click(screen.getByRole("button", { name: "New session…" }));
      const start = await screen.findByRole("dialog", { name: "Start an agent session" });
      await user.click(within(start).getByRole("button", { name: "Start" }));
      const offer = await screen.findByRole("dialog", {
        name: "Fake Agent can't read #incidents yet",
      });
      await user.click(within(offer).getByRole("button", { name: "Let it read #incidents" }));
      expect(await screen.findByText("About: #incidents")).toBeInTheDocument();
      expect(grants()).toEqual({ "ws-1": { all: false, channelIds: ["conv-1"] } });
    });
  });

  describe("the grant", () => {
    it("offers the missing grant, and Let it read adds exactly that one channel", async () => {
      connect({
        "ws-1": { all: false, channelIds: ["conv-0"] },
        "ws-2": { all: true, channelIds: [] },
      });
      const key = await readySession();
      const user = userEvent.setup();
      render(<Shell />);
      act(() => askAgent(CHANNEL));
      await user.click(screen.getByRole("button", { name: /Fake Agent/u }));
      const offer = await screen.findByRole("dialog", {
        name: "Fake Agent can't read #incidents yet",
      });
      expect(within(offer).getByText("Let it read #incidents?")).toBeInTheDocument();
      expect(within(offer).getByText(/^What it reads goes to the model provider/u)).toBeVisible();
      expect(grants()).toEqual({
        "ws-1": { all: false, channelIds: ["conv-0"] },
        "ws-2": { all: true, channelIds: [] },
      });
      await user.click(within(offer).getByRole("button", { name: "Let it read #incidents" }));
      expect(grants()).toEqual({
        "ws-1": { all: false, channelIds: ["conv-0", "conv-1"] },
        "ws-2": { all: true, channelIds: [] },
      });
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-session", key });
      expect(await screen.findByText("About: #incidents")).toBeInTheDocument();
    });

    it("adds no grant on Not now, and still attaches the channel", async () => {
      await readySession();
      const user = userEvent.setup();
      render(<Shell />);
      act(() => askAgent(CHANNEL));
      await user.click(screen.getByRole("button", { name: /Fake Agent/u }));
      await user.click(await screen.findByRole("button", { name: "Not now" }));
      expect(grants()).toEqual({});
      expect(await screen.findByText("About: #incidents")).toBeInTheDocument();
    });

    it("offers nothing when a grant covers the channel already", async () => {
      connect({ "ws-1": { all: true, channelIds: [] } });
      await readySession();
      const user = userEvent.setup();
      render(<Shell />);
      act(() => askAgent({ ...CHANNEL, messageId: "msg-1" }));
      await user.click(screen.getByRole("button", { name: /Fake Agent/u }));
      expect(await screen.findByText("About: a message in #incidents")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(grants()).toEqual({ "ws-1": { all: true, channelIds: [] } });
    });
  });

  describe("the prompt", () => {
    async function attached(subject: AskSubject) {
      connect({ "ws-1": { all: true, channelIds: [] } });
      await readySession();
      const user = userEvent.setup();
      render(<Shell />);
      act(() => askAgent(subject));
      await user.click(screen.getByRole("button", { name: /Fake Agent/u }));
      const composer = await screen.findByRole("textbox", { name: "Prompt for Fake Agent" });
      await waitFor(() => expect(composer).toHaveFocus());
      return { user, composer };
    }

    it("sends nothing until Enter, then the person's words, the link and the hint", async () => {
      const { user, composer } = await attached({ ...CHANNEL, messageId: "msg-1" });
      await user.type(composer, "What should we do?");
      expect(prompts()).toEqual([]);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(prompts()[0]).toEqual([
        { type: "text", text: "What should we do?" },
        {
          type: "resource_link",
          uri: "rim://workspace/ws-1/conversation/conv-1/message/msg-1",
          name: "Message in #incidents",
        },
        {
          type: "text",
          text: "About this RIM conversation: workspace ws-1, conversation conv-1, message msg-1. Use RIM's tools to read it.",
        },
      ]);
      expect(JSON.stringify(prompts())).not.toContain(MESSAGE_TEXT);
      expect(screen.queryByText("About: a message in #incidents", { selector: "span" })).toBeNull();
      expect(
        within(screen.getByRole("list", { name: "Transcript" })).getByText(
          "About: a message in #incidents",
        ),
      ).toBeInTheDocument();
    });

    it("sends only the person's words once the chip is removed", async () => {
      const { user, composer } = await attached(CHANNEL);
      await user.click(screen.getByRole("button", { name: "Remove what this prompt is about" }));
      expect(screen.queryByText("About: #incidents")).toBeNull();
      await user.type(composer, "Hello{Enter}");
      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(prompts()[0]).toEqual([{ type: "text", text: "Hello" }]);
    });
  });

  describe("after a refusal", () => {
    const REFUSAL = { agentId: "a1", workspaceId: "ws-1", conversationId: "conv-1" };

    it("offers the grant once, and Let it read adds that one channel", async () => {
      const key = await readySession();
      act(() => useShellStore.getState().setMainSurface({ kind: "agent-session", key }));
      const user = userEvent.setup();
      render(<Shell />);
      act(() => {
        reportMissingGrant(REFUSAL);
        reportMissingGrant(REFUSAL);
      });
      expect(
        screen.getAllByText("Fake Agent asked to read #incidents, which it can't read."),
      ).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "Let it read #incidents" }));
      const offer = await screen.findByRole("dialog", {
        name: "Fake Agent can't read #incidents yet",
      });
      expect(grants()).toEqual({});
      await user.click(within(offer).getByRole("button", { name: "Let it read #incidents" }));
      expect(grants()).toEqual({ "ws-1": { all: false, channelIds: ["conv-1"] } });
      expect(screen.queryByText(/asked to read #incidents/u)).toBeNull();
      act(() => reportMissingGrant(REFUSAL));
      expect(screen.queryByText(/asked to read #incidents/u)).toBeNull();
    });

    it("keeps the card on Not now, and Dismiss takes it away for good", async () => {
      const key = await readySession();
      act(() => useShellStore.getState().setMainSurface({ kind: "agent-session", key }));
      const user = userEvent.setup();
      render(<Shell />);
      act(() => reportMissingGrant(REFUSAL));
      await user.click(screen.getByRole("button", { name: "Let it read #incidents" }));
      await user.click(await screen.findByRole("button", { name: "Not now" }));
      expect(grants()).toEqual({});
      expect(screen.getByText(/asked to read #incidents/u)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText(/asked to read #incidents/u)).toBeNull();
      act(() => reportMissingGrant(REFUSAL));
      expect(screen.queryByText(/asked to read #incidents/u)).toBeNull();
      expect(grants()).toEqual({});
    });

    it("shows nothing for another agent's refusal", async () => {
      const key = await readySession();
      act(() => useShellStore.getState().setMainSurface({ kind: "agent-session", key }));
      render(<Shell />);
      act(() => reportMissingGrant({ ...REFUSAL, agentId: "someone-else" }));
      expect(screen.queryByText(/asked to read/u)).toBeNull();
      expect(useAskAgentStore.getState().refused).toEqual({});
    });
  });
});
