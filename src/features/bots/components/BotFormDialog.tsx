import { useId, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { Bot } from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { createBot, useInvalidateBots, useUpdateBot } from "../api/botsApi";

/** The longest a bot's name or statement can be, as the server counts characters. */
export const STATEMENT_MAX = 200;

const FIELD_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

interface BotFormDialogProps {
  serverId: string;
  /** The bot to change; without one the dialog makes a new bot. */
  bot?: Bot;
  /** Called with a new bot's token, shown once; the caller shows it and holds it in its state. */
  onCreated?: (bot: Bot, token: string) => void;
  onClose: () => void;
  /** Called after an edit is saved, before the dialog closes. */
  onSaved?: () => void;
}

function Counter({ id, length }: { id: string; length: number }) {
  return (
    <span id={id} className="text-xs text-rim-text-faint">
      {length} / {STATEMENT_MAX}
    </span>
  );
}

/**
 * Makes a bot or changes one: its name, who runs it and where what it reads goes. Both
 * statements are required and are shown to everyone in the workspace as what the person who
 * added the bot says.
 */
export function BotFormDialog({ serverId, bot, onCreated, onSaved, onClose }: BotFormDialogProps) {
  const [name, setName] = useState(bot?.name ?? "");
  const [runBy, setRunBy] = useState(bot?.runBy ?? "");
  const [readsGoTo, setReadsGoTo] = useState(bot?.readsGoTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const update = useUpdateBot(serverId);
  const invalidate = useInvalidateBots(serverId);
  const runHelp = useId();
  const readsHelp = useId();
  const runCount = useId();
  const readsCount = useId();

  const trimmed = { name: name.trim(), runBy: runBy.trim(), readsGoTo: readsGoTo.trim() };
  const valid = Boolean(trimmed.name && trimmed.runBy && trimmed.readsGoTo);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setError(null);
    setPending(true);
    try {
      if (bot) {
        await update.mutateAsync({
          botUserId: bot.userId,
          name: trimmed.name,
          runBy: trimmed.runBy,
          readsGoTo: trimmed.readsGoTo,
        });
        onSaved?.();
        onClose();
      } else {
        const created = await createBot({ serverId, ...trimmed });
        invalidate(created.bot.userId);
        onCreated?.(created.bot, created.token);
      }
    } catch (err) {
      setError(
        graphqlErrorMessage(err, bot ? "Could not change the bot" : "Could not add the bot"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open title={bot ? "Edit bot" : "New bot"} onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <label className="block">
          <span className={LABEL_CLASS}>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            autoFocus
            maxLength={64}
            className={FIELD_CLASS}
          />
        </label>
        <div>
          <label>
            <span className={LABEL_CLASS}>Who runs it</span>
            <input
              type="text"
              value={runBy}
              onChange={(e) => setRunBy(e.currentTarget.value)}
              maxLength={STATEMENT_MAX}
              required
              aria-describedby={`${runHelp} ${runCount}`}
              className={FIELD_CLASS}
            />
          </label>
          <div className="mt-1 flex justify-between gap-2">
            <p id={runHelp} className="text-xs text-rim-text-muted">
              People in its channels see this. For example: the Halden Studio team, on our own
              server, with a local model.
            </p>
            <Counter id={runCount} length={runBy.length} />
          </div>
        </div>
        <div>
          <label>
            <span className={LABEL_CLASS}>Where what it reads goes</span>
            <input
              type="text"
              value={readsGoTo}
              onChange={(e) => setReadsGoTo(e.currentTarget.value)}
              maxLength={STATEMENT_MAX}
              required
              aria-describedby={`${readsHelp} ${readsCount}`}
              className={FIELD_CLASS}
            />
          </label>
          <div className="mt-1 flex justify-between gap-2">
            <p id={readsHelp} className="text-xs text-rim-text-muted">
              People in its channels see this. For example: our own server, never sent to a
              provider.
            </p>
            <Counter id={readsCount} length={readsGoTo.length} />
          </div>
        </div>
        <p className="text-xs text-rim-text-muted">
          Everyone in the workspace sees both statements as what you say. RIM can&apos;t check them.
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
          <Button type="submit" variant="primary" disabled={!valid} isLoading={pending}>
            {bot ? "Save" : "Add bot"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
