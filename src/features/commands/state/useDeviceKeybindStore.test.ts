import { beforeEach, describe, expect, it } from "vitest";

import { matchKeybind } from "../runtime/keybindEngine";
import {
  bindsOnDevice,
  isDeviceKeybind,
  useDeviceKeybindStore,
  withDeviceKeybinds,
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

  it("binds only plugin commands on the device", () => {
    expect(bindsOnDevice(REFRESH)).toBe(true);
    expect(bindsOnDevice("workspace.open_plugin_panel.chat.rim.k8s-pods/pods")).toBe(true);
    expect(bindsOnDevice("workspace.open_plugin_settings.chat.rim.k8s-pods")).toBe(true);
    expect(bindsOnDevice("workspace.open_settings")).toBe(false);
  });

  it("lets a device binding win over a server binding of the same keystroke", () => {
    useDeviceKeybindStore
      .getState()
      .add({ keystroke: "Ctrl+K", commandId: REFRESH, context: "GLOBAL" });
    const all = withDeviceKeybinds(useDeviceKeybindStore.getState().keybinds, [serverPalette]);
    expect(matchKeybind("Ctrl+K", "GLOBAL", all)?.commandId).toBe(REFRESH);
    expect(withDeviceKeybinds([], [serverPalette])).toEqual([serverPalette]);
  });
});
