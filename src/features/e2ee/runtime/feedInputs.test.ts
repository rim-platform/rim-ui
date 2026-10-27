import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchCommits: vi.fn(), fetchThreadRoot: vi.fn() }));
const status = vi.hoisted(() => vi.fn());
vi.mock("../api/e2eeApi", () => api);
vi.mock("../api/e2eeCommands", () => ({ e2eeCommands: { status } }));

import type { FeedConversationChanges } from "../../messages/api/messageCache";
import type { MessageItem } from "../../../core/types/messages";
import { forgetAbsence, mlsInputsFor, noteAbsentFromGroup } from "./feedInputs";

const account = { endpoint: "http://x/api", userId: "u" };

function entry(id: string, encrypted: boolean, threadId: string | null = null) {
  return {
    kind: "CREATED",
    version: "1",
    editedAt: null,
    message: {
      id,
      threadId,
      encryption: encrypted ? { incarnation: 1, epoch: 3 } : null,
    } as unknown as MessageItem,
  };
}

function page(conversationId: string, changes: ReturnType<typeof entry>[]) {
  return {
    conversationId,
    status: "OK",
    cursor: "1",
    hasMore: false,
    changes,
  } as unknown as FeedConversationChanges;
}

describe("mlsInputsFor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetAbsence("c1");
  });

  it("fetches Commits from the group's local epoch and the roots of thread replies", async () => {
    status.mockResolvedValue([{ conversationId: "c1", hasGroup: true, incarnation: 1, epoch: 2 }]);
    api.fetchCommits.mockResolvedValue([
      { id: "x", incarnation: 1, epoch: 2, message: "commit-2", senderPrincipalId: null },
    ]);
    api.fetchThreadRoot.mockResolvedValue("root-1");

    const inputs = await mlsInputsFor(account, "ws", [
      page("c1", [entry("m1", true, "thread-a"), entry("m2", true, "thread-a")]),
      page("plain", [entry("m3", false)]),
    ]);

    expect(api.fetchCommits).toHaveBeenCalledWith("ws", "c1", 1, 2);
    expect(api.fetchThreadRoot).toHaveBeenCalledTimes(1);
    expect(inputs).toEqual([
      {
        conversationId: "c1",
        commits: [{ incarnation: 1, epoch: 2, message: "commit-2" }],
        threadRoots: { "thread-a": "root-1" },
      },
    ]);
  });

  it("asks nothing for a conversation the feed answered NO_ACCESS", async () => {
    status.mockResolvedValue([
      { conversationId: "left", hasGroup: true, incarnation: 1, epoch: 1 },
      { conversationId: "c1", hasGroup: true, incarnation: 1, epoch: 2 },
    ]);
    api.fetchCommits.mockImplementation((_ws: string, conversationId: string) =>
      conversationId === "left"
        ? Promise.reject(new Error("permission denied"))
        : Promise.resolve([]),
    );
    const left = { ...page("left", []), status: "NO_ACCESS" } as FeedConversationChanges;

    const inputs = await mlsInputsFor(account, "ws", [left, page("c1", [entry("m1", true)])]);

    expect(api.fetchCommits).toHaveBeenCalledTimes(1);
    expect(api.fetchCommits).toHaveBeenCalledWith("ws", "c1", 1, 2);
    expect(inputs.map((i) => i.conversationId)).toEqual(["c1"]);
  });

  it("says when this device is known to be absent from the server's group", async () => {
    status.mockResolvedValue([]);
    noteAbsentFromGroup("c1", 2);
    const [input] = await mlsInputsFor(account, "ws", [page("c1", [entry("m1", true)])]);
    expect(input).toMatchObject({ inGroup: false, serverIncarnation: 2, commits: [] });
  });
});
