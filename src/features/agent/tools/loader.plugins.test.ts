import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn(() => Promise.resolve({ commands: [] })) },
}));

vi.mock("./getCurrentContext", () => ({
  registerGetCurrentContextTool: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../../plugins/api/usePluginList", () => ({
  fetchPluginList: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import { fetchPluginList } from "../../plugins/api/usePluginList";
import type { PluginCommandInfo, PluginInfo } from "../../plugins/types";
import { loadAgentTools, pluginToolName } from "./loader";
import { getAllTools, getTool, unregisterTool } from "./registry";

const FILTER: PluginCommandInfo = {
  id: "filter",
  qualified_id: "plugin.chat.rim.k8s-pods.filter",
  title: "Pods: Filter",
  description: "Chooses the namespace.",
  keybind_capable: true,
  dangerous: false,
  ai_callable: true,
  arguments: [
    { name: "namespace", type: "string", required: false, description: "Namespace to list." },
    { name: "interval_seconds", type: "integer", required: false },
  ],
};

const RESTART: PluginCommandInfo = {
  id: "restart_pod",
  qualified_id: "plugin.chat.rim.k8s-pods.restart_pod",
  title: "Pods: Restart pod",
  description: "Deletes a pod so its controller starts a fresh one.",
  keybind_capable: false,
  dangerous: true,
  ai_callable: true,
  arguments: [{ name: "pod", type: "string", required: true, description: "Pod to restart." }],
};

function k8sPods(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "chat.rim.k8s-pods",
    manifest_id: "chat.rim.k8s-pods",
    display_name: "Kubernetes Pods",
    version: "0.1.0",
    description: "",
    enabled: true,
    capabilities: ["ui.panel"],
    approved_capabilities: ["ui.panel"],
    approved_ai_commands: ["filter", "restart_pod"],
    ai_callable_commands: ["filter", "restart_pod"],
    ai_consent_required: false,
    fingerprint_changed: false,
    commands: [FILTER, RESTART],
    ...overrides,
  };
}

const FILTER_TOOL = "plugin__chat_rim_k8s-pods__filter";
const RESTART_TOOL = "plugin__chat_rim_k8s-pods__restart_pod";

describe("plugin commands as agent tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const tool of getAllTools()) unregisterTool(tool.definition.name);
  });

  it("names tools the way model APIs accept", () => {
    expect(pluginToolName("chat.rim.k8s-pods", "filter")).toBe(FILTER_TOOL);
    expect(pluginToolName(`com.example.${"x".repeat(60)}`, "go")).toBeNull();
  });

  it("offers each consented command with its arguments as the input schema", async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([k8sPods()]);
    await loadAgentTools();

    const filter = getTool(FILTER_TOOL)!.definition;
    expect(filter.description).toContain("Pods: Filter (Kubernetes Pods plugin)");
    expect(filter.input_schema).toEqual({
      type: "object",
      properties: {
        namespace: { type: "string", description: "Namespace to list." },
        interval_seconds: { type: "integer" },
      },
      required: [],
      additionalProperties: false,
    });
    const restart = getTool(RESTART_TOOL)!.definition;
    expect(restart.input_schema).toMatchObject({ required: ["pod"] });
    expect(restart.description).toContain("you cannot run it");
  });

  it("leaves out commands the user did not consent to", async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([k8sPods({ approved_ai_commands: ["filter"] })]);
    await loadAgentTools();
    expect(getTool(FILTER_TOOL)).toBeDefined();
    expect(getTool(RESTART_TOOL)).toBeUndefined();
  });

  it("runs a safe command through the host as the agent", async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([k8sPods()]);
    vi.mocked(invoke).mockResolvedValue({ namespace: "shop", totalPods: 3 });
    await loadAgentTools();

    const out = await getTool(FILTER_TOOL)!.handler({ namespace: "shop" });
    expect(invoke).toHaveBeenCalledWith("plugin_run_ai_command", {
      pluginId: "chat.rim.k8s-pods",
      commandId: "filter",
      input: { namespace: "shop" },
    });
    expect(JSON.parse(out)).toEqual({ namespace: "shop", totalPods: 3 });
  });

  it("turns the host's refusal of a dangerous command into a proposal for the user", async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([k8sPods()]);
    vi.mocked(invoke).mockRejectedValue({
      kind: "CONFIRMATION_REQUIRED",
      message: "command `restart_pod` is marked dangerous and needs confirmation",
    });
    await loadAgentTools();

    const out = JSON.parse(await getTool(RESTART_TOOL)!.handler({ pod: "web-1" }));
    expect(out).toMatchObject({ status: "not_run", reason: "needs_user_confirmation" });
    expect(out.message).toContain("only the user can run it");
  });

  it("reports any other failure as an error", async () => {
    vi.mocked(fetchPluginList).mockResolvedValue([k8sPods()]);
    vi.mocked(invoke).mockRejectedValue({ kind: "PLUGIN_NOT_RUNNING", message: "not running" });
    await loadAgentTools();
    await expect(getTool(FILTER_TOOL)!.handler({})).rejects.toThrow(
      "Plugin command chat.rim.k8s-pods/filter failed: not running",
    );
  });
});
