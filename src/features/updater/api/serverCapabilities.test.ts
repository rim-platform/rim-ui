import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { hasCapability, MESSAGE_EDITED_AT, serverHasCapability } from "./serverCapabilities";

describe("hasCapability", () => {
  it("is true only for a capability the server info lists", () => {
    const info = fakeServerInfo({}, { capabilities: [MESSAGE_EDITED_AT] });
    expect(hasCapability(info, MESSAGE_EDITED_AT)).toBe(true);
    expect(hasCapability(info, "something_else")).toBe(false);
    expect(hasCapability(fakeServerInfo(), MESSAGE_EDITED_AT)).toBe(false);
    expect(hasCapability(undefined, MESSAGE_EDITED_AT)).toBe(false);
  });
});

describe("serverHasCapability", () => {
  afterEach(() => {
    queryClient.clear();
    requestMock.mockReset();
  });

  it("reads the cached server info", async () => {
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [MESSAGE_EDITED_AT] }),
    );
    await expect(serverHasCapability(MESSAGE_EDITED_AT)).resolves.toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches the server info once when it is not cached", async () => {
    requestMock.mockResolvedValue({
      serverInfo: { version: "0.0.5", apiVersion: 1, features: [], capabilities: [] },
    });
    await expect(serverHasCapability(MESSAGE_EDITED_AT)).resolves.toBe(false);
    await expect(serverHasCapability(MESSAGE_EDITED_AT)).resolves.toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("serverHasCapability is false when the server info cannot be read", async () => {
    requestMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(serverHasCapability(MESSAGE_EDITED_AT)).resolves.toBe(false);
  });
});
