import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  BUILT_IN_PROFILES,
  BUILT_IN_PROFILE_IDS,
  DEFAULT_PROFILE_ID,
  type BuiltInProfileId,
} from "../profiles/builtInProfiles";
import {
  sameBindings,
  validateKeybindProfile,
  type KeybindProfile,
} from "../profiles/keybindProfile";

interface KeybindProfileState {
  /** The active profile of this device. */
  profile: KeybindProfile;
  /** Make `profile` the active one. */
  setProfile: (profile: KeybindProfile) => void;
  /** Switch to one of the built-in profiles. */
  selectBuiltIn: (id: BuiltInProfileId) => void;
  /** Turn the Vim layer on or off in the active profile. */
  setVimMode: (on: boolean) => void;
}

export const useKeybindProfileStore = create<KeybindProfileState>()(
  persist(
    (set) => ({
      profile: BUILT_IN_PROFILES[DEFAULT_PROFILE_ID],
      setProfile: (profile) => set({ profile }),
      selectBuiltIn: (id) => set({ profile: BUILT_IN_PROFILES[id] }),
      setVimMode: (on) => set((state) => ({ profile: { ...state.profile, vimMode: on } })),
    }),
    {
      name: "rim-keybind-profile",
      version: 1,
      partialize: (state) => ({ profile: state.profile }),
      // A stored profile that no longer validates falls back to the default one.
      merge: (persisted, current) => {
        const stored = (persisted as { profile?: unknown } | undefined)?.profile;
        const checked = stored === undefined ? null : validateKeybindProfile(stored);
        return checked?.ok ? { ...current, profile: checked.profile } : current;
      },
    },
  ),
);

/** Whether the Vim layer is on, read outside React. */
export function vimModeEnabled(): boolean {
  return useKeybindProfileStore.getState().profile.vimMode;
}

/** The built-in profile `profile` matches, or `null` for an imported or changed one. */
export function matchingBuiltIn(profile: KeybindProfile): BuiltInProfileId | null {
  return BUILT_IN_PROFILE_IDS.find((id) => sameBindings(profile, BUILT_IN_PROFILES[id])) ?? null;
}
