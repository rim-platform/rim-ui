import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { useRelayStore } from "../../relay/state/useRelayStore";
import type { SpaceRecord } from "../../relay/state/relayDb";
import { APP_COMMAND_KEYBINDS } from "../../updater/api/serverCapabilities";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  appCommandKeybindsOnServer,
  bindsOnDevice,
  isDeviceKeybind,
  useDeviceKeybindStore,
} from "./useDeviceKeybindStore";
import type { ResolvedKeybind } from "../types";

const REFRESH = "plugin.chat.rim.k8s-pods.refresh";

const serverPalette: ResolvedKeybind = {
  id: "kb-1",
  keystroke: "Ctrl+K",
  commandId: "workspace.open_command_palette",
  context: "GLOBAL",
  source: "DEFAULT",
  scope: "USER",
  isEnabled: true,
  presetArgs: null,
};

describe("useDeviceKeybindStore", () => {
  beforeEach(() => {
    useDeviceKeybindStore.setState({ keybinds: [] });
  });

  it("keeps plugin command bindings with device ids", () => {
    useDeviceKeybindStore
      .getState()
      .add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
    const [kb] = useDeviceKeybindStore.getState().keybinds;
    expect(isDeviceKeybind(kb.id)).toBe(true);
    expect(kb).toMatchObject({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, isEnabled: true });
    expect(isDeviceKeybind(serverPalette.id)).toBe(false);
  });

  it("replaces an older binding of the same keystroke and context", () => {
    const { add } = useDeviceKeybindStore.getState();
    add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
    add({ keystroke: "Ctrl+Alt+P", commandId: "plugin.x.y.z.go", context: "GLOBAL" });
    add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "COMPOSER" });
    expect(
      useDeviceKeybindStore.getState().keybinds.map((kb) => [kb.commandId, kb.context]),
    ).toEqual([
      ["plugin.x.y.z.go", "GLOBAL"],
      [REFRESH, "COMPOSER"],
    ]);
  });

  it("updates and removes a binding", () => {
    const store = useDeviceKeybindStore.getState();
    store.add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
    const id = useDeviceKeybindStore.getState().keybinds[0].id;
    store.update(id, { keystroke: "Ctrl+Alt+R", isEnabled: false });
    expect(useDeviceKeybindStore.getState().keybinds[0]).toMatchObject({
      keystroke: "Ctrl+Alt+R",
      isEnabled: false,
    });
    store.remove(id);
    expect(useDeviceKeybindStore.getState().keybinds).toEqual([]);
  });

  it("keeps one binding per keystroke and context when one is changed", () => {
    const store = useDeviceKeybindStore.getState();
    store.add({ keystroke: "Ctrl+Alt+P", commandId: REFRESH, context: "GLOBAL" });
    store.add({ keystroke: "Ctrl+Alt+R", commandId: "plugin.x.y.z.go", context: "GLOBAL" });
    const second = useDeviceKeybindStore.getState().keybinds[1].id;
    store.update(second, { keystroke: "Ctrl+Alt+P" });
    expect(useDeviceKeybindStore.getState().keybinds).toMatchObject([
      { id: second, keystroke: "Ctrl+Alt+P", commandId: "plugin.x.y.z.go" },
    ]);
  });

  it("binds plugin commands on the device and server commands on the server", () => {
    expect(bindsOnDevice(REFRESH)).toBe(true);
    expect(bindsOnDevice("workspace.open_plugin_panel.chat.rim.k8s-pods/pods")).toBe(true);
    expect(bindsOnDevice("workspace.open_plugin_settings.chat.rim.k8s-pods")).toBe(true);
    expect(bindsOnDevice("workspace.open_settings")).toBe(false);
  });

  it("binds app commands on the device unless the server keeps them", () => {
    expect(bindsOnDevice("workspace.toggle_zen_mode", false)).toBe(true);
    expect(bindsOnDevice("app.quit", false)).toBe(true);
    expect(bindsOnDevice("workspace.toggle_zen_mode", true)).toBe(false);
    expect(bindsOnDevice("app.quit", true)).toBe(false);
  });

  it("binds plugin commands on the device even where the server keeps app commands", () => {
    expect(bindsOnDevice(REFRESH, true)).toBe(true);
    expect(bindsOnDevice("workspace.open_plugin_panel.chat.rim.k8s-pods/pods", true)).toBe(true);
    expect(bindsOnDevice("workspace.open_plugin_settings.chat.rim.k8s-pods", true)).toBe(true);
  });
});

describe("appCommandKeybindsOnServer", () => {
  afterEach(() => {
    queryClient.clear();
    useWorkspaceStore.getState().clearWorkspaceId();
    useRelayStore.setState({ spaces: {} });
  });

  function serverLists(capabilities: string[]) {
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
  }

  it("is false while the server info is unknown or without the capability", () => {
    expect(appCommandKeybindsOnServer()).toBe(false);
    serverLists([]);
    expect(appCommandKeybindsOnServer()).toBe(false);
    expect(bindsOnDevice("workspace.toggle_zen_mode")).toBe(true);
  });

  it("is true where the connected server lists the capability and hosts the workspace", () => {
    serverLists([APP_COMMAND_KEYBINDS]);
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    expect(appCommandKeybindsOnServer()).toBe(true);
    expect(bindsOnDevice("workspace.toggle_zen_mode")).toBe(false);
    expect(bindsOnDevice(REFRESH)).toBe(true);
  });

  it("is false in a workspace another server hosts", () => {
    serverLists([APP_COMMAND_KEYBINDS]);
    useRelayStore.setState({
      spaces: { "ws-remote": { spaceId: "ws-remote", hostServerId: "srv-2" } as SpaceRecord },
    });
    useWorkspaceStore.getState().setWorkspaceId("ws-remote");
    expect(appCommandKeybindsOnServer()).toBe(false);
    expect(bindsOnDevice("workspace.toggle_zen_mode")).toBe(true);
  });
});
