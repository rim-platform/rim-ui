import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  sendEncryptedMessage: vi.fn(),
  editEncryptedMessage: vi.fn(),
  fetchConversationGroup: vi.fn(),
  fetchMessageAttachments: vi.fn(),
}));
const commands = vi.hoisted(() => ({
  encryptMessage: vi.fn(),
  reencryptMessage: vi.fn(),
  settleMessage: vi.fn(),
}));
const groups = vi.hoisted(() => ({
  catchUp: vi.fn(),
  commitPendingLocked: vi.fn(),
  createGroupLocked: vi.fn(async () => ({ created: true, notReady: [] as string[] })),
  invalidateTimeline: vi.fn(),
}));
const uploads = vi.hoisted(() => ({
  createAttachment: vi.fn(),
  finalizeAttachment: vi.fn(),
  uploadFileRest: vi.fn(),
}));
const encryptAttachment = vi.hoisted(() => vi.fn());
const fetchLinkPreview = vi.hoisted(() => vi.fn());

vi.mock("../api/e2eeApi", () => api);
vi.mock("../api/e2eeCommands", () => ({
  e2eeCommands: commands,
  encryptAttachment,
  fetchLinkPreview,
  E2eeCommandError: class extends Error {},
}));
vi.mock("./groups", () => ({
  ...groups,
  STALE_EPOCH: "STALE_EPOCH",
  MLS_COMMIT_REQUIRED: "MLS_COMMIT_REQUIRED",
  withConversation: (_id: string, task: () => Promise<unknown>) => task(),
}));
vi.mock("./session", () => ({
  e2eeSession: async () => ({
    account: { endpoint: "http://x/api", userId: "u-me" },
    userId: "u-me",
    principalId: "rimp1_me",
    deviceId: "dev-me",
  }),
}));
vi.mock("../../messages/api/useAttachments", () => uploads);

import { editEncrypted, EncryptedSendError, MEMBERS_NOT_READY, sendEncrypted } from "./send";

const author = { id: "u-me", username: "me", displayName: null, avatarUrl: null };

function outgoing(epoch: number) {
  return {
    messageId: "0199d1a0-0000-7000-8000-000000000002",
    incarnation: 1,
    epoch,
    envelope: `envelope-${epoch}`,
    threadRootMessageId: null,
    forwardedFromMessageId: null,
  };
}

function graphqlError(code: string) {
  return Object.assign(new Error(code), {
    response: { errors: [{ message: code, extensions: { code } }] },
  });
}

describe("sendEncrypted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchConversationGroup.mockResolvedValue({
      mlsGroup: { pendingRemoves: [] },
    });
    commands.encryptMessage.mockResolvedValue(outgoing(1));
    commands.settleMessage.mockResolvedValue({ unsentBody: null });
    fetchLinkPreview.mockResolvedValue(null);
  });

  it("stores the plaintext first, then sends the envelope under the chosen id", async () => {
    api.sendEncryptedMessage.mockResolvedValue({ id: outgoing(1).messageId });
    const id = await sendEncrypted("ws", "conv", { body: "hi <@rimp1_bob>", author });

    expect(id).toBe(outgoing(1).messageId);
    expect(groups.catchUp).toHaveBeenCalled();
    const draft = commands.encryptMessage.mock.calls[0][3];
    expect(draft).toMatchObject({ body: "hi <@rimp1_bob>", authorId: "u-me", attachments: [] });
    expect(api.sendEncryptedMessage).toHaveBeenCalledWith({
      serverId: "ws",
      conversationId: "conv",
      messageId: outgoing(1).messageId,
      envelope: "envelope-1",
      threadRootMessageId: null,
      forwardedFromMessageId: null,
    });
    expect(commands.settleMessage).toHaveBeenCalledWith(expect.anything(), outgoing(1).messageId, {
      id: outgoing(1).messageId,
    });
    expect(commands.encryptMessage.mock.invocationCallOrder[0]).toBeLessThan(
      api.sendEncryptedMessage.mock.invocationCallOrder[0],
    );
  });

  it("sends the same message again in the newer epoch after STALE_EPOCH", async () => {
    commands.reencryptMessage.mockResolvedValue(outgoing(2));
    api.sendEncryptedMessage
      .mockRejectedValueOnce(graphqlError("STALE_EPOCH"))
      .mockResolvedValueOnce({ id: outgoing(1).messageId });

    await sendEncrypted("ws", "conv", { body: "racing", author });

    expect(commands.reencryptMessage).toHaveBeenCalledWith(
      expect.anything(),
      outgoing(1).messageId,
    );
    expect(api.sendEncryptedMessage.mock.calls[1][0]).toMatchObject({
      messageId: outgoing(1).messageId,
      envelope: "envelope-2",
    });
  });

  it("commits pending removals first when the server asks for a Commit", async () => {
    commands.reencryptMessage.mockResolvedValue(outgoing(2));
    api.sendEncryptedMessage
      .mockRejectedValueOnce(graphqlError("MLS_COMMIT_REQUIRED"))
      .mockResolvedValueOnce({ id: outgoing(1).messageId });
    api.fetchConversationGroup
      .mockResolvedValueOnce({ mlsGroup: { pendingRemoves: [] } })
      .mockResolvedValueOnce({ mlsGroup: { pendingRemoves: [{ deviceId: "gone" }] } });

    await sendEncrypted("ws", "conv", { body: "after the removal", author });

    expect(groups.commitPendingLocked).toHaveBeenCalledTimes(1);
    expect(api.sendEncryptedMessage).toHaveBeenCalledTimes(2);
  });

  it("creates the group first when the encrypted conversation has none yet", async () => {
    api.fetchConversationGroup.mockResolvedValue({ mlsGroup: null });
    api.sendEncryptedMessage.mockResolvedValue({ id: outgoing(1).messageId });
    await sendEncrypted("ws", "conv", { body: "first", author });
    expect(groups.createGroupLocked).toHaveBeenCalledWith(expect.anything(), "ws", "conv");
  });

  it("stops before encrypting and names who has no device when the group cannot hold them", async () => {
    api.fetchConversationGroup.mockResolvedValue({ mlsGroup: null });
    groups.createGroupLocked.mockResolvedValueOnce({ created: false, notReady: ["Bob"] });

    const error = await sendEncrypted("ws", "conv", { body: "first", author }).catch((e) => e);

    expect(error).toBeInstanceOf(EncryptedSendError);
    expect(error.message).toBe("Bob has no device set up for encryption yet");
    expect(error.code).toBe(MEMBERS_NOT_READY);
    expect(commands.encryptMessage).not.toHaveBeenCalled();
  });

  it("undoes the stored plaintext and gives the body back when refused", async () => {
    api.sendEncryptedMessage.mockRejectedValue(graphqlError("VALIDATION"));
    commands.settleMessage.mockResolvedValue({ unsentBody: "nope" });

    const error = await sendEncrypted("ws", "conv", { body: "nope", author }).catch((e) => e);

    expect(error).toBeInstanceOf(EncryptedSendError);
    expect(error.unsentBody).toBe("nope");
    expect(commands.settleMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      outgoing(1).messageId,
      null,
    );
  });

  it("encrypts files before sending and uploads their blobs after", async () => {
    encryptAttachment.mockResolvedValue({ blob: new Uint8Array([1, 2, 3]), blobSha256: "hash" });
    api.sendEncryptedMessage.mockResolvedValue({ id: outgoing(1).messageId });
    uploads.createAttachment.mockResolvedValue({
      createAttachment: { attachmentId: "att-1", uploadToken: "tok" },
    });
    const file = new File(["secret"], "plan.txt", { type: "text/plain" });

    await sendEncrypted("ws", "conv", { body: "", author, files: [file] });

    expect(encryptAttachment).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "plan.txt",
      "text/plain",
    );
    expect(commands.encryptMessage.mock.calls[0][3].attachments).toEqual(["hash"]);
    expect(uploads.createAttachment).toHaveBeenCalledWith({
      serverId: "ws",
      conversationId: "conv",
      messageId: outgoing(1).messageId,
      filename: "encrypted",
      contentType: "application/octet-stream",
      sizeBytes: 3,
      blobSha256: "hash",
    });
    expect(uploads.uploadFileRest).toHaveBeenCalled();
    expect(uploads.finalizeAttachment).toHaveBeenCalledWith({
      attachmentId: "att-1",
      serverId: "ws",
    });
  });

  it("names the thread root and the reply target in the content", async () => {
    api.sendEncryptedMessage.mockResolvedValue({ id: outgoing(1).messageId });
    await sendEncrypted("ws", "conv", {
      body: "in thread",
      author,
      threadRootId: "root",
      threadId: "thread-1",
      replyTo: "parent",
    });
    expect(commands.encryptMessage.mock.calls[0][3]).toMatchObject({
      threadRootId: "root",
      threadId: "thread-1",
      replyTo: "parent",
    });
  });

  it("fetches link previews itself, for the content", async () => {
    fetchLinkPreview.mockResolvedValue({
      url: "https://example.com",
      title: "Example",
      description: null,
      siteName: null,
    });
    api.sendEncryptedMessage.mockResolvedValue({ id: outgoing(1).messageId });
    await sendEncrypted("ws", "conv", { body: "see https://example.com", author });
    expect(fetchLinkPreview).toHaveBeenCalledWith("https://example.com");
    expect(commands.encryptMessage.mock.calls[0][3].linkPreviews).toHaveLength(1);
  });
});

describe("editEncrypted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchConversationGroup.mockResolvedValue({ mlsGroup: { pendingRemoves: [] } });
    commands.encryptMessage.mockResolvedValue(outgoing(1));
    commands.settleMessage.mockResolvedValue({ unsentBody: null });
    fetchLinkPreview.mockResolvedValue(null);
  });

  it("sends the whole new content as an edit of the same message", async () => {
    api.editEncryptedMessage.mockResolvedValue({ id: outgoing(1).messageId });
    await editEncrypted("ws", "conv", outgoing(1).messageId, "better", author);
    expect(commands.encryptMessage.mock.calls[0][3]).toMatchObject({
      editOf: outgoing(1).messageId,
      body: "better",
    });
    expect(api.editEncryptedMessage).toHaveBeenCalledWith({
      serverId: "ws",
      conversationId: "conv",
      messageId: outgoing(1).messageId,
      envelope: "envelope-1",
    });
  });
});
