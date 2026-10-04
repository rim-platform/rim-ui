import { useCallback } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../../shared/ui/cn";
import { useTagMessage } from "../api/useIncident";
import { useIncidentStore } from "../state/useIncidentStore";
import { toast } from "../../../shared/toast";
import type { MessageTagType } from "../api/useIncident";
import { MessageTagTypeGql } from "../../../core/graphql/generated/schema-types";
import { Z } from "../../../shared/ui/zIndex";

const TAG_OPTIONS: { type: MessageTagType; label: string; dot: string }[] = [
  { type: MessageTagTypeGql.DECISION, label: "Decision", dot: "bg-[#a855f7]" },
  { type: MessageTagTypeGql.ACTION_ITEM, label: "Action Item", dot: "bg-rim-accent" },
  { type: MessageTagTypeGql.ROOT_CAUSE, label: "Root Cause", dot: "bg-rim-danger" },
  { type: MessageTagTypeGql.TIMELINE_EVENT, label: "Timeline Event", dot: "bg-rim-text-faint" },
];

interface TagMessageMenuProps {
  messageId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function TagMessageMenu({ messageId, position, onClose }: TagMessageMenuProps) {
  const incident = useIncidentStore((s) => s.activeIncident);
  const tagMessage = useTagMessage();

  const handleTag = useCallback(
    (tagType: MessageTagType) => {
      if (!incident) return;
      tagMessage.mutate(
        {
          incidentId: incident.id,
          messageId,
          phase: incident.currentPhase,
          tagType,
        },
        {
          onSuccess: () => {
            toast.success(`Tagged as ${tagType.toLowerCase().replace("_", " ")}`);
            onClose();
          },
          onError: () => {
            toast.error("Failed to tag message");
          },
        },
      );
    },
    [incident, messageId, tagMessage, onClose],
  );

  if (!incident) return null;

  return createPortal(
    <div
      className="fixed min-w-[160px] rounded-lg border border-rim-line bg-rim-panel py-1 shadow-xl"
      style={{ top: position.y, left: position.x, zIndex: Z.DROPDOWN }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-rim-text-faint">
        Tag for Incident
      </div>
      {TAG_OPTIONS.map((opt) => (
        <button
          key={opt.type}
          type="button"
          onClick={() => handleTag(opt.type)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-rim-text transition",
            "hover:bg-white/5",
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", opt.dot)} />
          {opt.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
