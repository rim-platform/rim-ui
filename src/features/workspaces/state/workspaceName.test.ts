import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const spaces = vi.hoisted(() => ({ setSpaceDetails: vi.fn(async () => undefined) }));
vi.mock("../../relay/state/spaces", () => ({ setSpaceDetails: spaces.setSpaceDetails }));

import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { applyWorkspaceName } from "./workspaceName";

describe("applyWorkspaceName", () => {
  function client() {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.myServers(), [
      { id: "ws-1", name: "Acme" },
      { id: "ws-2", name: "Beta" },
    ]);
    qc.setQueryData(queryKeys.server("ws-1"), { id: "ws-1", name: "Acme", viewerRole: "OWNER" });
    return qc;
  }

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => useRelayStore.getState().reset());

  it("updates the workspace list and the workspace query, not the stored space of a local one", () => {
    const qc = client();
    applyWorkspaceName(qc, "ws-1", "Acme Two");
    expect(qc.getQueryData(queryKeys.myServers())).toEqual([
      { id: "ws-1", name: "Acme Two" },
      { id: "ws-2", name: "Beta" },
    ]);
    expect(qc.getQueryData(queryKeys.server("ws-1"))).toEqual({
      id: "ws-1",
      name: "Acme Two",
      viewerRole: "OWNER",
    });
    expect(spaces.setSpaceDetails).not.toHaveBeenCalled();
  });

  it("stores the name of a space on another server", () => {
    useRelayStore.setState({
      spaces: {
        "ws-1": { account: "a", spaceId: "ws-1", hostServerId: "rims1_h", kind: "workspace" },
      },
    });
    applyWorkspaceName(client(), "ws-1", "Acme Two");
    expect(spaces.setSpaceDetails).toHaveBeenCalledWith("ws-1", { name: "Acme Two" });
  });
});
