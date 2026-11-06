import { useMemo, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { WebhookPreset, type Bot } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { formatRelativeDate } from "../../../shared/utils/formatDate";
import { useChannels } from "../../conversations/api/useChannels";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { useIncomingWebhooks, useRevokeIncomingWebhook } from "../api/botsApi";
import { NewWebhookDialog } from "./NewWebhookDialog";
import { ShowOnceDialog } from "./ShowOnceDialog";

const PRESET_LABEL: Record<WebhookPreset, string> = {
  [WebhookPreset.PLAIN]: "Plain",
  [WebhookPreset.GITHUB]: "GitHub",
};

/** The steps that connect a GitHub repository to a webhook of the GitHub preset. */
export const GITHUB_SETUP_NOTE =
  "In the repository's Settings > Webhooks, paste this as the Payload URL, choose application/json, and leave Secret empty. RIM posts releases, pull requests and issues.";

/**
 * A workspace's incoming webhooks: one URL per channel that posts as a bot. Shown only for a
 * server with incoming webhooks.
 */
export function WebhooksSection({ serverId, bots }: { serverId: string; bots: Bot[] }) {
  const webhooks = useIncomingWebhooks(serverId, true);
  const channels = useChannels(serverId);
  const revoke = useRevokeIncomingWebhook(serverId);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ url: string; preset: WebhookPreset } | null>(null);
  const [toRevoke, setToRevoke] = useState<string | null>(null);

  const channelName = (id: string) =>
    channels.data?.items.find((c) => c.id === id)?.title ?? "A channel you are not in";
  const botName = (id: string) => bots.find((b) => b.userId === id)?.name ?? "A removed bot";
  const active = useMemo(() => webhooks.data?.filter((w) => !w.revokedAt) ?? [], [webhooks.data]);
  const withHook = new Set(active.map((w) => w.conversationId));
  const freeChannels = (channels.data?.items ?? []).filter(
    (c) => !c.encryptedAt && !withHook.has(c.id),
  );
  const activeBots = bots.filter((b) => !b.deactivatedAt);

  return (
    <section className="space-y-3" aria-labelledby="webhooks-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="webhooks-heading" className="text-base font-semibold text-rim-text">
          Incoming webhooks
        </h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCreating(true)}
          disabled={activeBots.length === 0 || freeChannels.length === 0}
        >
          New webhook
        </Button>
      </div>
      <p className="text-sm text-rim-text-muted">
        One URL per channel. Anyone with the URL can post to that channel as the bot, so keep it
        like a password.
      </p>
      {activeBots.length === 0 && <p className="text-xs text-rim-text-faint">Add a bot first.</p>}
      {webhooks.isPending && <p className="text-sm text-rim-text-muted">Loading webhooks...</p>}
      {webhooks.isError && (
        <div className="space-y-2">
          <p className="text-sm text-rim-danger">
            {graphqlErrorMessage(webhooks.error, "Could not load the webhooks")}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void webhooks.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {webhooks.data && active.length === 0 && (
        <p className="text-sm text-rim-text-muted">No incoming webhooks.</p>
      )}
      {active.length > 0 && (
        <ul className="space-y-2" aria-label="Incoming webhooks">
          {active.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rim-line bg-rim-panel px-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium text-rim-text">
                  {channelName(w.conversationId)} · {botName(w.botUserId)} ·{" "}
                  {PRESET_LABEL[w.preset]}
                </p>
                <p className="text-xs text-rim-text-muted">
                  Created {formatRelativeDate(w.createdAt)} · Last used{" "}
                  {w.lastUsedAt ? formatRelativeDate(w.lastUsedAt) : "Never"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setToRevoke(w.id)}
                aria-label={`Revoke the webhook of ${channelName(w.conversationId)}`}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewWebhookDialog
          serverId={serverId}
          channels={freeChannels}
          bots={activeBots}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setShown(created);
          }}
        />
      )}
      {shown && (
        <ShowOnceDialog
          title="Webhook URL"
          label="URL"
          value={shown.url}
          onClose={() => setShown(null)}
        >
          {shown.preset === WebhookPreset.GITHUB && (
            <p className="text-sm text-rim-text-muted">{GITHUB_SETUP_NOTE}</p>
          )}
        </ShowOnceDialog>
      )}
      {toRevoke && (
        <ConfirmActionDialog
          title="Revoke this webhook?"
          description="The URL stops working at once. You can make a new one for the channel."
          confirmLabel="Revoke"
          danger
          isPending={revoke.isPending}
          onClose={() => setToRevoke(null)}
          onConfirm={() =>
            revoke.mutate(toRevoke, {
              onSuccess: () => setToRevoke(null),
              onError: (err) => {
                setToRevoke(null);
                toast.error(graphqlErrorMessage(err, "Could not revoke the webhook"));
              },
            })
          }
        />
      )}
    </section>
  );
}
