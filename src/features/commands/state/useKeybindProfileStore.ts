import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  BUILT_IN_PROFILES,
  BUILT_IN_PROFILE_IDS,
  DEFAULT_BINDINGS,
  DEFAULT_PROFILE_ID,
  type BuiltInProfileId,
} from "../profiles/builtInProfiles";
import {
  mergeOverDefaults,
  sameBindings,
  validateKeybindProfile,
  type KeybindProfile,
  type ProfileBinding,
} from "../profiles/keybindProfile";

interface KeybindProfileState {
  /** The profile of this device as chosen or imported. */
  profile: KeybindProfile;
  /** Whether the profile stands alone instead of over the app's defaults. */
  replacesDefaults: boolean;
  /** Make `profile` the active one, over the app's defaults unless `replacesDefaults`. */
  setProfile: (profile: KeybindProfile, replacesDefaults?: boolean) => void;
  /** Switch to one of the built-in profiles. */
  selectBuiltIn: (id: BuiltInProfileId) => void;
  /** Turn the Vim layer on or off in the active profile. */
  setVimMode: (on: boolean) => void;
}

/**
 * A profile stored under persist version 1. A built-in profile, recognised by its name and
 * bindings that are all still its own, becomes the current built-in so it gets the defaults
 * added since; any other profile keeps its keys by replacing the defaults.
 */
function migrateFromVersion1(persisted: unknown): {
  profile: unknown;
  replacesDefaults: boolean;
} {
  const stored = (persisted as { profile?: unknown } | undefined)?.profile;
  const checked = stored === undefined ? null : validateKeybindProfile(stored);
  if (checked?.ok) {
    const { profile } = checked;
    const key = (binding: ProfileBinding) =>
      `${binding.context} ${binding.keystroke} ${binding.commandId ?? ""}`;
    const builtIn = BUILT_IN_PROFILE_IDS.map((id) => BUILT_IN_PROFILES[id]).find((candidate) => {
      if (candidate.name !== profile.name) return false;
      const current = new Set(candidate.bindings.map(key));
      return profile.bindings.every((binding) => current.has(key(binding)));
    });
    if (builtIn) {
      return { profile: { ...builtIn, vimMode: profile.vimMode }, replacesDefaults: false };
    }
  }
  return { profile: stored, replacesDefaults: true };
}

export const useKeybindProfileStore = create<KeybindProfileState>()(
  persist(
    (set) => ({
      profile: BUILT_IN_PROFILES[DEFAULT_PROFILE_ID],
      replacesDefaults: false,
      setProfile: (profile, replacesDefaults = false) => set({ profile, replacesDefaults }),
      selectBuiltIn: (id) => set({ profile: BUILT_IN_PROFILES[id], replacesDefaults: false }),
      setVimMode: (on) => set((state) => ({ profile: { ...state.profile, vimMode: on } })),
    }),
    {
      name: "rim-keybind-profile",
      version: 2,
      partialize: (state) => ({
        profile: state.profile,
        replacesDefaults: state.replacesDefaults,
      }),
      migrate: (persisted, version) =>
        (version === 1 ? migrateFromVersion1(persisted) : persisted) as KeybindProfileState,
      // A stored profile that no longer validates falls back to the default one.
      merge: (persisted, current) => {
        const stored = persisted as { profile?: unknown; replacesDefaults?: unknown } | undefined;
        const checked =
          stored?.profile === undefined ? null : validateKeybindProfile(stored.profile);
        return checked?.ok
          ? {
              ...current,
              profile: checked.profile,
              replacesDefaults: stored?.replacesDefaults === true,
            }
          : current;
      },
    },
  ),
);

/** The profile in force: the stored one over the app's defaults, or alone when it replaces them. */
export function activeProfile(
  state: Pick<KeybindProfileState, "profile" | "replacesDefaults">,
): KeybindProfile {
  return state.replacesDefaults
    ? state.profile
    : mergeOverDefaults(DEFAULT_BINDINGS, state.profile);
}

/** {@link activeProfile} of the store, memoized for rendering. */
export function useActiveKeybindProfile(): KeybindProfile {
  const profile = useKeybindProfileStore((s) => s.profile);
  const replacesDefaults = useKeybindProfileStore((s) => s.replacesDefaults);
  return useMemo(() => activeProfile({ profile, replacesDefaults }), [profile, replacesDefaults]);
}

/** Whether the Vim layer is on, read outside React. */
export function vimModeEnabled(): boolean {
  return useKeybindProfileStore.getState().profile.vimMode;
}

/** The built-in profile `profile` matches, or `null` for an imported or changed one. */
export function matchingBuiltIn(profile: KeybindProfile): BuiltInProfileId | null {
  return BUILT_IN_PROFILE_IDS.find((id) => sameBindings(profile, BUILT_IN_PROFILES[id])) ?? null;
}
