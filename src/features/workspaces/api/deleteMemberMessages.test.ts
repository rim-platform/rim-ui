import { describe, expect, it, vi } from "vitest";

import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { MAX_DELETE_ROUNDS, deleteInRounds, type MemberMessagesDeleted } from "./useModeration";

/** A delete run that answers `answers` in order, repeating the last one. */
function rounds(answers: (() => MemberMessagesDeleted)[]) {
  let call = 0;
  return vi.fn(async () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return answer();
  });
}

function round(deleted: number, hasMore: boolean) {
  return () => ({ deleted, hasMore });
}

describe("deleteInRounds", () => {
  it("runs again while more remain and adds up what each run deleted", async () => {
    const run = rounds([round(1000, true), round(1000, true), round(42, false)]);

    await expect(deleteInRounds(run)).resolves.toEqual({ deleted: 2042, hasMore: false });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops after MAX_DELETE_ROUNDS runs and says more remain", async () => {
    const run = rounds([round(1000, true)]);

    await expect(deleteInRounds(run)).resolves.toEqual({
      deleted: 1000 * MAX_DELETE_ROUNDS,
      hasMore: true,
    });
    expect(run).toHaveBeenCalledTimes(MAX_DELETE_ROUNDS);
  });

  it("stops when a run deletes nothing though the server says more remain", async () => {
    const run = rounds([round(5, true), round(0, true)]);

    await expect(deleteInRounds(run)).resolves.toEqual({ deleted: 5, hasMore: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("passes the first refusal through unchanged", async () => {
    const refusal = graphqlError("FORBIDDEN", "permission denied");
    const run = rounds([
      () => {
        throw refusal;
      },
    ]);

    await expect(deleteInRounds(run)).rejects.toBe(refusal);
  });

  it("names what was already deleted when a later run fails", async () => {
    const run = rounds([
      round(1000, true),
      () => {
        throw graphqlError("FORBIDDEN", "permission denied");
      },
    ]);

    await expect(deleteInRounds(run)).rejects.toThrow(
      "Deleted 1000 messages, then: permission denied",
    );
  });
});
