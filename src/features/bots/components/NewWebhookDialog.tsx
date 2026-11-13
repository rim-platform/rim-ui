import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { WebhookPreset, type Bot } from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import type { ConversationSummary } from "../../conversations/types";
import { WEBHOOK_FORMATS } from "../../updater/api/serverCapabilities";
import { useSpaceHasCapability } from "../../updater/hooks/useSpaceHasCapability";
import { createIncomingWebhook, useInvalidateBots } from "../api/botsApi";
import { createIncomingWebhookWithFormat, useWebhookFormats } from "../api/webhookFormatsApi";
import { webhookUrl } from "../webhookUrl";
import { ChannelsCutNotice } from "./ChannelsCutNotice";
import { WebhookFormatEditor } from "./WebhookFormatEditor";

/** A new webhook's URL, shown once, and what to say beside it. */
export interface CreatedWebhook {
  id: string;
  url: string;
  preset: WebhookPreset;
  /** What to set up on the service's side, for a ready-made format. */
  setupNote?: string;
  /** Whether the URL is the test URL already handed out, which now posts. */
  keptTestUrl?: boolean;
}

interface NewWebhookDialogProps {
  serverId: string;
  /** Channels that may get a webhook: no active one, not encrypted. Unused with `channel`. */
  channels?: ConversationSummary[];
  /** The one channel the webhook is for, shown as text instead of a picker. */
  channel?: ConversationSummary;
  /** The channel list was cut, so a channel may be missing. */
  channelsCut?: boolean;
  /** Active bots. */
  bots: Bot[];
  /** Called with the new URL, shown once; the caller shows it and holds it in its state. */
  onCreated: (created: CreatedWebhook) => void;
  onClose: () => void;
}

const FIELD_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** The format a new webhook is made with: Plain, the shipped GitHub one, a copy of another ready-made one, or one written here. */
const PLAIN: string = WebhookPreset.PLAIN;
const GITHUB: string = WebhookPreset.GITHUB;
const CUSTOM = "custom";
/** The key of the shipped GitHub format among the host's ready-made ones. */
const GITHUB_KEY = "github";

/**
 * Asks for a channel, a bot and a format, and makes the incoming webhook that joins them. On a
 * host without formats the choice is the preset, Plain or GitHub; with them it is a format: Plain,
 * GitHub, a ready-made one, which is copied, or Custom, which opens the editor.
 */
export function NewWebhookDialog({
  serverId,
  channels = [],
  channel,
  channelsCut = false,
  bots,
  onCreated,
  onClose,
}: NewWebhookDialogProps) {
  const [conversationId, setConversationId] = useState(channel?.id ?? "");
  const [botUserId, setBotUserId] = useState(bots[0]?.userId ?? "");
  const [choice, setChoice] = useState(PLAIN);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const invalidate = useInvalidateBots(serverId);
  const withFormats = useSpaceHasCapability(serverId, WEBHOOK_FORMATS);
  const formats = useWebhookFormats(serverId, withFormats);
  const others = (formats.data ?? []).filter((f) => f.key !== GITHUB_KEY);
  const shipped = formats.data?.find((f) => f.key === (choice === GITHUB ? GITHUB_KEY : choice));

  const ready = Boolean(conversationId && botUserId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    if (choice === CUSTOM) {
      setWriting(true);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const preset = choice === GITHUB ? WebhookPreset.GITHUB : WebhookPreset.PLAIN;
      const copied = shipped && choice !== GITHUB ? shipped.format : null;
      const created = copied
        ? await createIncomingWebhookWithFormat({
            conversationId,
            botUserId,
            preset,
            template: copied,
          })
        : await createIncomingWebhook({ conversationId, botUserId, preset });
      invalidate(botUserId);
      onCreated({
        id: created.webhook.id,
        url: await webhookUrl(created.token),
        preset,
        setupNote: shipped?.setupNote,
      });
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not make the webhook"));
    } finally {
      setPending(false);
    }
  }

  if (writing) {
    return (
      <WebhookFormatEditor
        serverId={serverId}
        target={{ kind: "new", conversationId, botUserId }}
        onClose={onClose}
        onSaved={(saved) => {
          if (saved.kind !== "created") return;
          invalidate(botUserId);
          onCreated({
            id: saved.id,
            url: saved.url,
            preset: WebhookPreset.PLAIN,
            keptTestUrl: saved.keptTestUrl,
          });
        }}
      />
    );
  }

  return (
    <Dialog open title="New incoming webhook" onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {channel ? (
          <div>
            <span className={LABEL_CLASS}>Channel</span>
            <p className="break-words text-sm text-rim-text">
              {showInvisibleCharacters(channel.title ?? "Untitled")}
              {channel.isPrivate ? " (private)" : ""}
            </p>
          </div>
        ) : (
          <>
            <label className="block">
              <span className={LABEL_CLASS}>Channel</span>
              <select
                value={conversationId}
                onChange={(e) => setConversationId(e.currentTarget.value)}
                className={FIELD_CLASS}
              >
                <option value="">Choose a channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ?? "Untitled"}
                    {c.isPrivate ? " (private)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="-mt-2 text-xs text-rim-text-muted">
              Need a new channel? Create it first, then pick it here. A channel&apos;s menu also has
              New webhook…
            </p>
            {channelsCut && <ChannelsCutNotice />}
          </>
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
          <span className={LABEL_CLASS}>{withFormats ? "Format" : "Preset"}</span>
          <select
            value={choice}
            onChange={(e) => setChoice(e.currentTarget.value)}
            className={FIELD_CLASS}
          >
            <option value={PLAIN}>Plain</option>
            <option value={GITHUB}>GitHub</option>
            {withFormats &&
              others.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            {withFormats && <option value={CUSTOM}>Custom</option>}
          </select>
        </label>
        {choice === CUSTOM && (
          <p className="text-xs text-rim-text-muted">
            Next, write the rules that say what a delivery posts.
          </p>
        )}
        {shipped && choice !== GITHUB && (
          <p className="text-xs text-rim-text-muted">
            The webhook gets a copy of the {shipped.name} format, which you can change later.
          </p>
        )}
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
            {choice === CUSTOM ? "Write the format" : "Create webhook"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
