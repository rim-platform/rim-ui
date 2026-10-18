// A local-process plugin's panel: the desktop host reads its panel folder, the
// files go to the frame shell, and the panel follows its plugin process's state.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { invoke, runtime, followPanelState, follower } = vi.hoisted(() => {
  const follower = { load: vi.fn(() => Promise.resolve()), stop: vi.fn() };
  return {
    invoke: vi.fn(),
    runtime: { platform: "desktop", capabilities: { pluginHost: true } },
    followPanelState: vi.fn(() => follower),
    follower,
  };
});

vi.mock("../../../core/tauri/safeInvoke", () => ({ safeInvoke: invoke }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../runtime/pluginBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/pluginBridge")>()),
  followPanelState,
}));

import { encodeBase64 } from "../web/bundle";
import { LOCAL_PANEL_SHELL_URL, PluginPanel } from "./PluginPanel";
import { fromFrame, mountedFrame, sentInits, spyOnFrame, startShell } from "./testing/frame";

const encoder = new TextEncoder();

function filesOnDisk(files: Record<string, string>) {
  invoke.mockResolvedValue({
    ok: true,
    value: Object.entries(files).map(([path, text]) => ({
      path,
      base64: encodeBase64(encoder.encode(text)),
    })),
  });
}

/** The panel mounted, its frame loaded, the host's posts into it spied. */
async function loadedPanel() {
  const { container } = render(
    <PluginPanel
      pluginId="chat.rim.k8s-pods"
      panelId="pods"
      pluginName="Kubernetes pods"
      approvedCapabilities={[]}
      onClose={vi.fn()}
    />,
  );
  const iframe = await mountedFrame(container);
  if (!iframe) return { container, iframe: null, posted: null };
  const posted = spyOnFrame(iframe);
  startShell(iframe);
  return { container, iframe, posted };
}

beforeEach(() => {
  invoke.mockReset();
  followPanelState.mockClear();
  follower.load.mockClear();
  runtime.capabilities.pluginHost = true;
});

describe("PluginPanel", () => {
  it("hands the panel folder's files, decoded, to the network-closed shell with no origin", async () => {
    filesOnDisk({ "index.html": '<script src="app.js"></script>', "app.js": "start()" });
    const { iframe, posted } = await loadedPanel();

    expect(iframe?.getAttribute("src")).toBe(LOCAL_PANEL_SHELL_URL);

    expect(invoke).toHaveBeenCalledWith("plugin_panel_files", {
      pluginId: "chat.rim.k8s-pods",
      panelId: "pods",
    });
    const [init] = sentInits(posted!);
    expect(init.policy).toEqual({ origins: [] });
    expect(init.files).toEqual([
      { path: "index.html", type: "text/html", text: '<script src="app.js"></script>' },
      { path: "app.js", type: "text/javascript", text: "start()" },
    ]);
  });

  it("follows the state its plugin process keeps for this panel", async () => {
    filesOnDisk({ "index.html": "" });
    const { iframe } = await loadedPanel();
    fromFrame(iframe!, { type: "rim.frame.ready", v: 1 });

    expect(followPanelState).toHaveBeenCalledWith(
      "chat.rim.k8s-pods",
      "pods",
      expect.any(Function),
    );
    expect(follower.load).toHaveBeenCalledTimes(1);
  });

  it("says why the host could not read the panel's files", async () => {
    invoke.mockResolvedValue({
      ok: false,
      error: { kind: "backend_error", message: "chat.rim.k8s-pods declares no panel pods" },
    });
    const { iframe } = await loadedPanel();
    expect(iframe).toBeNull();
    expect(screen.getByText("chat.rim.k8s-pods declares no panel pods")).toBeInTheDocument();
  });

  it("needs the desktop app", async () => {
    runtime.capabilities.pluginHost = false;
    const { iframe } = await loadedPanel();
    expect(iframe).toBeNull();
    expect(screen.getByText("Plugins require the desktop app.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
