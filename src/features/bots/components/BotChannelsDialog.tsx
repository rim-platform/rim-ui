import { useMemo, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { Bot } from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import {
  useAddConversationMembersMutation,
  useRemoveConversationMemberMutation,
} from "../../conversations/api/useChannelMembership";
import type { ConversationSummary } from "../../conversations/types";
import { useAllChannels } from "../api/useAllChannels";
import { ChannelsCutNotice } from "./ChannelsCutNotice";

interface BotChannelsDialogProps {
  serverId: string;
  bot: Bot;
  onClose: () => void;
}

/**
 * The workspace's channels as checkboxes, ticked where the bot is. Encrypted channels are left
 * out, since a bot never joins one. Save adds and removes the bot, one channel at a time, and
 * names the channels that failed.
 */
export function BotChannelsDialog({ serverId, bot, onClose }: BotChannelsDialogProps) {
  const channels = useAllChannels(serverId);
  const add = useAddConversationMembersMutation();
  const remove = useRemoveConversationMemberMutation();
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [failures, setFailures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () =>
      (channels.data?.items ?? [])
        .filter((c) => !c.encryptedAt)
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    [channels.data],
  );
  const isIn = (c: ConversationSummary) => changes[c.id] ?? c.memberIds.includes(bot.userId);
  const pending = rows.filter((c) => isIn(c) !== c.memberIds.includes(bot.userId));

  async function save() {
    setSaving(true);
    const failed: string[] = [];
    for (const channel of pending) {
      const vars = { serverId, conversationId: channel.id };
      try {
        if (isIn(channel)) await add.mutateAsync({ ...vars, userIds: [bot.userId] });
        else await remove.mutateAsync({ ...vars, userId: bot.userId });
      } catch (err) {
        failed.push(`${channel.title ?? "A channel"}: ${graphqlErrorMessage(err, "failed")}`);
      }
    }
    setSaving(false);
    setFailures(failed);
    if (failed.length === 0) onClose();
    else setChanges({});
  }

  return (
    <Dialog open title={`Channels of ${bot.name}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-rim-text-muted">
          A bot reads and posts only in the channels it is in. Adding it to a private channel lets
          it read that channel.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending.length === 0}
            isLoading={saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
        {channels.isPending && <p className="text-sm text-rim-text-muted">Loading channels...</p>}
        {channels.isError && (
          <div className="space-y-2">
            <p className="text-sm text-rim-danger">
              {graphqlErrorMessage(channels.error, "Could not load the channels")}
            </p>
            <Button size="sm" variant="secondary" onClick={() => void channels.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {channels.data && rows.length === 0 && (
          <p className="text-sm text-rim-text-muted">No channels.</p>
        )}
        {channels.data?.truncated && <ChannelsCutNotice />}
        {failures.length > 0 && (
          <div role="alert" className="space-y-1 text-sm text-rim-danger">
            <p>Some changes were not saved:</p>
            <ul className="list-disc pl-5">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {rows.length > 0 && (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label="Channels">
            {rows.map((channel) => (
              <li key={channel.id} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
                <label className="flex items-center gap-2 text-sm text-rim-text">
                  <input
                    type="checkbox"
                    checked={isIn(channel)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setChanges((c) => ({ ...c, [channel.id]: checked }));
                    }}
                  />
                  <span className="min-w-0 truncate">{channel.title ?? "Untitled"}</span>
                  {channel.isPrivate && (
                    <span className="shrink-0 rounded border border-rim-line px-1 text-[10px] uppercase tracking-wider text-rim-text-muted">
                      Private
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
