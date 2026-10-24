import { create } from "zustand";
import { useQueryClient } from "@tanstack/react-query";

import { onVaultLock } from "../../../core/accountVault/accountVault";
import { reportFeatureDisabled } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { requestCacheSync } from "../runtime/messageCacheSync";
import { uploadAttachments, type AttachmentUploadBatch } from "./attachmentUploads";

/** Failed uploads retained in memory while navigating the unlocked account. */
export const useAttachmentUploadStore = create<{
  failed: AttachmentUploadBatch[];
  busy: string[];
  generation: number;
}>(() => ({ failed: [], busy: [], generation: 0 }));
onVaultLock(() =>
  useAttachmentUploadStore.setState((state) => ({
    failed: [],
    busy: [],
    generation: state.generation + 1,
  })),
);

/** Upload retries retain their files and parent message until completed or explicitly dismissed. */
export function useAttachmentUploads(workspaceId: string, conversationId?: string) {
  const qc = useQueryClient();
  const { failed, busy, generation } = useAttachmentUploadStore();

  function remember(batch: AttachmentUploadBatch) {
    if (useAttachmentUploadStore.getState().generation !== generation) return;
    useAttachmentUploadStore.setState((state) => ({
      failed: state.failed.some((item) => item.messageId === batch.messageId)
        ? [...state.failed]
        : [...state.failed, batch],
    }));
  }

  function dismiss(messageId: string) {
    useAttachmentUploadStore.setState((state) => ({
      failed: state.failed.filter((item) => item.messageId !== messageId),
    }));
  }

  async function run(batch: AttachmentUploadBatch): Promise<void> {
    const active = () => useAttachmentUploadStore.getState().generation === generation;
    if (!active() || useAttachmentUploadStore.getState().busy.includes(batch.messageId)) return;
    useAttachmentUploadStore.setState((state) => ({ busy: [...state.busy, batch.messageId] }));
    try {
      await uploadAttachments(batch, active);
      if (!active()) return;
      dismiss(batch.messageId);
    } catch (err) {
      if (!active()) return;
      remember(batch);
      if (!reportFeatureDisabled(err, qc))
        toast.error("Message sent, but some files could not be uploaded. Retry the files below.");
    } finally {
      if (active()) {
        useAttachmentUploadStore.setState((state) => ({
          busy: state.busy.filter((id) => id !== batch.messageId),
        }));
        void qc.invalidateQueries({
          queryKey: queryKeys.messages(batch.workspaceId, batch.conversationId),
        });
        requestCacheSync(batch.workspaceId, [batch.conversationId]);
      }
    }
  }

  return {
    failed: failed.filter(
      (batch) =>
        batch.workspaceId === workspaceId &&
        (!conversationId || batch.conversationId === conversationId),
    ),
    busy,
    run,
    remember,
    dismiss,
  };
}
