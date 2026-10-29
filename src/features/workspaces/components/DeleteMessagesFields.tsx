import { asSentence, graphqlErrorMessage } from "../../../core/graphql/errors";
import type { MemberMessageDeletion } from "../hooks/useMemberMessageDeletion";
import { DELETE_PERIODS, DONT_DELETE_LABEL, tallyText, type DeletePeriod } from "../memberMessages";

/**
 * The period choice of a deletion of a person's messages, with what the chosen period counts and
 * the choice to include the private channels the viewer is not in.
 *
 * @param offerNone Whether "Don't delete" is among the periods.
 */
export function DeleteMessagesFields({
  deletion,
  legend,
  offerNone,
}: {
  deletion: MemberMessageDeletion;
  legend: string;
  offerNone: boolean;
}) {
  const options: { id: DeletePeriod; label: string }[] = offerNone
    ? [{ id: "none", label: DONT_DELETE_LABEL }, ...DELETE_PERIODS]
    : DELETE_PERIODS;
  const { counts } = deletion;

  return (
    <div className="space-y-2">
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium text-rim-text">{legend}</legend>
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-rim-text hover:bg-white/5"
          >
            <input
              type="radio"
              name="delete-messages-period"
              value={option.id}
              checked={deletion.period === option.id}
              onChange={() => deletion.setPeriod(option.id)}
              className="accent-rim-accent"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {deletion.period !== "none" &&
        (counts.isPending ? (
          <p className="text-xs text-rim-text-muted">Counting messages…</p>
        ) : counts.isError ? (
          <p className="text-xs text-rim-danger">
            {asSentence(graphqlErrorMessage(counts.error, "Could not count their messages"))}
          </p>
        ) : (
          <CountsSummary deletion={deletion} />
        ))}
    </div>
  );
}

/** What the chosen period counts, and the private channels checkbox when they hold any. */
function CountsSummary({ deletion }: { deletion: MemberMessageDeletion }) {
  const data = deletion.counts.data;
  if (!data) return null;
  const { readable, unjoinedPrivate } = data.counts;
  if (readable.messages === 0 && unjoinedPrivate.messages === 0) {
    return <p className="text-sm text-rim-text">Nothing to delete.</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-sm text-rim-text">
        {readable.messages > 0 ? tallyText(readable) : "No messages in channels you can read."}
      </p>
      {deletion.offerPrivate && (
        <label className="flex items-center gap-2 text-sm text-rim-text">
          <input
            type="checkbox"
            className="accent-rim-accent"
            checked={deletion.includePrivate}
            onChange={(e) => deletion.setIncludePrivate(e.target.checked)}
          />
          Also private channels you&apos;re not in: {tallyText(unjoinedPrivate)}
        </label>
      )}
    </div>
  );
}
