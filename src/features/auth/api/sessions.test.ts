import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { logoutOtherSessions } from "./sessions";

describe("logoutOtherSessions", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sends the mutation and resolves to how many sessions ended", async () => {
    requestMock.mockResolvedValue({ logoutOtherSessions: 2 });

    await expect(logoutOtherSessions()).resolves.toBe(2);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(String(requestMock.mock.calls[0][0])).toMatch(
      /mutation LogoutOtherSessions\s*{\s*logoutOtherSessions\s*}/,
    );
  });

  it("passes a server error on", async () => {
    const error = new Error("UNAUTHENTICATED");
    requestMock.mockRejectedValue(error);

    await expect(logoutOtherSessions()).rejects.toBe(error);
  });
});
