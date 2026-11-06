import { describe, expect, it } from "vitest";

import { runningPluginPanels } from "./pluginPanels";
import type { PluginInfo } from "./types";

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "chat.rim.k8s-pods",
    manifest_id: "chat.rim.k8s-pods",
    display_name: "Kubernetes Pods",
    version: "1.0.0",
    description: "",
    enabled: true,
    health: "running",
    capabilities: ["ui.panel"],
    approved_capabilities: ["ui.panel"],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    panels: [{ id: "pods", title: "Pods" }],
    ...overrides,
  };
}

describe("runningPluginPanels", () => {
  it("shows the marks hidden in a plugin's name and a panel's title", () => {
    const [shown] = runningPluginPanels([
      makePlugin({
        display_name: "Hello\u202eWorld",
        panels: [{ id: "main", title: "Pods\u202e", slot: "tool_panel" }],
      }),
    ]);
    expect(shown.pluginName).toContain("U+202E");
    expect(shown.pluginName).not.toContain("\u202e");
    expect(shown.panel.title).toContain("U+202E");
  });

  it("lists the panels of enabled, running plugins granted ui.panel", () => {
    const plugins = [
      makePlugin(),
      makePlugin({ plugin_id: "dev.example.off", enabled: false }),
      makePlugin({ plugin_id: "dev.example.stopped", health: "stopped" }),
    ];
    expect(runningPluginPanels(plugins)).toEqual([
      {
        pluginId: "chat.rim.k8s-pods",
        pluginName: "Kubernetes Pods",
        panel: { id: "pods", title: "Pods" },
      },
    ]);
  });

  it("leaves out a running plugin without the ui.panel grant", () => {
    expect(runningPluginPanels([makePlugin({ approved_capabilities: [] })])).toEqual([]);
    expect(runningPluginPanels([makePlugin({ approved_capabilities: ["ui.notify"] })])).toEqual([]);
  });
});
