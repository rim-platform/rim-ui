import { useFlagRevealStore } from "../../state/useFlagRevealStore";

interface FlaggedCoverProps {
  messageId: string;
  /** Whether the viewer is the workspace's Owner or a Moderator: offers Clear flag. */
  canModerate: boolean;
  onClearFlag?: (messageId: string) => void;
  /** The message's text and its attachments and link previews. */
  children: React.ReactNode;
}

const ACTION = "text-xs font-medium text-rim-accent hover:underline";

/**
 * Covers a message the server's automatic check flagged: a note with Show anyway in place of
 * `children`, or, once the viewer shows it, a label with Hide above them. Owners and Moderators
 * also get Clear flag.
 */
export function FlaggedCover({ messageId, canModerate, onClearFlag, children }: FlaggedCoverProps) {
  const revealed = useFlagRevealStore((s) => s.revealed.has(messageId));
  const toggleRevealed = useFlagRevealStore((s) => s.toggleRevealed);

  const clearButton =
    canModerate && onClearFlag ? (
      <button type="button" className={ACTION} onClick={() => onClearFlag(messageId)}>
        Clear flag
      </button>
    ) : null;

  if (!revealed) {
    return (
      <div
        data-flagged-cover=""
        className="rounded-md border border-rim-line bg-rim-panel-soft px-3 py-2 text-xs text-rim-text-muted"
      >
        <p>Hidden: the automatic check flagged this message.</p>
        <div className="mt-1 flex gap-3">
          <button type="button" className={ACTION} onClick={() => toggleRevealed(messageId)}>
            Show anyway
          </button>
          {clearButton}
        </div>
      </div>
    );
  }

  return (
    <div data-flagged-cover="">
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-rim-text-faint">Flagged by the automatic check</span>
        <button type="button" className={ACTION} onClick={() => toggleRevealed(messageId)}>
          Hide
        </button>
        {clearButton}
      </div>
      {children}
    </div>
  );
}
