import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../plugins/api/usePluginList", () => ({ useInstalledPlugins: () => mocks.list() }));

import type { PluginCommandInfo, PluginInfo } from "../../plugins/types";
import {
  useConnectedAgentsStore,
  type ConnectedAgent,
  type PluginApproval,
} from "../state/useConnectedAgentsStore";
import { AgentPluginsDialog } from "./AgentPluginsDialog";

const PLUGIN = "dev.example.pods";
const INTRO =
  "A plugin command can do anything the plugin can. Approve only what you want this program to use. Approvals for RIM's own agent don't carry over.";
const CHANGED = "This plugin changed since you approved it. Choose again.";
const EMPTY = "No plugin here offers commands to agents.";
const READ_ONLY_LINE =
  "The plugin says this only reads. RIM can't check that, so it runs without asking.";
const DANGEROUS_LINE = "Dangerous. It can only suggest this, and you run it yourself.";
const ASKS_LINE = "Asks you each time.";
const GRANT_LINE = "Only works on channels it has a grant for.";

function command(id: string, fields: Partial<PluginCommandInfo> = {}): PluginCommandInfo {
  return {
    id,
    qualified_id: `plugin.${PLUGIN}.${id}`,
    title: `Title of ${id}`,
    description: `About ${id}`,
    keybind_capable: false,
    dangerous: false,
    ai_callable: true,
    read_only: false,
    arguments: [],
    ...fields,
  };
}

function plugin(fields: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: PLUGIN,
    manifest_id: PLUGIN,
    display_name: "Pods",
    version: "1.2.3",
    description: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    manifest_hash: "hash-1",
    fingerprint_changed: false,
    commands: [
      command("reads", { read_only: true }),
      command("changes"),
      command("wipes", { dangerous: true }),
      command("hidden", { ai_callable: false }),
    ],
    ...fields,
  };
}

function loaded(plugins: PluginInfo[]) {
  return { data: plugins, isPending: false, isError: false, isSuccess: true };
}

const onClose = vi.fn();

function show(approvals: Record<string, PluginApproval> = {}) {
  const agent: ConnectedAgent = {
    id: "agent-1",
    name: "Claude Code",
    tokenHash: "hash",
    pairedAt: "2026-11-06T10:00:00.000Z",
    grants: {},
    pluginApprovals: approvals,
  };
  useConnectedAgentsStore.setState({ agents: [agent] });
  return render(<AgentPluginsDialog agent={agent} onClose={onClose} />);
}

function stored() {
  return useConnectedAgentsStore.getState().agents[0].pluginApprovals;
}

function check(id: string) {
  return screen.getByRole("checkbox", { name: new RegExp(`Title of ${id}`) });
}

async function save() {
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("AgentPluginsDialog", () => {
  beforeEach(() => {
    onClose.mockReset();
    mocks.list.mockReset().mockReturnValue(loaded([plugin()]));
  });

  it("names the agent and says what approving means", () => {
    show();
    expect(screen.getByRole("heading", { name: "What Claude Code can run" })).toBeInTheDocument();
    expect(screen.getByText(INTRO)).toBeInTheDocument();
  });

  it("groups commands under the plugin's name and version, all off to start", () => {
    show();
    const group = screen.getByRole("region", { name: "Pods 1.2.3" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    for (const box of within(group).getAllByRole("checkbox")) expect(box).not.toBeChecked();
  });

  it("shows only what is offered to agents, by enabled plugins", () => {
    mocks.list.mockReturnValue(
      loaded([
        plugin(),
        plugin({ plugin_id: "dev.example.off", display_name: "Off", enabled: false }),
        plugin({
          plugin_id: "dev.example.none",
          display_name: "None",
          commands: [command("hidden", { ai_callable: false })],
        }),
      ]),
    );
    show();
    expect(screen.queryByText("Title of hidden")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Off/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /None/ })).not.toBeInTheDocument();
  });

  it.each([
    ["reads", READ_ONLY_LINE],
    ["changes", ASKS_LINE],
    ["wipes", DANGEROUS_LINE],
  ])("words %s for what it does", (id, line) => {
    show();
    expect(check(id).closest("label")).toHaveTextContent(line);
  });

  it("shows the id, description, capabilities used and when a grant is needed", () => {
    mocks.list.mockReturnValue(
      loaded([
        plugin({
          commands: [
            command("reads", {
              read_only: true,
              required_capabilities: ["chat.read", "chat.read.encrypted"],
              required_context: ["conversation"],
            }),
            command("on_message", { required_context: ["message"] }),
            command("in_workspace", { required_context: ["workspace"] }),
          ],
        }),
      ]),
    );
    show();
    const reads = check("reads").closest("label");
    expect(reads).toHaveTextContent("reads");
    expect(reads).toHaveTextContent("About reads");
    expect(reads).toHaveTextContent("Uses: chat.read, chat.read.encrypted");
    expect(reads).toHaveTextContent(GRANT_LINE);
    expect(check("on_message").closest("label")).toHaveTextContent(GRANT_LINE);
    const workspace = check("in_workspace").closest("label");
    expect(workspace).not.toHaveTextContent(GRANT_LINE);
    expect(workspace).not.toHaveTextContent("Uses:");
  });

  it("shows invisible characters in what the plugin wrote", () => {
    mocks.list.mockReturnValue(
      loaded([
        plugin({
          display_name: "Po‮ds",
          commands: [command("reads", { title: "Read‮me", description: "Ab​out" })],
        }),
      ]),
    );
    show();
    expect(screen.getByRole("heading", { name: /Po⟦U\+202E⟧ds/ })).toBeInTheDocument();
    const label = screen.getByRole("checkbox").closest("label");
    expect(label).toHaveTextContent("Read⟦U+202E⟧me");
    expect(label).toHaveTextContent("Ab⟦U+200B⟧out");
    expect(label?.textContent).not.toContain("‮");
  });

  it("ticks what is approved for this manifest", () => {
    show({ [PLUGIN]: { manifestHash: "hash-1", commandIds: ["reads"] } });
    expect(check("reads")).toBeChecked();
    expect(check("changes")).not.toBeChecked();
    expect(screen.queryByText(CHANGED)).not.toBeInTheDocument();
  });

  it("says a plugin changed, with nothing ticked", () => {
    show({ [PLUGIN]: { manifestHash: "old", commandIds: ["reads"] } });
    expect(screen.getByText(CHANGED)).toBeInTheDocument();
    expect(check("reads")).not.toBeChecked();
  });

  it("does not take the built-in agent's approvals", () => {
    mocks.list.mockReturnValue(loaded([plugin({ approved_ai_commands: ["reads", "changes"] })]));
    show();
    expect(check("reads")).not.toBeChecked();
  });

  it("saves what is ticked under the manifest's hash", async () => {
    show();
    await userEvent.click(check("reads"));
    await userEvent.click(check("changes"));
    expect(stored()).toEqual({});
    await save();
    expect(stored()).toEqual({
      [PLUGIN]: { manifestHash: "hash-1", commandIds: ["reads", "changes"] },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("takes the approval away when nothing is ticked", async () => {
    show({ [PLUGIN]: { manifestHash: "hash-1", commandIds: ["reads"] } });
    await userEvent.click(check("reads"));
    await save();
    expect(stored()).toEqual({});
  });

  it("takes away an old approval saved with nothing chosen again", async () => {
    show({ [PLUGIN]: { manifestHash: "old", commandIds: ["reads"] } });
    await save();
    expect(stored()).toEqual({});
  });

  it("drops an approved command that is no longer there", async () => {
    show({ [PLUGIN]: { manifestHash: "hash-1", commandIds: ["reads", "gone", "hidden"] } });
    await save();
    expect(stored()).toEqual({ [PLUGIN]: { manifestHash: "hash-1", commandIds: ["reads"] } });
  });

  it("drops what was ticked if the plugin changes while the dialog is open", async () => {
    const { rerender } = show();
    await userEvent.click(check("reads"));
    expect(check("reads")).toBeChecked();
    mocks.list.mockReturnValue(loaded([plugin({ manifest_hash: "hash-2" })]));
    const agent = useConnectedAgentsStore.getState().agents[0];
    rerender(<AgentPluginsDialog agent={agent} onClose={onClose} />);
    expect(check("reads")).not.toBeChecked();
    await save();
    expect(stored()).toEqual({});
  });

  it("keeps an approval for a plugin that is turned off", async () => {
    const kept = { manifestHash: "hash-1", commandIds: ["reads"] };
    mocks.list.mockReturnValue(loaded([plugin({ enabled: false })]));
    show({ [PLUGIN]: kept });
    await save();
    expect(stored()).toEqual({ [PLUGIN]: kept });
  });

  it("changes nothing on Cancel", async () => {
    show();
    await userEvent.click(check("reads"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stored()).toEqual({});
    expect(onClose).toHaveBeenCalled();
  });

  it("says when no plugin offers anything", () => {
    mocks.list.mockReturnValue(loaded([]));
    show();
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it("shows loading, and cannot save yet", () => {
    mocks.list.mockReturnValue({ isPending: true, isError: false, isSuccess: false });
    show();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says when the list cannot be loaded, and cannot save", () => {
    mocks.list.mockReturnValue({ isPending: false, isError: true, isSuccess: false });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your plugins");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
