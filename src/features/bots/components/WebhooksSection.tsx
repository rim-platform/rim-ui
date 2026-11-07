import { useEffect, useMemo, useRef, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { WebhookPreset, type Bot } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { formatRelativeDate } from "../../../shared/utils/formatDate";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { useAllChannels } from "../api/useAllChannels";
import { useIncomingWebhooks, useRevokeIncomingWebhook } from "../api/botsApi";
import { NewWebhookDialog } from "./NewWebhookDialog";
import { WebhookUrlDialog } from "./WebhookUrlDialog";

const PRESET_LABEL: Record<WebhookPreset, string> = {
  [WebhookPreset.PLAIN]: "Plain",
  [WebhookPreset.GITHUB]: "GitHub",
};

/**
 * A workspace's incoming webhooks: one URL per channel that posts as a bot. Shown only for a
 * server with incoming webhooks.
 */
export function WebhooksSection({ serverId, bots }: { serverId: string; bots: Bot[] }) {
  const webhooks = useIncomingWebhooks(serverId, true);
  const channels = useAllChannels(serverId);
  const revoke = useRevokeIncomingWebhook(serverId);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ id: string; url: string; preset: WebhookPreset } | null>(
    null,
  );
  const [toRevoke, setToRevoke] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the list has been fetched again: a webhook's Revoke button, or New webhook.
  const [refocus, setRefocus] = useState<{ revokeOf: string | null } | null>(null);

  const channelName = (id: string) =>
    channels.data?.items.find((c) => c.id === id)?.title ?? "A channel you are not in";
  const botName = (id: string) => bots.find((b) => b.userId === id)?.name ?? "A removed bot";
  const active = useMemo(() => webhooks.data?.filter((w) => !w.revokedAt) ?? [], [webhooks.data]);
  const withHook = new Set(active.map((w) => w.conversationId));
  const freeChannels = (channels.data?.items ?? []).filter(
    (c) => !c.encryptedAt && !withHook.has(c.id),
  );
  const activeBots = bots.filter((b) => !b.deactivatedAt);

  useEffect(() => {
    if (!refocus || webhooks.isFetching) return;
    setTimeout(() => {
      const revoke = refocus.revokeOf
        ? Array.from(
            sectionRef.current?.querySelectorAll<HTMLElement>("[data-webhook-revoke]") ?? [],
          ).find((el) => el.dataset.webhookRevoke === refocus.revokeOf)
        : null;
      (revoke ?? newRef.current)?.focus();
    });
    setRefocus(null);
  }, [refocus, webhooks.isFetching]);

  return (
    <section ref={sectionRef} className="space-y-3" aria-labelledby="webhooks-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="webhooks-heading" className="text-base font-semibold text-rim-text">
          Incoming webhooks
        </h3>
        <Button
          ref={newRef}
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
                data-webhook-revoke={w.id}
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
          channelsCut={channels.data?.truncated}
          bots={activeBots}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setShown(created);
          }}
        />
      )}
      {shown && (
        <WebhookUrlDialog
          url={shown.url}
          preset={shown.preset}
          onClose={() => {
            setRefocus({ revokeOf: shown.id });
            setShown(null);
          }}
        />
      )}
      {toRevoke && (
        <ConfirmActionDialog
          title="Revoke this webhook?"
          description="The URL stops working at once. You can make a new one for the channel."
          confirmLabel="Revoke"
          danger
          isPending={revoke.isPending}
          onClose={() => setToRevoke(null)}
          onConfirm={() => {
            const at = active.findIndex((w) => w.id === toRevoke);
            const next = active[at + 1]?.id ?? null;
            revoke.mutate(toRevoke, {
              onSuccess: () => {
                setToRevoke(null);
                setRefocus({ revokeOf: next });
              },
              onError: (err) => {
                setToRevoke(null);
                toast.error(graphqlErrorMessage(err, "Could not revoke the webhook"));
              },
            });
          }}
        />
      )}
    </section>
  );
}
