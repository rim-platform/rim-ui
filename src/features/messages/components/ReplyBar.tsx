import { CornerUpLeft, X } from "lucide-react";

import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import type { ReplyTarget } from "../state/useReplyTargetStore";

/**
 * The message the composer replies to, above its input: the parent's author and first line,
 * and a button that cancels the reply.
 */
export function ReplyBar({
  workspaceId,
  target,
  onCancel,
}: {
  workspaceId: string;
  target: ReplyTarget;
  onCancel: () => void;
}) {
  const name = useMemberLookup(workspaceId).resolve(target.authorId).displayName;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-r-md border-l-[3px] border-rim-accent/45 bg-rim-panel-soft px-2 py-1 text-xs text-rim-text-muted">
      <CornerUpLeft className="h-3 w-3 shrink-0 text-rim-text-faint" aria-hidden />
      <span className="shrink-0">
        Replying to <strong className="font-medium text-rim-text">{name}</strong>
      </span>
      <span className="min-w-0 truncate">{target.excerpt}</span>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        title="Cancel reply"
        className="ml-auto rounded p-0.5 text-rim-text-faint hover:text-rim-text"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
