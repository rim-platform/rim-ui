import type { DirectDraft } from "../../../shell/state/useShellStore";
import { Avatar } from "../../../shared/ui/Avatar";
import { useDraftPeer } from "../hooks/useDraftPeer";

/** The side rail's row for the open draft direct message, shown as the selected item. */
export function DraftDirectItem({ draft }: { draft: DirectDraft }) {
  const peer = useDraftPeer(draft);
  const label = `New message to ${peer.name}`;
  return (
    <li role="option" aria-selected data-testid="draft-direct-item">
      <button
        type="button"
        onClick={() =>
          document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus()
        }
        className="flex w-full items-center gap-2 rounded-lg bg-rim-accent/10 px-2 py-2 text-left text-sm text-rim-accent transition focus-visible:outline-none"
      >
        <Avatar
          url={peer.avatarUrl}
          name={peer.name || "?"}
          userId={peer.avatarKey}
          size="xs"
          presenceStatus={peer.presence}
        />
        <span className="block min-w-0 flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}
