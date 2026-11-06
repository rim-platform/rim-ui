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

import { toast } from "../../../shared/toast";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";
import { AgentsSettings } from "./AgentsSettings";

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
  render(<AgentsSettings />);
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
    expect(screen.getByRole("heading", { name: "Agents on this computer" })).toBeInTheDocument();
    expect(screen.getByText("Optional. RIM works the same without them.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "An agent runs on your computer with its own model provider. What it reads goes to that provider, and RIM can't see or limit where it goes after that. Nothing can read your conversations until you connect it and choose what it may read.",
      ),
    ).toBeInTheDocument();
  });

  it("disables the switch until the state is read", async () => {
    render(<AgentsSettings />);
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
    render(<AgentsSettings />);
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
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Claude Code");
    expect(rows[0]).toHaveTextContent(`Connected ${new Date(AGENT.pairedAt).toLocaleDateString()}`);
    expect(rows[1]).toHaveTextContent("<b>Other</b>");
    expect(screen.queryByText(NOTHING)).not.toBeInTheDocument();
    expect(screen.queryByText(OFF_LINE)).not.toBeInTheDocument();
  });

  it("says that connected programs cannot reach RIM while off", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    await renderedSwitch();
    expect(screen.getByText(OFF_LINE)).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
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

  it("keeps the program when disconnecting is cancelled", async () => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    const user = userEvent.setup();
    await renderedSwitch();
    await user.click(screen.getByRole("button", { name: "Disconnect Claude Code" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useConnectedAgentsStore.getState().agents).toEqual([AGENT]);
  });
});
