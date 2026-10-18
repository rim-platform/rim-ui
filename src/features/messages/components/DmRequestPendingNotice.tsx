/**
 * Messages of a pending DM request the other member's relay holds for them to read before they
 * decide: it holds three items, the invite first.
 */
export const HELD_MESSAGES = 2;

interface DmRequestPendingNoticeProps {
  /** The other member's name. */
  name: string;
  /** How many messages the viewer has sent in the conversation so far. */
  sent: number;
}

/**
 * Above the composer of a direct conversation the other member has not accepted yet: says the
 * DM went as a request, and once the held messages are used up, that the rest waits.
 */
export function DmRequestPendingNotice({ name, sent }: DmRequestPendingNoticeProps) {
  return (
    <div role="status" className="px-4 py-1 text-xs text-rim-text-muted">
      <p>Sent as a request; {name} has not accepted yet.</p>
      {sent >= HELD_MESSAGES && <p>The rest waits for {name}&apos;s acceptance.</p>}
    </div>
  );
}
