import { useMemo, useState, type ReactNode } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useShellStore } from "../../../shell/state/useShellStore";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import type { ConversationSummary } from "../../conversations/types";
import { useBots, useIncomingWebhooks } from "../api/botsApi";
import { NewWebhookDialog, type CreatedWebhook } from "./NewWebhookDialog";
import { WebhookUrlDialog } from "./WebhookUrlDialog";

interface ChannelWebhookDialogProps {
  /** The channel the webhook is for. */
  conversation: ConversationSummary;
  onClose: () => void;
}

/** Opens Settings > Bots, closing the navigation drawer of a narrow window over it. */
function openBotsSettings() {
  const shell = useShellStore.getState();
  shell.setMainSurface({ kind: "settings", tab: "bots" });
  shell.setNavDrawerOpen(false);
}

/**
 * Makes a channel's incoming webhook from the channel's own menu. It reads the workspace's
 * webhooks and bots when it opens and says what is missing instead of showing a form that can
 * only fail: a channel has one active webhook, and a webhook posts as a bot. Otherwise it asks
 * for a bot and a preset, then shows the URL once.
 */
export function ChannelWebhookDialog({ conversation, onClose }: ChannelWebhookDialogProps) {
  const serverId = conversation.serverId;
  const webhooks = useIncomingWebhooks(serverId, true);
  const bots = useBots(serverId);
  const [shown, setShown] = useState<CreatedWebhook | null>(null);

  const hasWebhook = useMemo(
    () => webhooks.data?.some((w) => !w.revokedAt && w.conversationId === conversation.id) ?? false,
    [webhooks.data, conversation.id],
  );
  const activeBots = useMemo(() => bots.data?.filter((b) => !b.deactivatedAt) ?? [], [bots.data]);

  // The URL stays up even once the refetched list shows the new webhook.
  if (shown) {
    return (
      <WebhookUrlDialog
        url={shown.url}
        preset={shown.preset}
        setupNote={shown.setupNote}
        keptTestUrl={shown.keptTestUrl}
        onClose={onClose}
      />
    );
  }

  const failed = webhooks.isError ? webhooks : bots.isError ? bots : null;
  if (!failed && webhooks.data && bots.data && !hasWebhook && activeBots.length > 0) {
    return (
      <NewWebhookDialog
        serverId={serverId}
        channel={conversation}
        bots={activeBots}
        onClose={onClose}
        onCreated={setShown}
      />
    );
  }

  let body: ReactNode;
  let action: ReactNode = null;
  if (failed) {
    body = (
      <p role="alert" className="text-sm text-rim-danger">
        {graphqlErrorMessage(failed.error, "Could not load the webhooks")}
      </p>
    );
    action = (
      <Button
        variant="primary"
        onClick={() => {
          void webhooks.refetch();
          void bots.refetch();
        }}
      >
        Retry
      </Button>
    );
  } else if (!webhooks.data || !bots.data) {
    body = <p className="text-sm text-rim-text-muted">Loading webhooks...</p>;
  } else {
    body = (
      <p className="text-sm text-rim-text">
        {hasWebhook
          ? "This channel already has a webhook."
          : "A webhook posts as a bot, and this workspace has none yet."}
      </p>
    );
    action = (
      <Button
        variant="primary"
        onClick={() => {
          openBotsSettings();
          onClose();
        }}
      >
        Open Bots
      </Button>
    );
  }

  return (
    <Dialog open title="New incoming webhook" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        {body}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {action}
        </div>
      </div>
    </Dialog>
  );
}
