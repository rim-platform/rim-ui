import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { localSpaceHost } from "./spaces";
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
