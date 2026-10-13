import { useId, useState, type FormEvent } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { InstanceIpBlock } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { formatTime } from "../../../shared/utils/formatTime";
import { useBlockIpMutation, useUnblockIpMutation } from "../api/instanceModeration";
import { BADGE, ERROR_BOX, FIELD_LABEL, MAX_REASON_LENGTH, PANEL, TEXT_INPUT } from "./styles";

/** The longest block the server takes, in days. */
const MAX_DAYS = 365;

function expiryText(block: InstanceIpBlock): string {
  if (!block.expiresAt) return "Until removed";
  return `${block.expired ? "Expired" : "Expires"} ${formatTime(block.expiresAt)}`;
}

/**
 * The days field as the server takes it: null when empty, a whole number from 1 to 365, or
 * undefined when it is neither.
 */
function parseDays(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days >= 1 && days <= MAX_DAYS ? days : undefined;
}

/** The IP deny list, oldest first and expired blocks included, with Unblock and the block form. */
export function IpBlocksSection({ blocks }: { blocks: UseQueryResult<InstanceIpBlock[]> }) {
  const { data, isPending, isError, error } = blocks;
  const unblock = useUnblockIpMutation();

  function handleUnblock(cidr: string) {
    unblock.mutate(
      { cidr },
      {
        onSuccess: (lifted) =>
          lifted ? toast.success(`Unblocked ${cidr}`) : toast.info(`${cidr} was not blocked`),
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not lift the block")),
      },
    );
  }

  return (
    <div className={PANEL}>
      <h3 className="text-sm font-medium text-rim-text">Blocked addresses</h3>
      <p className="mt-1 text-xs text-rim-text-muted">
        Requests from these addresses are refused. Changes apply within 30 seconds. Oldest first.
      </p>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading blocks…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load blocked addresses.")}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">No blocked addresses.</p>
      )}
      {data && data.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Blocked addresses">
          {data.map((block) => (
            <li
              key={block.cidr}
              data-testid={`ip-block-${block.cidr}`}
              className="flex items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm text-rim-text">
                  <span className="font-mono">{block.cidr}</span>
                  {block.expired && <span className={BADGE}>Expired</span>}
                </p>
                <p className="truncate text-xs text-rim-text-muted">
                  {block.reason}
                  <span className="text-rim-text-faint"> &middot; {expiryText(block)}</span>
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={unblock.isPending && unblock.variables?.cidr === block.cidr}
                onClick={() => handleUnblock(block.cidr)}
                aria-label={`Unblock ${block.cidr}`}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
      <BlockIpForm />
    </div>
  );
}

function BlockIpForm() {
  const block = useBlockIpMutation();
  const formId = useId();
  const [cidr, setCidr] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const parsedDays = parseDays(days);
  const daysInvalid = parsedDays === undefined;
  const canSubmit = cidr.trim() !== "" && reason.trim() !== "" && !daysInvalid;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const target = cidr.trim();
    block.mutate(
      { cidr: target, reason: reason.trim(), expiresInDays: parsedDays },
      {
        onSuccess: (outcome) => {
          toast.success(
            outcome.newlyBlocked
              ? `Blocked ${outcome.block.cidr}`
              : `Updated the block on ${outcome.block.cidr}`,
          );
          setCidr("");
          setReason("");
          setDays("");
        },
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Block an address"
      className="mt-4 space-y-3 border-t border-rim-line pt-4"
    >
      <h4 className="text-xs font-medium uppercase tracking-wide text-rim-text-faint">
        Block an address
      </h4>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${formId}-cidr`} className={FIELD_LABEL}>
            Address or CIDR range
          </label>
          <input
            id={`${formId}-cidr`}
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="203.0.113.0/24"
            autoComplete="off"
            spellCheck={false}
            className={`${TEXT_INPUT} font-mono`}
          />
        </div>
        <div className="w-32 shrink-0">
          <label htmlFor={`${formId}-days`} className={FIELD_LABEL}>
            Days (optional)
          </label>
          <input
            id={`${formId}-days`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="Until removed"
            aria-invalid={daysInvalid || undefined}
            className={TEXT_INPUT}
          />
        </div>
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
          autoComplete="off"
          className={TEXT_INPUT}
        />
      </div>
      {daysInvalid && (
        <p role="alert" className={ERROR_BOX}>
          Days must be a whole number from 1 to {MAX_DAYS}, or empty to block until removed.
        </p>
      )}
      {block.isError && (
        <p role="alert" className={ERROR_BOX}>
          {graphqlErrorMessage(block.error, "Could not block the address")}
        </p>
      )}
      <Button
        type="submit"
        variant="danger"
        size="sm"
        disabled={!canSubmit}
        isLoading={block.isPending}
      >
        Block address
      </Button>
    </form>
  );
}
