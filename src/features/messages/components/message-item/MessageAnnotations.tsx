import { memo } from "react";
import { MessageSquare } from "lucide-react";

import { cn } from "../../../../shared/ui/cn";
import { LinkPreviewCard } from "../LinkPreviewCard";
import type { LinkPreview } from "../LinkPreviewCard";
import type { MessageTagType } from "../../../incidents/api/useIncident";
import type { IncidentTagInfo } from "./types";

const INCIDENT_TAG_STYLES: Record<MessageTagType, { badge: string; label: string }> = {
  DECISION: { badge: "bg-[#a855f7]/15 text-[#a855f7]", label: "Decision" },
  ACTION_ITEM: { badge: "bg-rim-accent/15 text-rim-accent", label: "Action Item" },
  ROOT_CAUSE: { badge: "bg-rim-danger/15 text-rim-danger", label: "Root Cause" },
  TIMELINE_EVENT: { badge: "bg-rim-text-faint/15 text-rim-text-faint", label: "Timeline Event" },
};

export const MessageIncidentTags = memo(function MessageIncidentTags({
  tags,
}: {
  tags?: IncidentTagInfo[];
}) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map((tag) => {
        const style = INCIDENT_TAG_STYLES[tag.tagType];
        return (
          <span
            key={tag.tagType}
            className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", style.badge)}
          >
            {style.label}
          </span>
        );
      })}
    </div>
  );
});

export const MessageLinkPreviews = memo(function MessageLinkPreviews({
  previews,
}: {
  previews?: LinkPreview[];
}) {
  if (!previews || previews.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {previews.map((preview) => (
        <LinkPreviewCard key={preview.id} preview={preview} />
      ))}
    </div>
  );
});

/** Hover action that starts a thread on a message that has none yet. */
export const MessageThreadButton = memo(function MessageThreadButton({
  messageId,
  onOpenThread,
}: {
  messageId: string;
  onOpenThread: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenThread(messageId)}
      className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-accent group-hover:opacity-100"
      title="Open thread"
      aria-label="Open thread"
    >
      <MessageSquare className="h-4 w-4" />
    </button>
  );
});
