import { useCallback } from "react";

import type { WorkspaceFeature } from "../../../core/graphql/generated/schema-types";
import { useWorkspaceFeatures } from "../api/useWorkspaceFeatures";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { featureForCommandId } from "../featureCatalog";

export type FeatureStatus = "loading" | "enabled" | "disabled";

/**
 * Tri-state flag for the active workspace: `"loading"` while the flag is not known, so a
 * surface can tell "not known" apart from "off" (e.g. show nothing rather than a "turned
 * off" notice, and keep incident state). A failed features query also stays `"loading"` —
 * an outage must not read as the owner having turned the module off. No active workspace
 * reads as `"disabled"`.
 */
export function useFeatureStatus(feature: WorkspaceFeature): FeatureStatus {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data } = useWorkspaceFeatures(workspaceId);
  if (!workspaceId) return "disabled";
  if (!data) return "loading";
  return data.some((entry) => entry.feature === feature && entry.enabled) ? "enabled" : "disabled";
}

/**
 * Whether an optional module is on for the active workspace. `false` while loading and when
 * there is no active workspace, so gated UI never flashes in before the flag is known.
 *
 * Display gate only — the server enforces the flag on every gated call.
 */
export function useFeatureEnabled(feature: WorkspaceFeature): boolean {
  return useFeatureStatus(feature) === "enabled";
}

/**
 * Predicate for client-side command lists (keybind settings, pickers): `false` for a command
 * whose feature is off — or not known yet — in the active workspace.
 */
export function useIsCommandAvailable(): (commandId: string) => boolean {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data } = useWorkspaceFeatures(workspaceId);
  return useCallback(
    (commandId: string) => {
      const feature = featureForCommandId(commandId);
      if (!feature) return true;
      return Boolean(data?.some((entry) => entry.feature === feature && entry.enabled));
    },
    [data],
  );
}
