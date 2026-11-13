import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../plugins/api/usePluginList", () => ({
  useInstalledPlugins: () => ({ data: undefined }),
}));
vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: [] }),
}));
vi.mock("../../agent/agentAvailability", () => ({ agentAvailable: () => true }));
// The buttons run the agent commands, which only the desktop app has.
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => "desktop",
}));
vi.mock("./AgentPluginsDialog", () => ({
  AgentPluginsDialog: ({ agent }: { agent: { name: string } }) => (
    <div>Plugin commands of {agent.name}</div>
  ),
}));

// Its own tests cover it; here it would ask the installer and the runner too.
vi.mock("./AgentProgramsSection", () => ({
  AgentProgramsSection: () => <h3>Agents RIM starts</h3>,
}));

vi.mock("./AgentRunsDialog", () => ({
  AgentRunsDialog: ({ agent }: { agent: { name: string } | null }) => (
    <h2>{agent ? `Runs of ${agent.name}` : "All runs"}</h2>
  ),
}));

import { toast } from "../../../shared/toast";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useAgentsSettingsRequestStore } from "../state/useAgentsSettingsRequestStore";
import { useAgentProgramsStore } from "../state/useAgentProgramsStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";
import { AgentsSettings } from "./AgentsSettings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useShellStore } from "../../../shell/state/useShellStore";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgentsSettings />
    </QueryClientProvider>,
  );
}

const SWITCH = "Let agents on this computer connect";
const OFF_LINE = "These stay connected, but cannot reach RIM while this is off.";
const NOTHING = "Nothing is connected.";
const READ_FAILED = "RIM can't check this setting on this computer.";
const LISTEN_FAILED =
  "RIM could not start listening: port 47821 is in use. Close whatever else is using port 47821, then turn this off and on again.";

const AGENT: ConnectedAgent = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash-1",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: {},
  pluginApprovals: {},
};

interface Status {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  port: number;
}

let status: Status;
let readFails: boolean;
let saveFails: boolean;
let afterSave: Status | null;
const reset = vi.fn();

function setCalls() {
  return invoke.mock.calls.filter(([name]) => name === "agent_bridge_set_enabled");
}

async function renderedSwitch() {
  renderTab();
  const toggle = screen.getByRole("switch", { name: SWITCH });
  await waitFor(() => expect(toggle).toBeEnabled());
  return toggle;
}

describe("AgentsSettings", () => {
  beforeEach(() => {
    status = { enabled: false, listening: false, error: null, port: 47821 };
    readFails = false;
    saveFails = false;
    afterSave = null;
    invoke.mockImplementation((command: string, args?: { enabled?: boolean }) => {
      switch (command) {
        case "agent_bridge_status":
          return readFails ? Promise.reject("no state") : Promise.resolve(status);
        case "agent_bridge_set_enabled": {
          if (saveFails) return Promise.reject("disk full");
          const enabled = args?.enabled ?? false;
          status = afterSave ?? { enabled, listening: enabled, error: null, port: 47821 };
          return Promise.resolve(status);
        }
        default:
          return Promise.reject(new Error(`unexpected ${command}`));
      }
    });
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentProgramsStore.setState({ profiles: [] });
    usePendingPairingStore.setState({ reset });
  });

  afterEach(() => {
    invoke.mockReset();
    reset.mockReset();
    vi.mocked(toast.error).mockReset();
    usePendingPairingStore.setState(usePendingPairingStore.getInitialState(), true);
  });

  it("says what the tab is and what connecting means", async () => {
    await renderedSwitch();
    expect(screen.getByRole("heading", { name: "Agents that connect to RIM" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "An agent runs on your computer with its own model provider. What it reads goes to that provider, and RIM can't see or limit where it goes after that. Nothing can read your conversations until you connect it and choose what it may read.",
      ),
    ).toBeInTheDocument();
  });

  describe("connecting an agent from the app", () => {
    afterEach(() => useAgentsSettingsRequestStore.setState({ request: null }));

    it("mentions it while nothing is connected", async () => {
      await renderedSwitch();
      expect(screen.getByText(NOTHING)).toBeInTheDocument();
      expect(
        screen.getByText(/for Codex, opencode, Gemini CLI, Cursor, VS Code/),
      ).toBeInTheDocument();
    });

    it("opens the dialog from its button, which turns the switch on from there", async () => {
      const user = userEvent.setup();
      await renderedSwitch();
      await user.click(screen.getByRole("button", { name: "Connect an agent" }));
      const dialog = await screen.findByRole("dialog", { name: "Connect an agent" });
      expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();

      await user.click(within(dialog).getByRole("switch", { name: SWITCH }));
      expect(setCalls()).toEqual([["agent_bridge_set_enabled", { enabled: true }]]);
      await user.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Codex");
      await user.click(within(dialog).getByRole("button", { name: "Connect" }));
      expect(await screen.findByRole("dialog", { name: "Set up the agent" })).toHaveTextContent(
        "http://127.0.0.1:47821/mcp",
      );
      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Codex/ })).toBeInTheDocument();
      expect(screen.getByText(/Nothing granted/)).toBeInTheDocument();
    });

    it("opens the dialog when the command asks", async () => {
      await renderedSwitch();
      act(() => useAgentsSettingsRequestStore.getState().open({ kind: "connect" }));
      expect(await screen.findByRole("dialog", { name: "Connect an agent" })).toBeInTheDocument();
    });
  });

  it("disables the switch until the state is read", async () => {
    renderTab();
    const toggle = screen.getByRole("switch", { name: SWITCH });
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
  });

  it("reads the switch as on", async () => {
    status = { ...status, enabled: true, listening: true };
    expect(await renderedSwitch()).toBeChecked();
  });

  it("turns on", async () => {
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    expect(setCalls()).toEqual([["agent_bridge_set_enabled", { enabled: true }]]);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(reset).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("turns off, and that closes a pending dialog", async () => {
    status = { ...status, enabled: true, listening: true };
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    expect(setCalls()).toEqual([["agent_bridge_set_enabled", { enabled: false }]]);
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    expect(toggle).not.toBeChecked();
  });

  it("puts the switch back, says so and keeps the dialog when saving fails", async () => {
    status = { ...status, enabled: true, listening: true };
    saveFails = true;
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The setting could not be saved"));
    expect(toggle).toBeChecked();
    expect(reset).not.toHaveBeenCalled();
  });

  it("ignores a second press during a save", async () => {
    let finish: (value: Status) => void = () => undefined;
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(toggle);
    await user.click(toggle);
    expect(setCalls()).toHaveLength(1);
    await act(async () => finish({ ...status, enabled: true, listening: true }));
    expect(toggle).toBeChecked();
  });

  it("keeps the switch off and disabled and says so when reading fails", async () => {
    readFails = true;
    renderTab();
    expect(await screen.findByText(READ_FAILED)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: SWITCH });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
  });

  it("says why it is not listening", async () => {
    status = { enabled: true, listening: false, error: "port 47821 is in use", port: 47821 };
    await renderedSwitch();
    expect(screen.getByRole("alert")).toHaveTextContent(LISTEN_FAILED);
  });

  it("says why when turning on finds the port in use", async () => {
    afterSave = { enabled: true, listening: false, error: "port 47821 is in use", port: 47821 };
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent(LISTEN_FAILED);
    expect(toggle).toBeChecked();
  });

  it("shows no error while listening or off", async () => {
    await renderedSwitch();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says when nothing is connected", async () => {
    await renderedSwitch();
    expect(screen.getByText(NOTHING)).toBeInTheDocument();
    expect(screen.queryByText(OFF_LINE)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists what is connected", async () => {
    status = { ...status, enabled: true, listening: true };
    useConnectedAgentsStore.setState({
      agents: [AGENT, { ...AGENT, id: "agent-2", name: "<b>Other</b>" }],
    });
    await renderedSwitch();
    const rows = within(screen.getAllByRole("list")[0]).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Claude Code");
    expect(rows[0]).toHaveTextContent(`Connected ${new Date(AGENT.pairedAt).toLocaleString()}`);
    expect(rows[0]).toHaveTextContent("Nothing granted");
    expect(rows[1]).toHaveTextContent("<b>Other</b>");
    expect(screen.queryByText(NOTHING)).not.toBeInTheDocument();
    expect(screen.queryByText(OFF_LINE)).not.toBeInTheDocument();
  });

  it("says that connected programs cannot reach RIM while off", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    await renderedSwitch();
    expect(screen.getByText(OFF_LINE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Claude Code/ })).toBeInTheDocument();
  });

  it("disconnects after asking, and never holds a token", async () => {
    status = { ...status, enabled: true, listening: true };
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    const user = userEvent.setup();
    await renderedSwitch();
    await user.click(screen.getByRole("button", { name: "Disconnect Claude Code" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect Claude Code?" });
    expect(dialog).toHaveTextContent(
      "It will not be able to reach RIM any more. It keeps nothing RIM can take back: what it has already read stays with it.",
    );
    expect(useConnectedAgentsStore.getState().agents).toEqual([AGENT]);
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    expect(screen.getByText(NOTHING)).toBeInTheDocument();
  });

  it("removes the agent RIM can start along with the agent it made for it", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentProgramsStore.setState({
      profiles: [
        {
          id: "profile-1",
          name: "Claude Code",
          program: "claude-agent-acp",
          resolvedProgram: "/usr/bin/claude-agent-acp",
          args: [],
          defaultFolder: null,
          presetId: "claude-code",
          agentId: AGENT.id,
          token: "rimagent_settings-token",
          addedAt: AGENT.pairedAt,
        },
      ],
    });
    const fallback = invoke.getMockImplementation();
    invoke.mockImplementation((command: string, args?: { enabled?: boolean }) =>
      command === "agent_runner_forget" ? Promise.resolve(null) : fallback?.(command, args),
    );
    const user = userEvent.setup();
    await renderedSwitch();
    await user.click(screen.getByRole("button", { name: "Disconnect Claude Code" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect Claude Code?" });
    expect(dialog).toHaveTextContent("RIM removes it from Agents RIM starts.");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("agent_runner_forget", {
        program: "/usr/bin/claude-agent-acp",
        args: [],
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("rimagent_settings-token");
  });

  it("moves focus to the switch after the last agent is disconnected", async () => {
    status = { ...status, enabled: true, listening: true };
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    const user = userEvent.setup();
    await renderedSwitch();
    await user.click(screen.getByRole("button", { name: "Disconnect Claude Code" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Disconnect Claude Code?" })).getByRole("button", {
        name: "Disconnect",
      }),
    );
    await waitFor(() => expect(screen.getByRole("switch")).toHaveFocus());
  });

  it("keeps the program when disconnecting is cancelled", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    const user = userEvent.setup();
    await renderedSwitch();
    await user.click(screen.getByRole("button", { name: "Disconnect Claude Code" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useConnectedAgentsStore.getState().agents).toEqual([AGENT]);
  });

  it("opens the runs by keyboard", async () => {
    const user = userEvent.setup();
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAgentRecordStore.setState({
      entries: [
        {
          at: "2026-11-06T10:00:00.000Z",
          agentId: "agent-1",
          agentName: "Claude Code",
          tool: "rim_read_messages",
          workspaceId: "w1",
          channelId: null,
          query: false,
          messageIds: [],
          refused: false,
        },
      ],
    });
    renderTab();
    for (const name of ["Runs of Claude Code", "All runs"]) {
      const button = screen.getByRole("button", { name });
      let reached = false;
      for (let i = 0; i < 20 && !reached; i++) {
        await user.tab();
        reached = document.activeElement === button;
      }
      expect(reached).toBe(true);
      await user.keyboard("{Enter}");
      expect(
        screen.getByText(name === "All runs" ? "All runs" : "Runs of Claude Code", {
          selector: "h2",
        }),
      ).toBeInTheDocument();
    }
  });

  it("offers each connected agent what it can read and what it was given", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    await renderedSwitch();
    expect(
      screen.getByRole("button", { name: "Choose what Claude Code can read" }),
    ).toHaveTextContent("Choose what it can read");
    expect(screen.getByRole("button", { name: "What Claude Code was given" })).toHaveTextContent(
      "What it was given",
    );
  });

  it("opens the choice of commands for that agent", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    const user = userEvent.setup();
    await renderedSwitch();
    const button = screen.getByRole("button", {
      name: "Choose the commands of Claude Code",
    });
    expect(button).toHaveTextContent("Choose its commands");
    await user.click(button);
    expect(screen.getByText("Plugin commands of Claude Code")).toBeInTheDocument();
  });

  it("shows no detail until one of several agents is chosen", async () => {
    useConnectedAgentsStore.setState({
      agents: [AGENT, { ...AGENT, id: "agent-2", name: "Other" }],
    });
    const user = userEvent.setup();
    await renderedSwitch();
    expect(screen.queryByRole("button", { name: "Disconnect Claude Code" })).toBeNull();
    const first = screen.getByRole("button", { name: /^Claude Code/ });
    expect(first).toHaveAttribute("aria-pressed", "false");
    await user.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Disconnect Claude Code" })).toBeInTheDocument();
  });

  it("counts grants and runs in the list and writes the detail from the grants", async () => {
    useConnectedAgentsStore.setState({
      agents: [
        {
          ...AGENT,
          grants: {
            w1: { all: false, channelIds: ["c1", "c2"] },
            w2: { all: true, channelIds: [] },
          },
          pluginApprovals: { p: { manifestHash: "h", commandIds: ["a"] } },
        },
      ],
    });
    useAgentRecordStore.setState({
      entries: [
        {
          at: "2026-11-06T10:00:00.000Z",
          agentId: "agent-1",
          agentName: "Claude Code",
          tool: "rim_read_messages",
          workspaceId: "w1",
          channelId: "c1",
          query: false,
          messageIds: ["m1", "m2"],
          refused: false,
          runId: "r1",
        },
        {
          at: "2026-11-06T10:05:00.000Z",
          agentId: "agent-1",
          agentName: "Claude Code",
          tool: "rim_read_messages",
          workspaceId: "w1",
          channelId: "c1",
          query: false,
          messageIds: ["m2", "m3"],
          refused: false,
          runId: "r1",
        },
      ],
    });
    await renderedSwitch();
    const row = screen.getByRole("button", { name: /^Claude Code/ });
    expect(row).toHaveTextContent("Every channel in 1 workspace · 2 channels granted · 1 run");
    expect(screen.getByText("Every channel you can see")).toBeInTheDocument();
    expect(screen.getByText("Granted by you. No prompt on each read.")).toBeInTheDocument();
    expect(screen.getByText(/do only what you can do/)).toHaveClass("font-medium");
    expect(
      screen.getByText("Encrypted conversations, direct messages and groups"),
    ).toBeInTheDocument();
    expect(screen.getByText("Plugin commands: 1 approved.")).toBeInTheDocument();
    expect(screen.getByText("RIM commands: none approved for Claude Code.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Channel", "Messages", "Last read"]);
    expect(within(table).getByRole("rowheader")).toHaveTextContent("w1 · #c1");
    expect(within(table).getByText("3 messages")).toBeInTheDocument();
    expect(screen.getByText("This list stays on this device.")).toBeInTheDocument();
  });

  it("shows invisible characters in names, and caps the given list at eight", async () => {
    useConnectedAgentsStore.setState({ agents: [{ ...AGENT, name: "Evil\u202Ename" }] });
    useAgentRecordStore.setState({
      entries: Array.from({ length: 10 }, (_, i) => ({
        at: `2026-11-06T10:0${i}:00.000Z`,
        agentId: "agent-1",
        agentName: "x",
        tool: "rim_read_messages",
        workspaceId: "w1",
        channelId: `c${i}`,
        query: false,
        messageIds: [`m${i}`],
        refused: false,
      })),
    });
    await renderedSwitch();
    expect(screen.getByRole("button", { name: "Disconnect Evil⟦U+202E⟧name" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("rowheader")).toHaveLength(8);
    expect(screen.getByText("The 8 most recent of 10 channels.")).toBeInTheDocument();
  });

  it("runs the agent commands from its buttons, on the agent shown", async () => {
    const user = userEvent.setup();
    useConnectedAgentsStore.setState({
      agents: [AGENT, { ...AGENT, id: "agent-2", name: "Other" }],
    });
    useAgentRecordStore.setState({
      entries: [
        {
          at: "2026-11-06T10:00:00.000Z",
          agentId: "agent-1",
          agentName: "Claude Code",
          tool: "rim_read_messages",
          workspaceId: "w1",
          channelId: null,
          query: false,
          messageIds: [],
          refused: false,
        },
      ],
    });
    const open = vi.spyOn(useAgentsSettingsRequestStore.getState(), "open");
    renderTab();
    await user.click(screen.getByRole("button", { name: /^Claude Code/ }));
    for (const [name, kind] of [
      ["Disconnect Claude Code", "disconnect"],
      ["Choose what Claude Code can read", "chooseReads"],
      ["Choose the commands of Claude Code", "choosePlugins"],
      ["What Claude Code was given", "record"],
      ["Runs of Claude Code", "runs"],
    ]) {
      await user.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(open).toHaveBeenCalledWith({ kind, agentId: "agent-1" }));
      // Each dialog is closed again so the next button is reachable.
      await user.keyboard("{Escape}");
      open.mockClear();
    }
    await user.click(screen.getByRole("button", { name: "What agents were given" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith({ kind: "record" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "All runs" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith({ kind: "allRuns" }));
    open.mockRestore();
  });

  it("starts by saying what agents are for, and links to the Assistant tab", async () => {
    await renderedSwitch();
    const headings = screen.getAllByRole("heading");
    expect(headings[0]).toHaveTextContent("Agents");
    expect(headings[0]!.nextElementSibling).toHaveTextContent(
      "Programs on this computer, such as Claude Code or Codex, that RIM connects to or starts. Optional: RIM works the same without them. The assistant built into RIM is set up in Assistant.",
    );
    expect(
      within(headings[0]!.nextElementSibling as HTMLElement).getByRole("button", {
        name: "Assistant",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/has its own tab/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open AI Agent" })).not.toBeInTheDocument();
  });

  it("opens the Assistant tab from the intro", async () => {
    useShellStore.setState({ mainSurface: { kind: "settings", tab: "agents" } });
    const user = userEvent.setup();
    await renderedSwitch();
    await user.click(screen.getByRole("button", { name: "Assistant" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agent" });
  });

  describe("opened by a command", () => {
    const ENTRY = {
      at: "2026-11-06T10:00:00.000Z",
      agentId: "agent-1",
      agentName: "Claude Code",
      tool: "rim_read_messages",
      workspaceId: "w1",
      channelId: "c1",
      query: false,
      messageIds: ["m1"],
      refused: false,
    };

    afterEach(() => {
      useAgentsSettingsRequestStore.setState({ request: null });
      useAgentRecordStore.setState({ entries: [] });
      vi.mocked(toast.info).mockReset();
    });

    it("opens the disconnect confirmation of the agent picked", async () => {
      useConnectedAgentsStore.setState({
        agents: [AGENT, { ...AGENT, id: "agent-2", name: "Other" }],
      });
      useAgentsSettingsRequestStore.getState().open({ kind: "disconnect", agentId: "agent-2" });
      await renderedSwitch();
      const dialog = screen.getByRole("dialog", { name: "Disconnect Other?" });
      expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Other in detail" })).toBeInTheDocument();
      expect(useConnectedAgentsStore.getState().agents).toHaveLength(2);
      expect(useAgentsSettingsRequestStore.getState().request).toBeNull();
    });

    it("takes a request made while the tab is open", async () => {
      useConnectedAgentsStore.setState({ agents: [AGENT] });
      await renderedSwitch();
      act(() => useAgentsSettingsRequestStore.getState().open({ kind: "allRuns" }));
      expect(screen.getByRole("heading", { name: "All runs" })).toBeInTheDocument();
    });

    it("says so when the agent picked is gone", async () => {
      useAgentsSettingsRequestStore.getState().open({ kind: "chooseReads", agentId: "gone" });
      await renderedSwitch();
      expect(toast.info).toHaveBeenCalledWith("That agent is no longer connected");
    });

    it("opens the clear confirmation, which clears only when confirmed", async () => {
      const user = userEvent.setup();
      useAgentRecordStore.setState({ entries: [ENTRY] });
      useAgentsSettingsRequestStore.getState().open({ kind: "clearRecord" });
      await renderedSwitch();
      const dialog = screen.getByRole("dialog", { name: "Clear the whole record?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(useAgentRecordStore.getState().entries).toEqual([ENTRY]);

      act(() => useAgentsSettingsRequestStore.getState().open({ kind: "clearRecord" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Clear the whole record?" })).getByRole(
          "button",
          { name: "Clear" },
        ),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(useAgentRecordStore.getState().entries).toHaveLength(1);
      expect(useAgentRecordStore.getState().entries[0]!.tool).not.toBe("rim_read_messages");
    });
  });
});
