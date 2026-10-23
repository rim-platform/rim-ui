import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it } from "vitest";

import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { handleMemberProfileUpdated } from "./memberEvents";

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  useAuthStore.setState({ session: { userId: "me" } });
  for (const key of [
    queryKeys.me,
    queryKeys.serverMembers("workspace"),
    queryKeys.messages("workspace", "channel"),
    queryKeys.threadMessages("workspace", "channel", "thread"),
    queryKeys.messages("other", "channel"),
  ])
    qc.setQueryData(key, {});
});

it("refreshes member and message pictures only in the changed workspace", () => {
  handleMemberProfileUpdated(qc, "workspace", "another-person");
  expect(qc.getQueryState(queryKeys.serverMembers("workspace"))?.isInvalidated).toBe(true);
  expect(qc.getQueryState(queryKeys.messages("workspace", "channel"))?.isInvalidated).toBe(true);
  expect(
    qc.getQueryState(queryKeys.threadMessages("workspace", "channel", "thread"))?.isInvalidated,
  ).toBe(true);
  expect(qc.getQueryState(queryKeys.me)?.isInvalidated).toBe(false);
  expect(qc.getQueryState(queryKeys.messages("other", "channel"))?.isInvalidated).toBe(false);
});

it("also refreshes this account's own profile for an update from another session", () => {
  handleMemberProfileUpdated(qc, "workspace", "me");
  expect(qc.getQueryState(queryKeys.me)?.isInvalidated).toBe(true);
});
