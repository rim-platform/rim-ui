// A web plugin's panel: the running plugin's verified panel files and origins go
// to the frame shell, and the panel follows the state the web host's relay keeps.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PanelStateChange } from "./webPanelRelay";
import type { WebPluginHealth } from "./webPluginHost";

const { host } = vi.hoisted(() => {
  const host = {
    health: "running" as WebPluginHealth,
    relayListeners: [] as ((change: PanelStateChange) => void)[],
    stored: null as unknown,
  };
  return { host };
});

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: "web", capabilities: { pluginHost: false } }),
}));

vi.mock("./webPluginHost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./webPluginHost")>()),
  webPluginHost: {
    subscribe: () => () => {},
    status: () => ({ health: host.health, error: host.health === "crashed" ? "boom" : null }),
    panelFiles: (_pluginId: string, panelId: string) =>
      panelId === "main" ? [textFile("index.html", "<p>web</p>")] : null,
    panelOrigins: () => ["https://api.github.com"],
    relay: {
      subscribe: (listener: (change: PanelStateChange) => void) => {
        host.relayListeners.push(listener);
        return () => host.relayListeners.splice(host.relayListeners.indexOf(listener), 1);
      },
      getState: () => host.stored,
    },
  },
}));

import { WEB_SHELL_URL } from "./webPluginHost";
import { WebPluginPanel } from "./WebPluginPanel";
import {
  fromFrame,
  mountedFrame,
  sentInits,
  sentMessages,
  spyOnFrame,
  startShell,
  textFile,
} from "../components/testing/frame";

function renderPanel() {
  return render(
    <WebPluginPanel
      pluginId="dev.example.web"
      panelId="main"
      pluginName="Web example"
      approvedCapabilities={[]}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  host.health = "running";
  host.relayListeners.length = 0;
  host.stored = null;
});

describe("WebPluginPanel", () => {
  it("hands the running plugin's panel files and origins to the frame shell", async () => {
    const { container } = renderPanel();
    const iframe = await mountedFrame(container);
    if (!iframe) throw new Error("no frame");
    expect(iframe.getAttribute("src")).toBe(WEB_SHELL_URL);
    const posted = spyOnFrame(iframe);
    startShell(iframe);

    const [init] = sentInits(posted);
    expect(init.policy).toEqual({ origins: ["https://api.github.com"] });
    expect(init.files).toEqual([{ path: "index.html", type: "text/html", text: "<p>web</p>" }]);
  });

  it("sends the relay's stored state once rendered, then this panel's changes only", async () => {
    host.stored = { count: 1 };
    const { container } = renderPanel();
    const iframe = await mountedFrame(container);
    if (!iframe) throw new Error("no frame");
    const posted = spyOnFrame(iframe);
    startShell(iframe);
    fromFrame(iframe, { type: "rim.frame.ready", v: 1 });
    await Promise.resolve();
    for (const listener of host.relayListeners) {
      listener({ pluginId: "dev.example.web", panelId: "other", state: { count: 9 } });
      listener({ pluginId: "dev.example.web", panelId: "main", state: { count: 2 } });
    }

    expect(sentMessages(posted)).toEqual([
      expect.objectContaining({ type: "theme.changed" }),
      { type: "panel.state_update", state: { count: 1 } },
      { type: "panel.state_update", state: { count: 2 } },
    ]);
  });

  it("says the plugin is not running, with its error", () => {
    host.health = "crashed";
    renderPanel();
    expect(screen.getByText("Web example is not running.")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
