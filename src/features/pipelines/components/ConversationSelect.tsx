import { ChevronDown } from "lucide-react";

import { useChannels } from "../../conversations/api/useChannels";
import { conversationLabel } from "../../conversations/utils";

/**
 * Picks a channel of the workspace by name; keeps a saved id that is not in the list.
 *
 * @param serverId - The workspace whose channels are offered.
 * @param value - The chosen conversation's id, or `""` for none.
 * @param onChange - Told the newly chosen id, `""` for none.
 * @param emptyLabel - The option for no conversation.
 * @param ariaLabel - The select's accessible name.
 */
export function ConversationSelect({
  serverId,
  value,
  onChange,
  emptyLabel,
  ariaLabel,
}: {
  serverId: string;
  value: string;
  onChange: (id: string) => void;
  emptyLabel: string;
  ariaLabel: string;
}) {
  const { data } = useChannels(serverId);
  const channels = [...(data?.items ?? [])].sort((a, b) =>
    (a.title ?? "").localeCompare(b.title ?? ""),
  );
  const unknown = value !== "" && !channels.some((c) => c.id === value);

  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 pr-8 text-sm text-rim-text outline-none focus:border-rim-accent"
      >
        <option value="">{emptyLabel}</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {conversationLabel(c)}
          </option>
        ))}
        {unknown && <option value={value}>A conversation you cannot see</option>}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-rim-text-muted" />
    </div>
  );
}
