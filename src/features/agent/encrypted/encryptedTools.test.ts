import { describe, expect, it, vi } from "vitest";

import type { PluginChatMessage } from "../../plugins/chat/chatTypes";
import { USER_CANCELLED_MESSAGE } from "../runtime/confirmationGate";
import { AGENT_OFF_MESSAGE, routeEncrypted, type EncryptedToolDeps } from "./encryptedTools";

const WS = "ws-1";
const SECRET = "c-secret";
const OPEN = "c-open";

function message(id: string, conversationId: string, encrypted: boolean): PluginChatMessage {
  return {
    id,
    conversationId,
    threadId: null,
    author: { principalId: "rimp1_ada", displayName: "Ada" },
    text: `text of ${id}`,
    sentAt: "2026-10-01T09:00:00Z",
    editedAt: null,
    encrypted,
    attachments: [],
  };
}

function setup(overrides: Partial<EncryptedToolDeps> = {}) {
  const allowed = new Set<string>();
  const deps: EncryptedToolDeps = {
    workspaceId: () => WS,
    encrypted: vi.fn(async (_ws: string, id: string) => id === SECRET),
    allowed: (id) => allowed.has(id),
    list: vi.fn(async () => ({ messages: [message("m1", SECRET, true)], hasOlder: false })),
    search: vi.fn(async () => [message("m1", SECRET, true), message("m2", OPEN, false)]),
    post: vi.fn(async () => "m-new"),
    confirmPost: vi.fn(async () => true),
    upgrade: vi.fn(async () => {}),
    ...overrides,
  };
  const backend = vi.fn(async (input: Record<string, unknown>) =>
    JSON.stringify({ from: "server", input }),
  );
  return { deps, backend, allowed };
}

describe("the agent's chat tools in encrypted conversations", () => {
  it("leaves plaintext conversations and other commands to the server", async () => {
    const { deps, backend } = setup();
    const recent = routeEncrypted("chat.get_recent_messages", backend, deps);
    await recent({ server_id: WS, conversation_id: OPEN });
    expect(backend).toHaveBeenCalledTimes(1);
    expect(deps.list).not.toHaveBeenCalled();
    expect(routeEncrypted("chat.list_channels", backend, deps)).toBe(backend);
  });

  it("refuses an encrypted conversation the agent is off in, without reading it", async () => {
    const { deps, backend } = setup();
    for (const command of [
      "chat.get_recent_messages",
      "chat.search_messages",
      "chat.post_message",
    ]) {
      await expect(
        routeEncrypted(
          command,
          backend,
          deps,
        )({
          server_id: WS,
          conversation_id: SECRET,
          query: "x",
          text: "hi",
        }),
      ).rejects.toThrow(AGENT_OFF_MESSAGE);
    }
    expect(backend).not.toHaveBeenCalled();
    expect(deps.list).not.toHaveBeenCalled();
    expect(deps.search).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
  });

  it("reads recent messages from this device once the agent is on, never the server", async () => {
    const { deps, backend, allowed } = setup();
    allowed.add(SECRET);
    const result = await routeEncrypted(
      "chat.get_recent_messages",
      backend,
      deps,
    )({
      server_id: WS,
      conversation_id: SECRET,
      limit: "500",
    });
    expect(JSON.parse(result)).toEqual({
      messages: [{ author: "Ada", text: "text of m1", sentAt: "2026-10-01T09:00:00Z" }],
    });
    expect(deps.list).toHaveBeenCalledWith(WS, SECRET, 100);
    expect(backend).not.toHaveBeenCalled();
  });

  it("searches an encrypted conversation locally, and adds local hits to a server-wide search", async () => {
    const { deps, backend, allowed } = setup();
    allowed.add(SECRET);
    const search = routeEncrypted("chat.search_messages", backend, deps);
    const scoped = JSON.parse(
      await search({ server_id: WS, conversation_id: SECRET, query: "plan" }),
    );
    expect(scoped.results.map((r: { id: string }) => r.id)).toEqual(["m1", "m2"]);
    expect(deps.search).toHaveBeenCalledWith(WS, "plan", SECRET, 10);
    expect(backend).not.toHaveBeenCalled();

    backend.mockResolvedValueOnce(JSON.stringify({ results: [{ id: "s1" }] }));
    const wide = JSON.parse(await search({ server_id: WS, query: "plan" }));
    // The server's hit, then only the encrypted hits of conversations the agent is on in.
    expect(wide.results.map((r: { id: string }) => r.id)).toEqual(["s1", "m1"]);
    expect(wide.results[1].source).toBe("this device");

    allowed.clear();
    backend.mockResolvedValueOnce(JSON.stringify({ results: [{ id: "s1" }] }));
    expect(JSON.parse(await search({ server_id: WS, query: "plan" })).results).toEqual([
      { id: "s1" },
    ]);
  });

  it("posts into an encrypted conversation through the encrypted send path, after the person confirms", async () => {
    const { deps, backend, allowed } = setup();
    allowed.add(SECRET);
    const post = routeEncrypted("chat.post_message", backend, deps);
    const result = await post({ server_id: WS, conversation_id: SECRET, text: "hello" });
    expect(JSON.parse(result)).toEqual({ message_id: "m-new", conversation_id: SECRET });
    expect(deps.post).toHaveBeenCalledWith({
      workspaceId: WS,
      conversationId: SECRET,
      body: "hello",
      threadId: null,
      encrypted: true,
    });
    expect(backend).not.toHaveBeenCalled();

    vi.mocked(deps.confirmPost).mockResolvedValueOnce(false);
    expect(await post({ server_id: WS, conversation_id: SECRET, text: "again" })).toBe(
      USER_CANCELLED_MESSAGE,
    );
    expect(deps.post).toHaveBeenCalledTimes(1);
  });

  it("upgrades a group it creates, as the desktop upgrades any plaintext group", async () => {
    const { deps, backend } = setup();
    backend.mockResolvedValueOnce(JSON.stringify({ conversation_id: "c-new" }));
    const create = routeEncrypted("chat.create_group", backend, deps);
    expect(await create({ server_id: WS, member_ids: ["u-1"] })).toBe(
      JSON.stringify({ conversation_id: "c-new" }),
    );
    expect(deps.upgrade).toHaveBeenCalledWith(WS, "c-new");

    // An upgrade that fails leaves the created group to be upgraded when it is opened.
    backend.mockResolvedValueOnce(JSON.stringify({ conversation_id: "c-2" }));
    vi.mocked(deps.upgrade).mockRejectedValueOnce(new Error("not ready"));
    await expect(create({ server_id: WS, member_ids: [] })).resolves.toContain("c-2");
  });
});
