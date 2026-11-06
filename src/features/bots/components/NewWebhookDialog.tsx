import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { WebhookPreset, type Bot } from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import type { ConversationSummary } from "../../conversations/types";
import { createIncomingWebhook, useInvalidateBots } from "../api/botsApi";
import { webhookUrl } from "../webhookUrl";
import { channelBlockedReason } from "../channelAccess";

interface NewWebhookDialogProps {
  serverId: string;
  /** Channels that may get a webhook: no active one, not encrypted. */
  channels: ConversationSummary[];
  /** Active bots. */
  bots: Bot[];
  /** Called with the new URL, shown once; the caller shows it and holds it in its state. */
  onCreated: (created: { url: string; preset: WebhookPreset }) => void;
  onClose: () => void;
}

const FIELD_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** Asks for a channel, a bot and a preset, and makes the incoming webhook that joins them. */
export function NewWebhookDialog({
  serverId,
  channels,
  bots,
  onCreated,
  onClose,
}: NewWebhookDialogProps) {
  const [conversationId, setConversationId] = useState("");
  const [botUserId, setBotUserId] = useState(bots[0]?.userId ?? "");
  const [preset, setPreset] = useState<WebhookPreset>(WebhookPreset.PLAIN);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const invalidate = useInvalidateBots(serverId);

  const channel = channels.find((c) => c.id === conversationId);
  const blocked = channel ? channelBlockedReason(channel) : null;
  const ready = Boolean(conversationId && botUserId) && !blocked;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    setError(null);
    setPending(true);
    try {
      const created = await createIncomingWebhook({ conversationId, botUserId, preset });
      invalidate(botUserId);
      onCreated({ url: await webhookUrl(created.token), preset });
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not make the webhook"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title="New incoming webhook" onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <label className="block">
          <span className={LABEL_CLASS}>Channel</span>
          <select
            value={conversationId}
            onChange={(e) => setConversationId(e.currentTarget.value)}
            className={FIELD_CLASS}
          >
            <option value="">Choose a channel</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id} disabled={Boolean(channelBlockedReason(c))}>
                {c.title ?? "Untitled"}
                {c.isPrivate ? " (private)" : ""}
              </option>
            ))}
          </select>
        </label>
        {channels.some((c) => channelBlockedReason(c)) && (
          <p className="-mt-2 text-xs text-rim-text-muted">
            A private channel you are not in cannot be chosen: you cannot post where you cannot
            read.
          </p>
        )}
        <label className="block">
          <span className={LABEL_CLASS}>Bot</span>
          <select
            value={botUserId}
            onChange={(e) => setBotUserId(e.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {bots.map((b) => (
              <option key={b.userId} value={b.userId}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Preset</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.currentTarget.value as WebhookPreset)}
            className={FIELD_CLASS}
          >
            <option value={WebhookPreset.PLAIN}>Plain</option>
            <option value={WebhookPreset.GITHUB}>GitHub</option>
          </select>
        </label>
        <p className="text-xs text-rim-text-muted">
          The bot is added to the channel if it is not in it. Anyone with the URL can post to that
          channel as the bot.
        </p>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!ready} isLoading={pending}>
            Create webhook
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
