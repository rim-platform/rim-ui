import { beforeEach, describe, expect, it } from "vitest";

import { BUILT_IN_PROFILES, DEFAULT_BINDINGS } from "../profiles/builtInProfiles";
import { PROFILE_FORMAT, type KeybindProfile } from "../profiles/keybindProfile";
import { activeProfile, matchingBuiltIn, useKeybindProfileStore } from "./useKeybindProfileStore";

const STORAGE_KEY = "rim-keybind-profile";

const teamKeys: KeybindProfile = {
  format: PROFILE_FORMAT,
  version: 1,
  name: "Team keys",
  description: "",
  vimMode: false,
  bindings: [
    { keystroke: "Ctrl+K", commandId: "workspace.open_command_palette", context: "GLOBAL" },
    { keystroke: "Ctrl+J", commandId: "workspace.open_search", context: "GLOBAL" },
    { keystroke: "Ctrl+R", commandId: null, context: "GLOBAL" },
  ],
};

function keystrokesOf(profile: KeybindProfile): string[] {
  return profile.bindings
    .filter((binding) => binding.commandId !== null)
    .map((binding) => binding.keystroke);
}

/** Rehydrates the store from `state` stored under persist `version`. */
async function rehydrateFrom(state: unknown, version: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
  await useKeybindProfileStore.persist.rehydrate();
}

describe("useKeybindProfileStore", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useKeybindProfileStore.getState().selectBuiltIn("minimal");
  });

  it("merges an imported profile over the defaults unless it replaces them", () => {
    useKeybindProfileStore.getState().setProfile(teamKeys);
    const merged = activeProfile(useKeybindProfileStore.getState());
    expect(useKeybindProfileStore.getState().profile).toEqual(teamKeys);
    expect(keystrokesOf(merged)).toEqual(
      expect.arrayContaining(["?", "Ctrl+/", "Ctrl+L", "Ctrl+K", "Ctrl+J"]),
    );
    expect(keystrokesOf(merged)).not.toContain("Ctrl+R");

    useKeybindProfileStore.getState().setProfile(teamKeys, true);
    expect(useKeybindProfileStore.getState().replacesDefaults).toBe(true);
    expect(activeProfile(useKeybindProfileStore.getState())).toEqual(teamKeys);
  });

  it("brings defaults added later to a device on a built-in profile", async () => {
    const added = DEFAULT_BINDINGS.find((binding) => binding.keystroke === "Ctrl+L")!;
    const olderMinimal = {
      ...BUILT_IN_PROFILES.minimal,
      bindings: BUILT_IN_PROFILES.minimal.bindings.filter(
        (binding) => binding.keystroke !== "Ctrl+L",
      ),
    };
    expect(olderMinimal.bindings).toHaveLength(DEFAULT_BINDINGS.length - 1);

    await rehydrateFrom({ profile: { ...olderMinimal, vimMode: true } }, 1);

    const state = useKeybindProfileStore.getState();
    expect(state.replacesDefaults).toBe(false);
    expect(state.profile.vimMode).toBe(true);
    expect(activeProfile(state).bindings).toContainEqual(added);
    expect(matchingBuiltIn(activeProfile(state))).toBe("vim");
  });

  it("keeps a v1 imported profile as replacing the defaults", async () => {
    await rehydrateFrom({ profile: teamKeys }, 1);

    const state = useKeybindProfileStore.getState();
    expect(state.profile).toEqual(teamKeys);
    expect(state.replacesDefaults).toBe(true);
    expect(activeProfile(state)).toEqual(teamKeys);
  });

  it("keeps the merge choice across a reload", async () => {
    await rehydrateFrom({ profile: teamKeys, replacesDefaults: false }, 2);
    expect(useKeybindProfileStore.getState().replacesDefaults).toBe(false);

    await rehydrateFrom({ profile: teamKeys, replacesDefaults: true }, 2);
    expect(useKeybindProfileStore.getState().replacesDefaults).toBe(true);
  });

  it("selecting a built-in profile drops Replace all", () => {
    useKeybindProfileStore.getState().setProfile(teamKeys, true);
    useKeybindProfileStore.getState().selectBuiltIn("mouse-friendly");

    const state = useKeybindProfileStore.getState();
    expect(state.replacesDefaults).toBe(false);
    expect(state.profile).toEqual(BUILT_IN_PROFILES["mouse-friendly"]);
    expect(matchingBuiltIn(activeProfile(state))).toBe("mouse-friendly");
  });
});
