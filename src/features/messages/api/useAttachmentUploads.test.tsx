import { beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { unlockTestVault } from "../../../test/accountVault";
import { lockVault } from "../../../core/accountVault/accountVault";
import { uploadAttachments, type AttachmentUploadBatch } from "./attachmentUploads";
import { useAttachmentUploads, useAttachmentUploadStore } from "./useAttachmentUploads";

vi.mock("./attachmentUploads", () => ({ uploadAttachments: vi.fn() }));
vi.mock("../runtime/messageCacheSync", () => ({ requestCacheSync: vi.fn() }));

beforeEach(async () => {
  await unlockTestVault();
  useAttachmentUploadStore.setState({ failed: [], busy: [] });
});

it("drops files on account lock and ignores a late upload failure", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(uploadAttachments).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const client = createTestQueryClient();
  const { result } = renderHook(() => useAttachmentUploads("workspace", "conversation"), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const batch: AttachmentUploadBatch = {
    workspaceId: "workspace",
    conversationId: "conversation",
    messageId: "message",
    files: [{ file: new File(["private"], "private.txt") }],
  };
  act(() => result.current.remember(batch));
  expect(result.current.failed).toHaveLength(1);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.run(batch);
  });
  act(() => lockVault());
  await act(async () => {
    reject(new Error("disconnected"));
    await pending;
  });
  expect(result.current.failed).toEqual([]);
  expect(result.current.busy).toEqual([]);
});
