import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { Bot, BotToken } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { formatRelativeDate } from "../../../shared/utils/formatDate";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { createBotToken, useBotTokens, useInvalidateBots, useRevokeBotToken } from "../api/botsApi";

/** How many tokens a bot can have that are not revoked. */
export const MAX_ACTIVE_TOKENS = 5;

interface BotTokensDialogProps {
  serverId: string;
  bot: Bot;
  /** Called with a new token, shown once; the caller shows it and holds it in its state. */
  onCreated: (token: string) => void;
  onClose: () => void;
}

function TokenRow({ token, onRevoke }: { token: BotToken; onRevoke: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rim-line px-3 py-2">
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium text-rim-text">{token.label}</p>
        <p className="text-xs text-rim-text-muted">
          Created {formatRelativeDate(token.createdAt)} · Last used{" "}
          {token.lastUsedAt ? formatRelativeDate(token.lastUsedAt) : "Never"}
          {token.revokedAt && ` · Revoked ${formatRelativeDate(token.revokedAt)}`}
        </p>
      </div>
      {!token.revokedAt && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onRevoke}
          aria-label={`Revoke ${token.label}`}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}

/** A bot's tokens: when each was made and last used, a new one, and revoking one. */
export function BotTokensDialog({ serverId, bot, onCreated, onClose }: BotTokensDialogProps) {
  const tokens = useBotTokens(bot.userId);
  const revoke = useRevokeBotToken(bot.userId);
  const invalidate = useInvalidateBots(serverId);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [toRevoke, setToRevoke] = useState<BotToken | null>(null);

  const active = tokens.data?.filter((t) => !t.revokedAt).length ?? 0;
  const full = active >= MAX_ACTIVE_TOKENS;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || full || pending) return;
    setError(null);
    setPending(true);
    try {
      const created = await createBotToken(bot.userId, trimmed);
      setLabel("");
      invalidate(bot.userId);
      onCreated(created.token);
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not make the token"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open title={`Tokens of ${bot.name}`} onClose={onClose} maxWidth="max-w-lg">
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {tokens.isPending && <p className="text-sm text-rim-text-muted">Loading tokens...</p>}
          {tokens.isError && (
            <div className="space-y-2">
              <p className="text-sm text-rim-danger">
                {graphqlErrorMessage(tokens.error, "Could not load the tokens")}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void tokens.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {tokens.data && tokens.data.length === 0 && (
            <p className="text-sm text-rim-text-muted">No tokens.</p>
          )}
          {tokens.data && tokens.data.length > 0 && (
            <ul className="space-y-2" aria-label="Tokens">
              {tokens.data.map((t) => (
                <TokenRow key={t.id} token={t} onRevoke={() => setToRevoke(t)} />
              ))}
            </ul>
          )}
          <form onSubmit={(e) => void create(e)} className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
                New token label
              </span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
                maxLength={64}
                disabled={full}
                className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent/40 disabled:opacity-50"
              />
            </label>
            {full && (
              <p className="text-xs text-rim-text-muted">
                A bot has at most {MAX_ACTIVE_TOKENS} tokens that are not revoked. Revoke one to
                make another.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-rim-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={!label.trim() || full}
                isLoading={pending}
              >
                New token
              </Button>
            </div>
          </form>
        </div>
      </Dialog>
      {toRevoke && (
        <ConfirmActionDialog
          title={`Revoke ${toRevoke.label}?`}
          description="Anything using it stops working."
          confirmLabel="Revoke"
          danger
          isPending={revoke.isPending}
          onClose={() => setToRevoke(null)}
          onConfirm={() =>
            revoke.mutate(toRevoke.id, {
              onSuccess: () => setToRevoke(null),
              onError: (err) => {
                setToRevoke(null);
                toast.error(graphqlErrorMessage(err, "Could not revoke the token"));
              },
            })
          }
        />
      )}
    </>
  );
}
