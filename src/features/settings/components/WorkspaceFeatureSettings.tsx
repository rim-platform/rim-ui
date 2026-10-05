import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { WorkspaceFeature } from "../../../core/graphql/generated/schema-types";
import {
  useSetWorkspaceFeature,
  useWorkspaceFeatures,
} from "../../workspaces/api/useWorkspaceFeatures";
import { WORKSPACE_FEATURE_COPY } from "../../workspaces/featureCatalog";
import { ToggleSwitch } from "./ToggleSwitch";

interface WorkspaceFeatureSettingsProps {
  serverId: string | null;
}

/**
 * Settings → Workspace: turn optional workspace modules on or off (Track 0.4).
 *
 * The tab is only offered to the workspace Owner (see `SettingsPage`); the server enforces
 * the same rule and answers `FORBIDDEN` to anyone else, and that message is shown here.
 * Turning a module off asks for confirmation first; turning it on applies immediately.
 */
export function WorkspaceFeatureSettings({ serverId }: WorkspaceFeatureSettingsProps) {
  const { data: features, isPending, isError, error } = useWorkspaceFeatures(serverId);
  const setFeature = useSetWorkspaceFeature();
  const [confirmOff, setConfirmOff] = useState<WorkspaceFeature | null>(null);

  function apply(feature: WorkspaceFeature, enabled: boolean) {
    if (!serverId) return;
    setFeature.mutate({ serverId, feature, enabled }, { onSettled: () => setConfirmOff(null) });
  }

  function handleToggle(feature: WorkspaceFeature, next: boolean) {
    if (next) {
      apply(feature, true);
    } else {
      setConfirmOff(feature);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Workspace</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Optional modules for this workspace. Changes apply to every member.
        </p>
      </div>

      {serverId && isPending && (
        <p className="text-sm text-rim-text-muted">Loading workspace features…</p>
      )}
      {isError && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {graphqlErrorMessage(error, "Failed to load workspace features.")}
        </p>
      )}

      {features && features.length > 0 && (
        <ul className="space-y-2">
          {features.map((state) => {
            const copy = WORKSPACE_FEATURE_COPY[state.feature];
            return (
              <li
                key={state.feature}
                className="flex items-center justify-between gap-4 rounded-lg border border-rim-line bg-rim-panel p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-rim-text">{copy.title}</p>
                  <p className="mt-0.5 text-xs text-rim-text-muted">{copy.description}</p>
                </div>
                <ToggleSwitch
                  checked={state.enabled}
                  onChange={(next) => handleToggle(state.feature, next)}
                  label={copy.title}
                  disabled={setFeature.isPending}
                />
              </li>
            );
          })}
        </ul>
      )}

      {setFeature.isError && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {graphqlErrorMessage(setFeature.error, "Failed to update the workspace feature.")}
        </p>
      )}

      {confirmOff && (
        <Dialog
          open
          title={`Turn off ${WORKSPACE_FEATURE_COPY[confirmOff].title.toLowerCase()}?`}
          onClose={() => setConfirmOff(null)}
        >
          <p className="text-sm text-rim-text-muted">
            The module disappears for every member of this workspace and its commands stop working.
            Nothing is deleted — turning it back on restores everything.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOff(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={setFeature.isPending}
              onClick={() => apply(confirmOff, false)}
            >
              Turn off
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
