import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("../../../core/graphql/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/graphql/client")>()),
  graphqlClient: { request: (...args: unknown[]) => request(...args) },
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { RELATIVE_BAN_REFUSAL, relativeBanRefusal } from "./relativeBanGuard";

afterEach(() => {
  queryClient.clear();
  request.mockReset();
});

describe("relativeBanRefusal", () => {
  it("refuses a ban for a number of minutes to a server that does not list them", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["home_layout"] });

    await expect(
      relativeBanRefusal("admin.ban", { user_id: "u-1", minutes: 60 }, "ws-1"),
    ).resolves.toBe(RELATIVE_BAN_REFUSAL);
  });

  it("refuses it while the server's capabilities can't be read", async () => {
    request.mockRejectedValue(new Error("offline"));

    await expect(relativeBanRefusal("admin.ban", { minutes: 60 }, undefined)).resolves.toBe(
      RELATIVE_BAN_REFUSAL,
    );
  });

  it("lets it through to a server that lists them", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["command_relative_minutes"] });

    await expect(relativeBanRefusal("admin.ban", { minutes: 60 }, "ws-1")).resolves.toBeNull();
  });

  it("never asks about a ban without minutes or another command", async () => {
    await expect(
      relativeBanRefusal("admin.ban", { expires_at: "2999-01-01T00:00:00Z" }, "ws-1"),
    ).resolves.toBeNull();
    await expect(
      relativeBanRefusal(
        "notifications.mute_conversation",
        { duration: "minutes", minutes: 5 },
        "ws-1",
      ),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
