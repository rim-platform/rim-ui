import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unlockTestVault } from "../../../test/accountVault";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { allRecords, putRecord, type DelegationRecord, type SpaceRecord } from "./relayDb";
import { forgetSpace, localSpaceHost } from "./spaces";
import { useRelayStore } from "./useRelayStore";

const SERVER = "rims1_here";
const DIRECT = "0199d1a0-0000-7000-8000-0000000000d1";
const WORKSPACE = "0199d1a0-0000-7000-8000-0000000000a1";

describe("localSpaceHost", () => {
  afterEach(() => {
    useRelayStore.setState({ info: null });
    queryClient.removeQueries({ queryKey: queryKeys.myServers() });
  });

  it("names this server for its direct space and the account's workspaces there only", () => {
    useRelayStore.setState({
      info: { serverId: SERVER, roles: ["host", "relay"], directSpaceId: DIRECT },
    });
    queryClient.setQueryData(queryKeys.myServers(), [{ id: WORKSPACE }]);

    expect(localSpaceHost(DIRECT)).toBe(SERVER);
    expect(localSpaceHost(WORKSPACE)).toBe(SERVER);
    expect(localSpaceHost("0199d1a0-0000-7000-8000-0000000000ff")).toBeNull();
  });

  it("names nothing before the relay started", () => {
    queryClient.setQueryData(queryKeys.myServers(), [{ id: WORKSPACE }]);
    expect(localSpaceHost(WORKSPACE)).toBeNull();
  });
});

describe("forgetSpace", () => {
  const ACCOUNT = "http://localhost:8080/api|rimp1_me";
  const space: SpaceRecord = {
    account: ACCOUNT,
    spaceId: "ws-acme",
    hostServerId: "rims1_host",
    kind: "workspace",
    name: "Acme",
  };

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    await unlockTestVault();
    useRelayStore.setState({
      account: {
        endpoint: "http://localhost:8080/api",
        userId: "u1",
        principalId: "rimp1_me",
        deviceId: "d1",
      },
      spaces: { "ws-acme": space },
    });
  });

  afterEach(() => useRelayStore.getState().reset());

  it("drops the space and its delegation, and a second call is a no-op", async () => {
    await putRecord("spaces", space);
    await putRecord("delegations", {
      account: ACCOUNT,
      workspaceId: "ws-acme",
    } as unknown as DelegationRecord);
    useRelayStore
      .getState()
      .setMissing({ spaceId: "ws-acme", hostServerId: "rims1_host", since: 1 });

    await forgetSpace("ws-acme");

    expect(useRelayStore.getState().spaces).toEqual({});
    expect(useRelayStore.getState().missing).toEqual({});
    expect(await allRecords<SpaceRecord>("spaces")).toEqual([]);
    expect(await allRecords("delegations")).toEqual([]);
    await expect(forgetSpace("ws-acme")).resolves.toBeUndefined();
  });
});
