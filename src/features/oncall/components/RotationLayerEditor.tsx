import { useCallback } from "react";
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";

import { Avatar } from "../../../shared/ui/Avatar";
import { cn } from "../../../shared/ui/cn";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { RotationKindGql } from "../../../core/graphql/generated/schema-types";
import type { DraftRotationLayer } from "../utils/rotationLayer";

const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface RotationLayerEditorProps {
  serverId: string;
  layer: DraftRotationLayer;
  onChange: (layer: DraftRotationLayer) => void;
  onRemove: () => void;
}

/**
 * Editor for one rotation layer's fields plus its ordered participant list.
 *
 * The participant list is keyboard-first: each row is focusable, `j`/`k` move the
 * focused participant down/up, and visible up/down buttons give the same reorder for
 * mouse/screen-reader users (same idiom as `MacroSettings`' step reorder).
 */
export function RotationLayerEditor({
  serverId,
  layer,
  onChange,
  onRemove,
}: RotationLayerEditorProps) {
  const { data: members } = useServerMembers(serverId);

  const memberName = useCallback(
    (userId: string) => {
      const m = members?.find((mm) => mm.userId === userId);
      return m?.displayName || m?.username || userId.slice(0, 8);
    },
    [members],
  );

  const availableMembers = (members ?? []).filter((m) => !layer.participantIds.includes(m.userId));

  const moveParticipant = useCallback(
    (index: number, direction: "up" | "down") => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= layer.participantIds.length) return;
      const next = [...layer.participantIds];
      [next[index], next[target]] = [next[target], next[index]];
      onChange({ ...layer, participantIds: next });
    },
    [layer, onChange],
  );

  const removeParticipant = useCallback(
    (index: number) => {
      onChange({
        ...layer,
        participantIds: layer.participantIds.filter((_, i) => i !== index),
      });
    },
    [layer, onChange],
  );

  const addParticipant = useCallback(
    (userId: string) => {
      if (!userId || layer.participantIds.includes(userId)) return;
      onChange({ ...layer, participantIds: [...layer.participantIds, userId] });
    },
    [layer, onChange],
  );

  const handleRowKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === "j") {
        e.preventDefault();
        moveParticipant(index, "down");
      } else if (e.key === "k") {
        e.preventDefault();
        moveParticipant(index, "up");
      }
    },
    [moveParticipant],
  );

  return (
    <div className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-3">
      <div className="flex items-center justify-between">
        <input
          type="text"
          value={layer.name}
          onChange={(e) => onChange({ ...layer, name: e.target.value })}
          placeholder="Layer name (e.g. Primary)"
          aria-label="Layer name"
          className="flex-1 rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove layer"
          className="ml-2 rounded p-1 text-rim-text-faint transition hover:text-rim-danger"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-rim-text-muted">Rotation kind</label>
          <select
            value={layer.kind}
            aria-label="Rotation kind"
            onChange={(e) => onChange({ ...layer, kind: e.target.value as RotationKindGql })}
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
          >
            <option value={RotationKindGql.DAILY}>Daily</option>
            <option value={RotationKindGql.WEEKLY}>Weekly</option>
            <option value={RotationKindGql.CUSTOM}>Custom</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-rim-text-muted">Priority</label>
          <input
            type="number"
            aria-label="Priority"
            value={layer.priority}
            onChange={(e) => onChange({ ...layer, priority: Number(e.target.value) })}
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
          />
        </div>

        {(layer.kind === RotationKindGql.DAILY || layer.kind === RotationKindGql.WEEKLY) && (
          <div>
            <label className="mb-1 block text-[11px] text-rim-text-muted">Handoff time</label>
            <input
              type="time"
              step={1}
              aria-label="Handoff time"
              value={layer.handoffTime}
              onChange={(e) =>
                onChange({ ...layer, handoffTime: `${e.target.value}:00`.slice(0, 8) })
              }
              className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
            />
          </div>
        )}

        {layer.kind === RotationKindGql.WEEKLY && (
          <div>
            <label className="mb-1 block text-[11px] text-rim-text-muted">Handoff day</label>
            <select
              value={layer.handoffWeekday}
              aria-label="Handoff day"
              onChange={(e) => onChange({ ...layer, handoffWeekday: Number(e.target.value) })}
              className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        {layer.kind === RotationKindGql.CUSTOM && (
          <div>
            <label className="mb-1 block text-[11px] text-rim-text-muted">Interval (seconds)</label>
            <input
              type="number"
              min={1}
              aria-label="Interval (seconds)"
              value={layer.intervalSeconds}
              onChange={(e) => onChange({ ...layer, intervalSeconds: Number(e.target.value) })}
              className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
            />
          </div>
        )}

        <div className="col-span-2">
          <label className="mb-1 block text-[11px] text-rim-text-muted">Anchor start</label>
          <input
            type="datetime-local"
            aria-label="Anchor start"
            value={layer.anchorAt}
            onChange={(e) => onChange({ ...layer, anchorAt: e.target.value })}
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
          />
        </div>
      </div>

      <div>
        <label
          className="mb-1 block text-[11px] text-rim-text-muted"
          id="rotation-participants-label"
        >
          Participants (rotation order)
        </label>
        <ul role="list" aria-labelledby="rotation-participants-label" className="space-y-1">
          {layer.participantIds.map((userId, index) => (
            <li
              key={userId}
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => handleRowKeyDown(index, e)}
              className="flex items-center gap-2 rounded border border-rim-line bg-rim-void px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-rim-accent"
            >
              <span className="w-4 text-right text-[11px] text-rim-text-faint">{index + 1}.</span>
              <Avatar name={memberName(userId)} userId={userId} size="xs" />
              <span className="flex-1 truncate text-sm text-rim-text">{memberName(userId)}</span>
              <button
                type="button"
                onClick={() => moveParticipant(index, "up")}
                disabled={index === 0}
                aria-label={`Move ${memberName(userId)} up`}
                className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveParticipant(index, "down")}
                disabled={index === layer.participantIds.length - 1}
                aria-label={`Move ${memberName(userId)} down`}
                className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => removeParticipant(index)}
                aria-label={`Remove ${memberName(userId)}`}
                className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>

        {availableMembers.length > 0 && (
          <div
            className={cn(
              "mt-2 flex items-center gap-2",
              layer.participantIds.length === 0 && "mt-1",
            )}
          >
            <select
              defaultValue=""
              onChange={(e) => {
                addParticipant(e.target.value);
                e.target.value = "";
              }}
              aria-label="Add participant"
              className="flex-1 rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              <option value="" disabled>
                Add participant…
              </option>
              {availableMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName || m.username}
                </option>
              ))}
            </select>
            <Plus className="h-3.5 w-3.5 text-rim-text-faint" />
          </div>
        )}
      </div>
    </div>
  );
}
