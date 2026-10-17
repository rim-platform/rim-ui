import { describe, expect, it } from "vitest";

import { makeDmRequest } from "../__fixtures__/dmRequests";
import { requestWorkspaceId, type KnownSpaces } from "./requestWorkspace";

const known: KnownSpaces = {
  ownServerId: "rims1_relay",
  localWorkspaceIds: new Set(["ws-local"]),
  spaces: {
    "ws-remote": { hostServerId: "rims1_other", kind: "workspace" },
    "direct-remote": { hostServerId: "rims1_other", kind: "direct" },
  },
};

describe("requestWorkspaceId", () => {
  it("places a request in a workspace this relay hosts", () => {
    expect(requestWorkspaceId(makeDmRequest("r1", "rims1_relay", "ws-local"), known)).toBe(
      "ws-local",
    );
  });

  it("places a request in a workspace on another server only when that server hosts it", () => {
    expect(requestWorkspaceId(makeDmRequest("r1", "rims1_other", "ws-remote"), known)).toBe(
      "ws-remote",
    );
    // A host naming a workspace it does not hold, here or elsewhere, files no colleague's DM.
    expect(requestWorkspaceId(makeDmRequest("r2", "rims1_evil", "ws-remote"), known)).toBeNull();
    expect(requestWorkspaceId(makeDmRequest("r3", "rims1_evil", "ws-local"), known)).toBeNull();
  });

  it("reads a direct space, an unknown space or no held item as outside every workspace", () => {
    expect(requestWorkspaceId(makeDmRequest("r1", "rims1_relay", "direct-1"), known)).toBeNull();
    expect(
      requestWorkspaceId(makeDmRequest("r2", "rims1_other", "direct-remote"), known),
    ).toBeNull();
    expect(requestWorkspaceId(makeDmRequest("r3", "rims1_relay", "ws-gone"), known)).toBeNull();
    expect(
      requestWorkspaceId(makeDmRequest("r4", "rims1_relay", "ws-local", { heldItems: [] }), known),
    ).toBeNull();
  });
});
