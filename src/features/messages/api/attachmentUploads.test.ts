import { beforeEach, describe, expect, it, vi } from "vitest";

import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { attachmentProblem, MAX_ATTACHMENT_BYTES } from "./attachmentTypes";
import { uploadAttachments, type AttachmentUploadBatch } from "./attachmentUploads";
import { createAttachment, finalizeAttachment, uploadFileRest } from "./useAttachments";

vi.mock("./useAttachments", () => ({
  createAttachment: vi.fn(),
  finalizeAttachment: vi.fn(),
  uploadFileRest: vi.fn(),
}));

function batch(): AttachmentUploadBatch {
  return {
    workspaceId: "remote-space",
    conversationId: "conversation",
    messageId: "delivered-message",
    files: ["one.txt", "two.txt"].map((name) => ({ file: new File(["file"], name) })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createAttachment).mockImplementation(async ({ filename }) => ({
    createAttachment: {
      attachmentId: filename,
      uploadToken: "token",
      expiresAt: null,
      maxSizeBytes: null,
    },
  }));
  vi.mocked(uploadFileRest).mockResolvedValue();
  vi.mocked(finalizeAttachment).mockResolvedValue({});
});

describe("attachment uploads", () => {
  it("retains partial progress and retries only the unfinished file on the same workspace", async () => {
    const pending = batch();
    vi.mocked(uploadFileRest)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("disconnected"));
    await expect(uploadAttachments(pending)).rejects.toThrow("disconnected");
    expect(pending.files.map((file) => Boolean(file.ready))).toEqual([true, false]);
    vi.mocked(finalizeAttachment).mockRejectedValueOnce(
      graphqlError("VALIDATION", "attachment must be uploaded before finalizing"),
    );
    await uploadAttachments(pending);
    expect(createAttachment).toHaveBeenCalledTimes(2);
    expect(uploadFileRest).toHaveBeenCalledTimes(3);
    expect(uploadFileRest).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "two.txt", type: "text/plain" }),
      "token",
      "two.txt",
      "remote-space",
    );
    expect(pending.files.every((file) => file.ready)).toBe(true);
  });

  it("recognizes an uploaded file after its upload response was lost", async () => {
    const pending = batch();
    pending.files = pending.files.slice(0, 1);
    vi.mocked(uploadFileRest).mockRejectedValueOnce(new Error("response lost"));
    await expect(uploadAttachments(pending)).rejects.toThrow();
    await uploadAttachments(pending);
    expect(createAttachment).toHaveBeenCalledTimes(1);
    expect(uploadFileRest).toHaveBeenCalledTimes(1);
    expect(pending.files[0].ready).toBe(true);
  });

  it("replaces an expired pending ticket after checking whether it completed", async () => {
    const pending = batch();
    pending.files = [
      {
        file: pending.files[0].file,
        ticket: {
          attachmentId: "expired",
          uploadToken: "old",
          expiresAt: "2000-01-01T00:00:00Z",
          maxSizeBytes: null,
        },
        attempted: true,
      },
    ];
    vi.mocked(finalizeAttachment).mockRejectedValueOnce(
      graphqlError("VALIDATION", "attachment must be uploaded before finalizing"),
    );
    await uploadAttachments(pending);
    expect(createAttachment).toHaveBeenCalledTimes(1);
    expect(uploadFileRest).toHaveBeenCalledWith(
      expect.any(File),
      "token",
      "one.txt",
      "remote-space",
    );
  });

  it("rejects unsupported or oversized files before sending and accounts for encryption overhead", () => {
    expect(
      attachmentProblem(new File(["video"], "clip.mp4", { type: "video/mp4" }), false),
    ).toBeNull();
    expect(
      attachmentProblem(new File(["audio"], "clip.ogg", { type: "audio/ogg" }), false),
    ).toBeNull();
    const binary = new File(["binary"], "program.exe", { type: "application/octet-stream" });
    expect(attachmentProblem(binary, false)).toContain("unsupported");
    expect(attachmentProblem(binary, true)).toBeNull();
    const maximum = new File([new Uint8Array(MAX_ATTACHMENT_BYTES)], "photo.png", {
      type: "image/png",
    });
    expect(attachmentProblem(maximum, false)).toBeNull();
    expect(attachmentProblem(maximum, true)).toContain("larger");
  });
});
