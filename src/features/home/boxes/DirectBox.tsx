import { ChevronRight } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import type { ConversationSummary } from "../../conversations/types";
import { notificationConversationLabel } from "../../notifications/labels";
import { useDirectInbox } from "../../relay/api/useDirectInbox";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import type { DirectSettings } from "./settings";

const ROW_CLASS =
  "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-rim-text transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";

/** One direct conversation: its name and unread count, opening it. */
function DirectRow({ conversation }: { conversation: ConversationSummary }) {
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(conversation.serverId);
  const unread = useUnreadStore((s) => s.counts[conversation.id] ?? 0);
  const name = showInvisibleCharacters(
    notificationConversationLabel(
      conversation,
      (id) => memberLookup.resolve(id).displayName,
      currentUserId,
    ),
  );
  return (
    <li>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => {
          selectDirectConversation(conversation.serverId, conversation.id);
          useShellStore.getState().setMainSurface({ kind: "conversation" });
        }}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {unread > 0 && <span className="shrink-0 text-xs text-rim-warm">{unread} unread</span>}
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-rim-text-faint" />
      </button>
    </li>
  );
}

/**
 * The latest direct conversations, as the direct messages list holds them, with their unread
 * counts. A row opens its conversation; showing it marks nothing read.
 */
export function DirectBoxBody({ settings }: { settings: DirectSettings }) {
  const { items, isPending, isError } = useDirectInbox();
  if (isPending) return <p className="text-sm text-rim-text-muted">Loading…</p>;
  if (isError)
    return <p className="text-sm text-rim-text-muted">Couldn&apos;t load your direct messages.</p>;
  const shown = items.slice(0, settings.count);
  if (shown.length === 0)
    return <p className="text-sm text-rim-text-muted">No direct messages yet.</p>;
  return (
    <ul className="-mx-2 space-y-0.5" aria-label="Latest direct messages">
      {shown.map((conversation) => (
        <DirectRow
          key={`${conversation.serverId}:${conversation.id}`}
          conversation={conversation}
        />
      ))}
    </ul>
  );
}
