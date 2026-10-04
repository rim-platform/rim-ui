import { useCallback, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { toast } from "../../../shared/toast";
import {
  useCreateOnCallSchedule,
  useUpdateOnCallSchedule,
  useAddRotationLayer,
  useUpdateRotationLayer,
  useRemoveRotationLayer,
  useSetRotationParticipants,
  type OnCallSchedule,
} from "../api/useOnCallSchedules";
import { RotationLayerEditor } from "./RotationLayerEditor";
import {
  makeEmptyDraftLayer,
  layerFromExisting,
  type DraftRotationLayer,
} from "../utils/rotationLayer";

const MAX_LAYERS = 5;

interface ScheduleEditorProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  /** When set, edits this schedule — name/timezone plus its existing rotation layers
   * (loaded from `OnCallScheduleGql.rotationLayers`). */
  existing?: OnCallSchedule;
}

function initialLayers(existing: OnCallSchedule | undefined): DraftRotationLayer[] {
  if (!existing) return [makeEmptyDraftLayer(0)];
  return existing.rotationLayers.map(layerFromExisting);
}

/**
 * Create/edit an on-call schedule (Owner/Moderator only — the caller must gate the
 * entry point on `canManageOnCall`; the backend re-enforces regardless).
 *
 * **New schedule:** orchestrates the mutation sequence explicitly — `createOnCallSchedule`
 * first (for its id), then per layer `addRotationLayer` + `setRotationParticipants(layerId,
 * [userId] ordered)`.
 *
 * **Existing schedule:** name/timezone are editable via `updateOnCallSchedule`, and its
 * rotation layers (loaded from the nested `rotationLayers` field) are editable too — saving
 * diffs the local draft list against what was loaded: layers with an `id` get
 * `updateRotationLayer` + `setRotationParticipants`, layers without one get the
 * create-flow (`addRotationLayer` + `setRotationParticipants`), and any originally-loaded
 * layer no longer present in the draft list gets `removeRotationLayer`. There is no atomic
 * "replace all layers" mutation, so this is a set of granular calls, same shape as create.
 *
 * **A layer with zero participants BLOCKS save** (inline validation error, no mutations
 * fired) rather than being silently skipped — a schedule/policy driving a paging system
 * must never let its UI diverge from server state. Emptying a layer's participants to
 * "disable" it would otherwise close the modal successfully while the server keeps paging
 * whoever was last saved; removing the layer entirely is the actual way to disable it.
 */
export function ScheduleEditor({ open, onClose, serverId, existing }: ScheduleEditorProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [timezone, setTimezone] = useState(
    existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [layers, setLayers] = useState<DraftRotationLayer[]>(() => initialLayers(existing));
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const createSchedule = useCreateOnCallSchedule();
  const updateSchedule = useUpdateOnCallSchedule();
  const addLayer = useAddRotationLayer();
  const updateLayer = useUpdateRotationLayer();
  const removeLayer = useRemoveRotationLayer();
  const setParticipants = useSetRotationParticipants();

  const addDraftLayer = useCallback(() => {
    setValidationError(null);
    setLayers((prev) =>
      prev.length >= MAX_LAYERS ? prev : [...prev, makeEmptyDraftLayer(prev.length)],
    );
  }, []);

  const updateDraftLayer = useCallback((index: number, layer: DraftRotationLayer) => {
    setValidationError(null);
    setLayers((prev) => prev.map((l, i) => (i === index ? layer : l)));
  }, []);

  const removeDraftLayer = useCallback((index: number) => {
    setValidationError(null);
    setLayers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    setName(existing?.name ?? "");
    setTimezone(existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setLayers(initialLayers(existing));
    setValidationError(null);
  }, [existing]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    // A layer with zero participants must block the whole save, not just be skipped —
    // silently skipping it would close the modal "successfully" while the server keeps
    // paging whoever was last saved for that layer. See the component doc comment.
    if (layers.some((l) => l.participantIds.length === 0)) {
      setValidationError(
        "A rotation layer needs at least one participant. Remove the layer to disable it.",
      );
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      const scheduleId = existing
        ? (
            await updateSchedule.mutateAsync({
              serverId,
              scheduleId: existing.id,
              name: name.trim(),
              timezone,
            })
          ).id
        : (await createSchedule.mutateAsync({ serverId, name: name.trim(), timezone })).id;

      // Layers no longer present in the draft list were removed by the user in this session.
      const originalIds = existing?.rotationLayers.map((l) => l.id) ?? [];
      const keptIds = new Set(layers.map((l) => l.id).filter((id): id is string => Boolean(id)));
      for (const removedId of originalIds.filter((id) => !keptIds.has(id))) {
        await removeLayer.mutateAsync({ serverId, layerId: removedId });
      }

      for (const layer of layers) {
        const kind = {
          kind: layer.kind,
          handoffTime: layer.handoffTime,
          handoffWeekday: layer.handoffWeekday,
          intervalSeconds: layer.intervalSeconds,
        };
        const layerId = layer.id
          ? (
              await updateLayer.mutateAsync({
                serverId,
                layerId: layer.id,
                name: layer.name.trim() || "Layer",
                priority: layer.priority,
                kind,
                anchorAt: new Date(layer.anchorAt).toISOString(),
              })
            ).id
          : (
              await addLayer.mutateAsync({
                serverId,
                scheduleId,
                name: layer.name.trim() || "Layer",
                priority: layer.priority,
                kind,
                anchorAt: new Date(layer.anchorAt).toISOString(),
              })
            ).id;
        await setParticipants.mutateAsync({
          serverId,
          layerId,
          userIds: layer.participantIds,
        });
      }

      toast.success(existing ? "Schedule updated" : "Schedule created");
      handleClose();
    } catch {
      toast.error(existing ? "Failed to update schedule" : "Failed to create schedule");
    } finally {
      setSaving(false);
    }
  }, [
    name,
    timezone,
    layers,
    existing,
    serverId,
    createSchedule,
    updateSchedule,
    addLayer,
    updateLayer,
    removeLayer,
    setParticipants,
    handleClose,
  ]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={existing ? "Edit schedule" : "Create schedule"}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] text-rim-text-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Primary on-call"
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-rim-text-muted">Timezone (IANA)</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York"
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-rim-text-muted">
              Rotation layers ({layers.length}/{MAX_LAYERS})
            </label>
            <button
              type="button"
              onClick={addDraftLayer}
              disabled={layers.length >= MAX_LAYERS}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" /> Add layer
            </button>
          </div>
          {layers.map((layer, index) => (
            <RotationLayerEditor
              key={layer.id ?? `new-${index}`}
              serverId={serverId}
              layer={layer}
              onChange={(l) => updateDraftLayer(index, l)}
              onRemove={() => removeDraftLayer(index)}
            />
          ))}
        </div>

        {validationError && (
          <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
            {validationError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            isLoading={saving}
          >
            {existing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
