import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { useRelayStore } from "../../relay/state/useRelayStore";
import {
  BOT_DISCLOSURE,
  botDisclosureDocument,
  hasCapability,
  MESSAGE_EDITED_AT,
  MESSAGE_FLAG,
  messageReadDocument,
  READ_MARKER,
  serverHasCapability,
  spaceHasCapability,
} from "./serverCapabilities";

describe("hasCapability", () => {
  it("is true only for a capability the server info lists", () => {
    const info = fakeServerInfo({}, { capabilities: [MESSAGE_EDITED_AT] });
    expect(hasCapability(info, MESSAGE_EDITED_AT)).toBe(true);
    expect(hasCapability(info, "something_else")).toBe(false);
    expect(hasCapability(fakeServerInfo(), MESSAGE_EDITED_AT)).toBe(false);
    expect(hasCapability(undefined, MESSAGE_EDITED_AT)).toBe(false);
  });
});

describe("spaceHasCapability", () => {
  afterEach(() => {
    queryClient.clear();
    requestMock.mockReset();
    useRelayStore.setState({ spaces: {} });
  });

  function hostedElsewhere(spaceId: string, host: string) {
    useRelayStore.setState({
      spaces: { [spaceId]: { account: "a", spaceId, hostServerId: host, kind: "workspace" } },
    });
  }

  it("reads the connected server for a space it hosts", async () => {
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [READ_MARKER] }),
    );
    await expect(spaceHasCapability("local", READ_MARKER)).resolves.toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("asks the host of a space elsewhere, routed by the space's id, and keeps the answer", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities: [] }));
    hostedElsewhere("remote", "host-1");
    requestMock.mockResolvedValue({ serverInfo: { capabilities: [READ_MARKER] } });

    await expect(spaceHasCapability("remote", READ_MARKER)).resolves.toBe(true);
    await expect(spaceHasCapability("remote", READ_MARKER)).resolves.toBe(true);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][1]).toEqual({ workspaceId: "remote" });
  });

  it("is false for a host that refuses the question", async () => {
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [READ_MARKER] }),
    );
    hostedElsewhere("remote", "old-host");
    requestMock.mockRejectedValue(new Error("Unknown field capabilities"));
    await expect(spaceHasCapability("remote", READ_MARKER)).resolves.toBe(false);
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

describe("messageReadDocument", () => {
  afterEach(() => {
    queryClient.clear();
  });

  const documents = { plain: "plain", withEdits: "edits", withFlags: "flags", withBots: "bots" };

  it("picks the newest document the server's capabilities allow", async () => {
    const cases = [
      { capabilities: [MESSAGE_EDITED_AT, MESSAGE_FLAG, BOT_DISCLOSURE], document: "bots" },
      { capabilities: [MESSAGE_EDITED_AT, MESSAGE_FLAG], document: "flags" },
      { capabilities: [MESSAGE_EDITED_AT], document: "edits" },
      { capabilities: [], document: "plain" },
    ];
    for (const { capabilities, document } of cases) {
      queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
      await expect(messageReadDocument(documents)).resolves.toBe(document);
    }
  });
});

describe("botDisclosureDocument", () => {
  afterEach(() => {
    queryClient.clear();
  });

  it("asks for the bot fields only of a server that lists bot_disclosure", async () => {
    const documents = { plain: "plain", withBots: "bots" };
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [BOT_DISCLOSURE] }),
    );
    await expect(botDisclosureDocument(documents)).resolves.toBe("bots");
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities: [] }));
    await expect(botDisclosureDocument(documents)).resolves.toBe("plain");
  });
});
