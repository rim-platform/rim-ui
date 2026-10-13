import { useId, useState, type FormEvent } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type {
  InstancePrincipalBlock,
  InstancePrincipalBlockOutcome,
} from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { formatTime } from "../../../shared/utils/formatTime";
import { useBlockPrincipalMutation, useUnblockPrincipalMutation } from "../api/instanceModeration";
import { ERROR_BOX, FIELD_LABEL, MAX_REASON_LENGTH, PANEL, TEXT_INPUT, countOf } from "./styles";

/** A principal to put in the block form; `seq` changes each time a report asks for it. */
export interface BlockDraft {
  principalId: string;
  seq: number;
}

interface PrincipalBlocksSectionProps {
  blocks: UseQueryResult<InstancePrincipalBlock[]>;
  draft: BlockDraft;
}

function blockName(block: InstancePrincipalBlock): string {
  return block.username ? `@${block.username}` : block.principalId;
}

/** Principals this server refuses, newest first, with Unblock and the block form. */
export function PrincipalBlocksSection({ blocks, draft }: PrincipalBlocksSectionProps) {
  const { data, isPending, isError, error } = blocks;
  const unblock = useUnblockPrincipalMutation();

  function handleUnblock(block: InstancePrincipalBlock) {
    const name = blockName(block);
    unblock.mutate(
      { principalId: block.principalId },
      {
        onSuccess: (outcome) => {
          if (!outcome.lifted) toast.info(`${name} was not blocked`);
          else if (outcome.emailUnblocked) toast.success(`Unblocked ${name} and their email`);
          else toast.success(`Unblocked ${name}`);
        },
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not lift the block")),
      },
    );
  }

  return (
    <div className={PANEL}>
      <h3 className="text-sm font-medium text-rim-text">Blocked principals</h3>
      <p className="mt-1 text-xs text-rim-text-muted">
        A blocked principal cannot sign up, sign in or deliver here. Newest first.
      </p>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading blocks…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load blocked principals.")}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">No blocked principals.</p>
      )}
      {data && data.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Blocked principals">
          {data.map((block) => {
            const name = blockName(block);
            return (
              <li
                key={block.principalId}
                data-testid={`principal-block-${block.principalId}`}
                className="flex items-center gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  {block.username && <p className="text-sm text-rim-text">@{block.username}</p>}
                  <p className="truncate font-mono text-xs text-rim-text-muted">
                    {block.principalId}
                  </p>
                  <p className="truncate text-xs text-rim-text-muted">
                    {block.reason}
                    <span className="text-rim-text-faint">
                      {" "}
                      &middot; {formatTime(block.createdAt)}
                    </span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    unblock.isPending && unblock.variables?.principalId === block.principalId
                  }
                  onClick={() => handleUnblock(block)}
                  aria-label={`Unblock ${name}`}
                >
                  Unblock
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <BlockPrincipalForm
        key={draft.seq}
        initialPrincipalId={draft.principalId}
        focusReason={draft.seq > 0}
      />
    </div>
  );
}

function BlockPrincipalForm({
  initialPrincipalId,
  focusReason,
}: {
  initialPrincipalId: string;
  focusReason: boolean;
}) {
  const block = useBlockPrincipalMutation();
  const formId = useId();
  const [principalId, setPrincipalId] = useState(initialPrincipalId);
  const [reason, setReason] = useState("");
  const [cascade, setCascade] = useState(false);
  const canSubmit = principalId.trim() !== "" && reason.trim() !== "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    block.mutate(
      { principalId: principalId.trim(), reason: reason.trim(), cascade },
      {
        onSuccess: () => {
          setPrincipalId("");
          setReason("");
          setCascade(false);
        },
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Block a principal"
      className="mt-4 space-y-3 border-t border-rim-line pt-4"
    >
      <h4 className="text-xs font-medium uppercase tracking-wide text-rim-text-faint">
        Block a principal
      </h4>
      <div>
        <label htmlFor={`${formId}-principal`} className={FIELD_LABEL}>
          Principal id
        </label>
        <input
          id={`${formId}-principal`}
          value={principalId}
          onChange={(e) => setPrincipalId(e.target.value)}
          placeholder="rimp1_…"
          autoComplete="off"
          spellCheck={false}
          className={`${TEXT_INPUT} font-mono`}
        />
      </div>
      <div>
        <label htmlFor={`${formId}-reason`} className={FIELD_LABEL}>
          Reason
        </label>
        <input
          id={`${formId}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={MAX_REASON_LENGTH}
          autoFocus={focusReason}
          autoComplete="off"
          className={TEXT_INPUT}
        />
      </div>
      <label className="flex items-start gap-2 text-xs text-rim-text-muted">
        <input
          type="checkbox"
          checked={cascade}
          onChange={(e) => setCascade(e.target.checked)}
          className="mt-0.5 accent-rim-accent"
        />
        <span>Also block the accounts its invites created, and theirs in turn.</span>
      </label>
      {block.isError && (
        <p role="alert" className={ERROR_BOX}>
          {graphqlErrorMessage(block.error, "Could not block the principal")}
        </p>
      )}
      <Button
        type="submit"
        variant="danger"
        size="sm"
        disabled={!canSubmit}
        isLoading={block.isPending}
      >
        Block principal
      </Button>
      {block.data && <BlockOutcomes outcomes={block.data} />}
    </form>
  );
}

function outcomeName(outcome: InstancePrincipalBlockOutcome): string {
  if (outcome.account) return `@${outcome.account.username}`;
  return outcome.principalId ? `${outcome.principalId} (no account here)` : "An account";
}

/** What a block did, one line per account or principal blocked. */
function BlockOutcomes({ outcomes }: { outcomes: InstancePrincipalBlockOutcome[] }) {
  const accounts = outcomes.filter((outcome) => outcome.account).length;
  return (
    <div role="status" className="space-y-1 rounded-md bg-rim-void px-3 py-2 text-xs">
      <p className="font-medium text-rim-text">Blocked {countOf(accounts, "account")}.</p>
      <ul aria-label="Block outcomes" className="space-y-1">
        {outcomes.map((outcome, i) => (
          <li key={outcome.account?.userId ?? outcome.principalId ?? i}>
            <span className="text-rim-text">{outcomeName(outcome)}</span>
            <span className="text-rim-text-muted">
              {": "}
              {outcome.newlyBlocked ? "blocked" : "already blocked, reason replaced"}
              {" · "}
              {countOf(outcome.endedSessions, "session")} ended
              {" · "}
              {countOf(outcome.revokedInvites, "invite")} revoked
              {" · "}
              {countOf(outcome.ignoredRequests, "DM request")} ignored
              {" · "}
              {outcome.emailBlocked ? "email blocked" : "email not blocked"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
