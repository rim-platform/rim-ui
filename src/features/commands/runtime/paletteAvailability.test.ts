import { beforeEach, describe, expect, it } from "vitest";

import { useShellStore } from "../../../shell/state/useShellStore";
import { offeredInSituation, type PaletteSituation } from "./paletteAvailability";
import { releasePaletteFocus } from "./paletteFocus";
import { navigatePanel } from "../../../shell/navigation/spatialNavigation";

const NORMAL: PaletteSituation = {
  inDirectSpace: false,
  panelOpen: true,
  hasDirectOrigin: true,
  unreadsOpen: false,
};

describe("offeredInSituation", () => {
  it("offers the Unreads page's commands only on that page, and the way there everywhere", () => {
    for (const id of [
      "workspace.unreads_next",
      "workspace.unreads_previous",
      "workspace.unreads_mark_group",
      "workspace.unreads_open",
      "workspace.unreads_undo",
    ]) {
      expect(offeredInSituation(id, NORMAL), id).toBe(false);
      expect(offeredInSituation(id, { ...NORMAL, unreadsOpen: true }), id).toBe(true);
    }
    expect(offeredInSituation("workspace.open_unreads", NORMAL)).toBe(true);
  });

  it("hides the four commands the direct space refuses", () => {
    const direct = { ...NORMAL, inDirectSpace: true };
    for (const id of [
      "chat.list_channels",
      "state.list",
      "chat.join_channel",
      "workspace.navigate_to_channel",
    ]) {
      expect(offeredInSituation(id, direct), id).toBe(false);
      expect(offeredInSituation(id, NORMAL), id).toBe(true);
    }
    expect(offeredInSituation("workspace.navigate_to_dm", direct)).toBe(true);
  });

  it("hides Close Panel when no panel is open", () => {
    expect(offeredInSituation("workspace.close_panel", { ...NORMAL, panelOpen: false })).toBe(
      false,
    );
    expect(offeredInSituation("workspace.close_panel", NORMAL)).toBe(true);
  });

  it("hides Back to Workspace without an origin", () => {
    const none = { ...NORMAL, hasDirectOrigin: false };
    expect(offeredInSituation("workspace.back_to_workspace", none)).toBe(false);
    expect(offeredInSituation("workspace.back_to_workspace", NORMAL)).toBe(true);
  });
});

describe("releasePaletteFocus", () => {
  beforeEach(() => useShellStore.getState().reset());

  it("clears the palette's own focus", () => {
    useShellStore.setState({ focusedSurface: "commandPalette" });
    releasePaletteFocus();
    expect(useShellStore.getState().focusedSurface).toBeNull();
  });

  it("keeps the focus a command moved to while the palette closed", () => {
    useShellStore.setState({ focusedSurface: "mainSurface" });
    navigatePanel("left");
    releasePaletteFocus();
    expect(useShellStore.getState().focusedSurface).toBe("toolPanel");
  });
});
