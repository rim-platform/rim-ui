import { useEffect, useRef, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { Bot } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { BotBadge } from "../../../shared/ui/BotBadge";
import { Button } from "../../../shared/ui/Button";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useBots, useDeactivateBot } from "../api/botsApi";
import { webhooksAvailable } from "../availability";
import { BotChannelsDialog } from "./BotChannelsDialog";
import { BotFormDialog } from "./BotFormDialog";
import { BotTokensDialog } from "./BotTokensDialog";
import { ShowOnceDialog } from "./ShowOnceDialog";
import { WebhooksSection } from "./WebhooksSection";

/** How many active bots a workspace holds at most. */
export const MAX_ACTIVE_BOTS = 25;

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; bot: Bot }
  | { kind: "tokens"; bot: Bot }
  | { kind: "channels"; bot: Bot }
  | { kind: "deactivate"; bot: Bot };

function Statement({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs text-rim-text-muted">
      <span className="text-rim-text-faint">{label}:</span>{" "}
      <span className="break-words text-rim-text">{value}</span>
    </p>
  );
}

function BotRow({ bot, onOpen }: { bot: Bot; onOpen: (dialog: Dialog) => void }) {
  const active = !bot.deactivatedAt;
  return (
    <li className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-rim-text">{bot.name}</span>
        <BotBadge />
      </div>
      <div className="space-y-0.5">
        <Statement label="Who runs it" value={bot.runBy} />
        <Statement label="Where what it reads goes" value={bot.readsGoTo} />
        <Statement label="Added by" value={bot.addedByName ?? "someone no longer here"} />
      </div>
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            data-bot-edit={bot.userId}
            onClick={() => onOpen({ kind: "edit", bot })}
          >
            Edit
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: "tokens", bot })}>
            Tokens
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: "channels", bot })}>
            Channels
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: "deactivate", bot })}>
            Deactivate
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Settings > Bots, for Owners and Moderators: the workspace's bots with what the person who
 * added each says about it, their tokens and channels, and incoming webhooks where the server
 * has them. A token or webhook URL is shown once, in a dialog that holds it in its own state.
 */
export function BotsSettings({ serverId }: { serverId: string }) {
  const bots = useBots(serverId);
  const deactivate = useDeactivateBot(serverId);
  const { info } = useServerInfo();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const newBotRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Where focus goes once the list has been fetched again: a bot's Edit button, or New bot.
  const [refocus, setRefocus] = useState<{ editOf: string | null } | null>(null);
  const [secret, setSecret] = useState<{ title: string; label: string; value: string } | null>(
    null,
  );

  const active = bots.data?.filter((b) => !b.deactivatedAt) ?? [];
  const inactive = bots.data?.filter((b) => b.deactivatedAt) ?? [];
  const full = active.length >= MAX_ACTIVE_BOTS;

  useEffect(() => {
    if (!refocus || bots.isFetching) return;
    setTimeout(() => {
      const edit = refocus.editOf
        ? Array.from(
            sectionRef.current?.querySelectorAll<HTMLElement>("[data-bot-edit]") ?? [],
          ).find((el) => el.dataset.botEdit === refocus.editOf)
        : null;
      (edit ?? newBotRef.current)?.focus();
    });
    setRefocus(null);
  }, [refocus, bots.isFetching]);

  return (
    <div className="space-y-8">
      <section ref={sectionRef} className="space-y-3" aria-labelledby="bots-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="bots-heading" className="text-base font-semibold text-rim-text">
            Bots in this workspace
          </h2>
          <Button
            ref={newBotRef}
            variant="primary"
            size="sm"
            onClick={() => setDialog({ kind: "create" })}
            disabled={full || bots.isPending || bots.isError}
          >
            New bot
          </Button>
        </div>
        <p className="text-sm text-rim-text-muted">
          A bot is an account for a program, with its own tokens. It only reads and posts in
          channels you add it to, and it never joins encrypted conversations. Whoever runs it
          decides where and with which model.
        </p>
        {full && (
          <p className="text-xs text-rim-text-faint">
            A workspace holds at most {MAX_ACTIVE_BOTS} active bots. Deactivate one to add another.
          </p>
        )}
        {bots.isPending && <p className="text-sm text-rim-text-muted">Loading bots...</p>}
        {bots.isError && (
          <div className="space-y-2">
            <p className="text-sm text-rim-danger">
              {graphqlErrorMessage(bots.error, "Could not load the bots")}
            </p>
            <Button size="sm" variant="secondary" onClick={() => void bots.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {bots.data && active.length === 0 && (
          <p className="text-sm text-rim-text-muted">No bots yet.</p>
        )}
        {active.length > 0 && (
          <ul className="space-y-2" aria-label="Bots">
            {active.map((bot) => (
              <BotRow key={bot.userId} bot={bot} onOpen={setDialog} />
            ))}
          </ul>
        )}
        {inactive.length > 0 && (
          <details className="rounded-lg border border-rim-line">
            <summary className="cursor-pointer px-3 py-2 text-sm text-rim-text-muted">
              Deactivated bots ({inactive.length})
            </summary>
            <ul className="space-y-2 p-3 pt-0" aria-label="Deactivated bots">
              {inactive.map((bot) => (
                <BotRow key={bot.userId} bot={bot} onOpen={setDialog} />
              ))}
            </ul>
          </details>
        )}
      </section>

      {webhooksAvailable(info) && bots.data && (
        <WebhooksSection serverId={serverId} bots={bots.data} />
      )}

      {!secret && dialog?.kind === "create" && (
        <BotFormDialog
          serverId={serverId}
          onClose={() => setDialog(null)}
          onCreated={(bot, token) => {
            setDialog(null);
            setSecret({ title: `Token of ${bot.name}`, label: "Token", value: token });
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <BotFormDialog
          serverId={serverId}
          bot={dialog.bot}
          onSaved={() => setRefocus({ editOf: dialog.bot.userId })}
          onClose={() => setDialog(null)}
        />
      )}
      {!secret && dialog?.kind === "tokens" && (
        <BotTokensDialog
          serverId={serverId}
          bot={dialog.bot}
          onClose={() => setDialog(null)}
          onCreated={(token) =>
            setSecret({ title: `New token of ${dialog.bot.name}`, label: "Token", value: token })
          }
        />
      )}
      {dialog?.kind === "channels" && (
        <BotChannelsDialog serverId={serverId} bot={dialog.bot} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "deactivate" && (
        <ConfirmActionDialog
          title={`Deactivate ${dialog.bot.name}?`}
          description="Its tokens and webhooks stop working and it leaves the workspace. Its messages stay. This can't be undone."
          confirmLabel="Deactivate"
          danger
          isPending={deactivate.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const at = active.findIndex((b) => b.userId === dialog.bot.userId);
            const next = active[at + 1]?.userId ?? null;
            deactivate.mutate(dialog.bot.userId, {
              onSuccess: () => {
                setDialog(null);
                // The row that opened this moves to the deactivated list.
                setRefocus({ editOf: next });
              },
              onError: (err) => {
                setDialog(null);
                toast.error(graphqlErrorMessage(err, "Could not deactivate the bot"));
              },
            });
          }}
        />
      )}
      {secret && (
        <ShowOnceDialog
          title={secret.title}
          label={secret.label}
          value={secret.value}
          onClose={() => setSecret(null)}
        />
      )}
    </div>
  );
}
