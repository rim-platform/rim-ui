import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { MAX_DELETE_ROUNDS, deleteAllMemberMessages } from "./useModeration";

const VARS = {
  serverId: "ws-1",
  userId: "u-alice",
  since: "2026-10-04T10:00:00.000Z",
  includeUnjoinedPrivate: true,
};

/** Serves `deleteMemberMessages` with `answers` in order, repeating the last one. */
function serveRounds(answers: (() => unknown)[]) {
  let call = 0;
  routeRequests(requestMock, {
    "mutation DeleteMemberMessages": () => {
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      return answer();
    },
  });
}

function round(deleted: number, hasMore: boolean) {
  return () => ({ deleteMemberMessages: { deleted, channels: 1, hasMore } });
}

describe("deleteAllMemberMessages", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("calls again while more remain and adds up what each call deleted", async () => {
    serveRounds([round(1000, true), round(1000, true), round(42, false)]);

    await expect(deleteAllMemberMessages(VARS)).resolves.toEqual({
      deleted: 2042,
      hasMore: false,
    });
    const calls = callsTo(requestMock, "mutation DeleteMemberMessages");
    expect(calls).toHaveLength(3);
    for (const vars of calls) expect(vars).toEqual(VARS);
  });

  it("stops after MAX_DELETE_ROUNDS calls and says more remain", async () => {
    serveRounds([round(1000, true)]);

    await expect(deleteAllMemberMessages(VARS)).resolves.toEqual({
      deleted: 1000 * MAX_DELETE_ROUNDS,
      hasMore: true,
    });
    expect(callsTo(requestMock, "mutation DeleteMemberMessages")).toHaveLength(MAX_DELETE_ROUNDS);
  });

  it("stops when a call deletes nothing though the server says more remain", async () => {
    serveRounds([round(5, true), round(0, true)]);

    await expect(deleteAllMemberMessages(VARS)).resolves.toEqual({ deleted: 5, hasMore: true });
    expect(callsTo(requestMock, "mutation DeleteMemberMessages")).toHaveLength(2);
  });

  it("passes the first refusal through unchanged", async () => {
    const refusal = graphqlError("FORBIDDEN", "permission denied");
    serveRounds([
      () => {
        throw refusal;
      },
    ]);

    await expect(deleteAllMemberMessages(VARS)).rejects.toBe(refusal);
  });

  it("names what was already deleted when a later call fails", async () => {
    serveRounds([
      round(1000, true),
      () => {
        throw graphqlError("FORBIDDEN", "permission denied");
      },
    ]);

    await expect(deleteAllMemberMessages(VARS)).rejects.toThrow(
      "Deleted 1000 messages, then: permission denied",
    );
  });
});
