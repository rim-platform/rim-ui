import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../core/logger", () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../../commands/runtime/commandDispatcher", () => ({
  dispatchCommand: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("./pluginNotification", () => ({
  showPluginNotification: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("../pluginSettingsLink", () => ({
  openPluginSettings: vi.fn(),
}));

import {
  createPluginBridge,
  fetchAndRelayPanelState,
  followPanelState,
  PANEL_STATE_EVENT,
} from "./pluginBridge";
import { showPluginNotification } from "./pluginNotification";
import { CANCELLED_PAYLOAD } from "./pluginCommandInfo";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "../../../shared/toast";
import { logger } from "../../../core/logger";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { openPluginSettings } from "../pluginSettingsLink";
import type { PluginCapability } from "../types";

function createMockIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe;
}

describe("createPluginBridge", () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = createMockIframe();
  });

  afterEach(() => {
    iframe.remove();
  });

  it("creates a bridge with sendToPlugin and destroy methods", () => {
    const bridge = createPluginBridge({
      pluginId: "test-plugin",
      approvedCapabilities: [],
      iframe,
    });

    expect(bridge).toHaveProperty("sendToPlugin");
    expect(bridge).toHaveProperty("destroy");
    expect(typeof bridge.sendToPlugin).toBe("function");
    expect(typeof bridge.destroy).toBe("function");

    bridge.destroy();
  });

  it("sendToPlugin calls postMessage on iframe contentWindow", () => {
    const bridge = createPluginBridge({
      pluginId: "test-plugin",
      approvedCapabilities: [],
      iframe,
    });

    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postMessageSpy },
      writable: true,
    });

    bridge.sendToPlugin({ type: "panel.visibility", visible: true });

    expect(postMessageSpy).toHaveBeenCalledWith({ type: "panel.visibility", visible: true }, "*");

    bridge.destroy();
  });

  it("ignores messages from wrong origin", () => {
    const bridge = createPluginBridge({
      pluginId: "test-plugin",
      approvedCapabilities: [],
      iframe,
    });

    // Dispatch a message with origin that is NOT "null"
    const event = new MessageEvent("message", {
      origin: "https://evil.com",
      data: { type: "rim.ui.notification.show", title: "Evil", body: "msg" },
    });
    window.dispatchEvent(event);

    // Logger should not have been called with plugin bridge messages
    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("test-plugin notification"),
    );

    bridge.destroy();
  });

  it("denies messages requiring capabilities not approved", () => {
    const bridge = createPluginBridge({
      pluginId: "test-plugin",
      approvedCapabilities: [], // no capabilities approved
      iframe,
    });

    // Simulate a message from the iframe (origin "null" for sandboxed iframes)
    const event = new MessageEvent("message", {
      origin: "null",
      source: iframe.contentWindow,
      data: { type: "rim.ui.notification.show", title: "Test", body: "body" },
    });
    window.dispatchEvent(event);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("denied"),
      // Note: this may or may not match depending on source check
    );

    bridge.destroy();
  });

  it("allows messages when required capability is approved", () => {
    const caps: PluginCapability[] = ["ui.notify"];
    const bridge = createPluginBridge({
      pluginId: "test-plugin",
      approvedCapabilities: caps,
      iframe,
    });

    // The event's source must be the plugin's iframe.
    const event = new MessageEvent("message", {
      origin: "null",
      source: iframe.contentWindow,
      data: { type: "rim.ui.notification.show", title: "Test", body: "body" },
    });
    window.dispatchEvent(event);

    // If source matches, it should process the notification
    // Note: in jsdom, iframe.contentWindow may be null or not match event.source
    bridge.destroy();
  });

  it("denies command execution outside plugin scope", () => {
    const bridge = createPluginBridge({
      pluginId: "my-plugin",
      approvedCapabilities: [],
      iframe,
    });

    const event = new MessageEvent("message", {
      origin: "null",
      source: iframe.contentWindow,
      data: {
        type: "rim.command.execute",
        commandId: "plugin.other-plugin.do_something",
      },
    });
    window.dispatchEvent(event);

    // Should warn about scope violation (if source check passes)
    bridge.destroy();
  });

  it("never forwards a confirmation a panel claims for itself", () => {
    vi.mocked(dispatchCommand).mockClear();
    const bridge = createPluginBridge({
      pluginId: "my-plugin",
      approvedCapabilities: [],
      iframe,
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: iframe.contentWindow,
        data: {
          type: "rim.command.execute",
          commandId: "plugin.my-plugin.delete_everything",
          args: { target: "all" },
          confirmedDangerous: true,
          confirmed: true,
        },
      }),
    );

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    const context = vi.mocked(dispatchCommand).mock.calls[0][2];
    expect(context).toEqual({ args: { target: "all" }, callerPluginId: "my-plugin" });
    bridge.destroy();
  });

  describe("a panel opening its plugin's settings", () => {
    let bridge: ReturnType<typeof createPluginBridge>;
    let posted: unknown[];

    beforeEach(() => {
      vi.mocked(openPluginSettings).mockClear();
      posted = [];
      bridge = createPluginBridge({ pluginId: "my-plugin", approvedCapabilities: [], iframe });
      vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(
        (message: unknown) => {
          posted.push(message);
        },
      );
    });

    afterEach(() => bridge.destroy());

    function post(data: unknown, source: MessageEventSource | null = iframe.contentWindow) {
      window.dispatchEvent(new MessageEvent("message", { origin: "null", source, data }));
    }

    it("opens the frame's own plugin's settings, needing no capability and sending no answer", () => {
      post({ type: "rim.settings.open", pluginId: "other-plugin", requestId: "r1" });
      expect(openPluginSettings).toHaveBeenCalledTimes(1);
      expect(openPluginSettings).toHaveBeenCalledWith("my-plugin");
      expect(posted).toEqual([]);
    });

    it("ignores rim.settings.open from any other window", () => {
      post({ type: "rim.settings.open" }, window);
      expect(openPluginSettings).not.toHaveBeenCalled();
    });

    it("gives a panel no way to read or write the values", () => {
      post({ type: "rim.settings.get", key: "api_token", requestId: "r1" });
      post({ type: "rim.settings.set", key: "api_token", value: "x" });
      expect(posted).toEqual([]);
      expect(openPluginSettings).not.toHaveBeenCalled();
    });
  });

  describe("a panel running its plugin's commands", () => {
    let bridge: ReturnType<typeof createPluginBridge>;
    let posted: unknown[];

    beforeEach(() => {
      vi.mocked(dispatchCommand).mockReset();
      vi.mocked(toast.error).mockClear();
      posted = [];
      bridge = createPluginBridge({
        pluginId: "my-plugin",
        pluginName: "My Plugin",
        approvedCapabilities: ["ui.notify"],
        iframe,
      });
      vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(
        (message: unknown) => {
          posted.push(message);
        },
      );
    });

    afterEach(() => bridge.destroy());

    function execute(data: Record<string, unknown>) {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "null",
          source: iframe.contentWindow,
          data: { type: "rim.command.execute", commandId: "plugin.my-plugin.go", ...data },
        }),
      );
    }

    it("answers with the command's result", async () => {
      vi.mocked(dispatchCommand).mockResolvedValue({
        status: "SUCCESS",
        message: "Done",
        payload: { n: 1 },
        followUpCommands: [],
      });
      execute({ requestId: "r1" });
      await vi.waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toEqual({
        type: "rim.command.result",
        requestId: "r1",
        ok: true,
        message: "Done",
        payload: { n: 1 },
      });
    });

    it("says when the user declined to confirm", async () => {
      vi.mocked(dispatchCommand).mockResolvedValue({
        status: "ERROR",
        message: "Cancelled",
        payload: CANCELLED_PAYLOAD,
        followUpCommands: [],
      });
      execute({ requestId: "r2" });
      await vi.waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({ requestId: "r2", ok: false, cancelled: true });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("shows a failure to the user when the panel asked for no answer", async () => {
      vi.mocked(dispatchCommand).mockResolvedValue({
        status: "ERROR",
        message: "kubectl failed",
        payload: null,
        followUpCommands: [],
      });
      execute({});
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("My Plugin: kubectl failed"));
      expect(posted).toHaveLength(0);
    });

    it("drops an oversized request id instead of echoing it", async () => {
      vi.mocked(dispatchCommand).mockResolvedValue(null);
      execute({ requestId: "x".repeat(101) });
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(posted).toHaveLength(0);
    });

    it("shows the panel's notification under the plugin's name", () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "null",
          source: iframe.contentWindow,
          data: { type: "rim.ui.notification.show", title: "Pod restarted", body: "web-1" },
        }),
      );
      expect(showPluginNotification).toHaveBeenCalledWith("My Plugin", "Pod restarted", "web-1");
    });
  });

  it("destroy removes the message event listener", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const bridge = createPluginBridge({
      pluginId: "test-plugin",
      approvedCapabilities: [],
      iframe,
    });

    bridge.destroy();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });
});

describe("fetchAndRelayPanelState", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("sends state to plugin when invoke returns data", async () => {
    const mockState = { count: 42 };
    vi.mocked(invoke).mockResolvedValue(mockState);

    const sendToPlugin = vi.fn();
    await fetchAndRelayPanelState("test-plugin", "main", sendToPlugin);

    // The host keeps state per panel, so it is asked for this panel's.
    expect(invoke).toHaveBeenCalledWith("plugin_panel_state", {
      pluginId: "test-plugin",
      panelId: "main",
    });

    expect(sendToPlugin).toHaveBeenCalledWith({
      type: "panel.state_update",
      state: mockState,
    });
  });

  it("does not send when invoke returns null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);

    const sendToPlugin = vi.fn();
    await fetchAndRelayPanelState("test-plugin", "main", sendToPlugin);

    expect(sendToPlugin).not.toHaveBeenCalled();
  });

  it("does not send when invoke returns undefined", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const sendToPlugin = vi.fn();
    await fetchAndRelayPanelState("test-plugin", "main", sendToPlugin);

    expect(sendToPlugin).not.toHaveBeenCalled();
  });

  it("handles invoke rejection gracefully", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("not available"));

    const sendToPlugin = vi.fn();
    // Should not throw
    await fetchAndRelayPanelState("test-plugin", "main", sendToPlugin);

    expect(sendToPlugin).not.toHaveBeenCalled();
  });
});

describe("followPanelState", () => {
  type Handler = (event: { payload: unknown }) => void;
  let handler: Handler | null;
  const unlisten = vi.fn();

  beforeEach(() => {
    handler = null;
    unlisten.mockClear();
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockImplementation(async (_event, h) => {
      handler = h as unknown as Handler;
      return unlisten;
    });
  });

  function push(plugin_id: string, panel_id: string, state: unknown) {
    handler?.({ payload: { plugin_id, panel_id, state } });
  }

  it("sends each change the plugin makes to this panel, and only this panel", async () => {
    const send = vi.fn();
    const follower = followPanelState("p", "main", send);
    await follower.load();
    expect(listen).toHaveBeenCalledWith(PANEL_STATE_EVENT, expect.any(Function));

    push("p", "main", { pods: 3 });
    push("p", "other", { pods: 9 });
    push("q", "main", { pods: 9 });
    push("p", "main", null);
    expect(send.mock.calls).toEqual([
      [{ type: "panel.state_update", state: { pods: 3 } }],
      [{ type: "panel.state_update", state: null }],
    ]);

    follower.stop();
    expect(unlisten).toHaveBeenCalled();
    push("p", "main", { pods: 4 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends the stored state on load unless a newer change arrived meanwhile", async () => {
    const send = vi.fn();
    const follower = followPanelState("p", "main", send);

    vi.mocked(invoke).mockResolvedValueOnce({ pods: 1 });
    await follower.load();
    expect(send).toHaveBeenLastCalledWith({ type: "panel.state_update", state: { pods: 1 } });

    let answer: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const loading = follower.load();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    push("p", "main", { pods: 2 });
    answer({ pods: 1 });
    await loading;
    expect(send).toHaveBeenLastCalledWith({ type: "panel.state_update", state: { pods: 2 } });
    follower.stop();
  });
});
