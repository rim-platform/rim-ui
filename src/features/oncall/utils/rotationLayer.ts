import { RotationKindGql } from "../../../core/graphql/generated/schema-types";
import type { RotationLayer } from "../api/useOnCallSchedules";

/** Draft (not-yet-submitted) shape of a rotation layer, edited locally before the
 * `addRotationLayer`/`setRotationParticipants` mutation pair (new layer) or
 * `updateRotationLayer`/`setRotationParticipants` pair (existing layer) fires. */
export interface DraftRotationLayer {
  /** Present only for a layer loaded from an existing schedule — distinguishes "update
   * this layer" from "create a new one" at save time (see `ScheduleEditor`). */
  id?: string;
  name: string;
  priority: number;
  kind: RotationKindGql;
  handoffTime: string;
  handoffWeekday: number;
  intervalSeconds: number;
  anchorAt: string;
  /** Ordered — `participantIds[0]` is first in the rotation. */
  participantIds: string[];
}

/** `"YYYY-MM-DDTHH:mm"` for a `datetime-local` input, from a full ISO timestamp. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Builds a draft from an existing schedule's `RotationLayerGql` (from
 * `OnCallScheduleGql.rotationLayers`), so `ScheduleEditor` can load it for editing. */
export function layerFromExisting(layer: RotationLayer): DraftRotationLayer {
  return {
    id: layer.id,
    name: layer.name,
    priority: layer.priority,
    kind: layer.kind,
    handoffTime: layer.handoffTime ?? "09:00:00",
    handoffWeekday: layer.handoffWeekday ?? 0,
    intervalSeconds: layer.intervalSeconds ?? 86400,
    anchorAt: toDatetimeLocal(layer.anchorAt),
    participantIds: [...layer.participants],
  };
}

export function makeEmptyDraftLayer(priority: number): DraftRotationLayer {
  return {
    name: "",
    priority,
    kind: RotationKindGql.WEEKLY,
    handoffTime: "09:00:00",
    handoffWeekday: 0,
    intervalSeconds: 86400,
    anchorAt: new Date().toISOString().slice(0, 16),
    participantIds: [],
  };
}
