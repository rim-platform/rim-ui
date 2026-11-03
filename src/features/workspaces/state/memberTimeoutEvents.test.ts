import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it } from "vitest";

import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { workspaceMembers } from "../../conversations/__fixtures__/conversations";
import type { ServerMember } from "../api/useServerMembers";
import { handleMemberTimeoutChanged } from "./memberEvents";
import { useTimeoutStore } from "./useTimeoutStore";

const until = "2030-01-01T10:00:00Z";
let qc: QueryClient;

function timeoutOf(userId: string): string | null | undefined {
  return qc
    .getQueryData<ServerMember[]>(queryKeys.serverMembers("workspace"))
    ?.find((m) => m.userId === userId)?.timeoutUntil;
}

beforeEach(() => {
  qc = new QueryClient();
  useAuthStore.setState({ session: { userId: "me" } });
  useTimeoutStore.setState({ byWorkspace: {} });
  qc.setQueryData(queryKeys.serverMembers("workspace"), workspaceMembers);
});

it("patches another member's timeout and leaves the viewer's reason unset", () => {
  const other = workspaceMembers.find((m) => m.userId !== "me")!.userId;
  handleMemberTimeoutChanged(qc, "workspace", other, until, "flooding");
  expect(timeoutOf(other)).toBe(until);
  expect(timeoutOf("me")).toBeNull();
  expect(qc.getQueryData(queryKeys.myTimeoutReason("workspace", until))).toBeUndefined();
  expect(qc.getQueryState(queryKeys.serverMembers("workspace"))?.isInvalidated).toBe(true);
});

it("patches the viewer's timeout, stores the reason and drops a noted timeout", () => {
  useTimeoutStore.getState().noteTimeout("workspace", until);
  handleMemberTimeoutChanged(qc, "workspace", "me", until, "flooding");
  expect(timeoutOf("me")).toBe(until);
  expect(qc.getQueryData(queryKeys.myTimeoutReason("workspace", until))).toBe("flooding");
  expect(useTimeoutStore.getState().byWorkspace.workspace).toBeUndefined();
});

it("clears the timeout when the event carries no end", () => {
  handleMemberTimeoutChanged(qc, "workspace", "me", until, null);
  handleMemberTimeoutChanged(qc, "workspace", "me", null);
  expect(timeoutOf("me")).toBeNull();
});
