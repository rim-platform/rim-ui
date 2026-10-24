import { graphqlErrorCode, graphqlErrorMessage, VALIDATION } from "../../../core/graphql/errors";
import { attachmentContentType } from "./attachmentTypes";
import {
  createAttachment,
  finalizeAttachment,
  uploadFileRest,
  type UploadTicket,
} from "./useAttachments";

export interface AttachmentUpload {
  file: File;
  displayName?: string;
  blobSha256?: string;
  ticket?: UploadTicket;
  attempted?: boolean;
  ready?: boolean;
}

/** Files belonging to one message that already exists on the server. */
export interface AttachmentUploadBatch {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  files: AttachmentUpload[];
}

/** Completes the remaining files without resending the parent message or completed files. */
export async function uploadAttachments(
  batch: AttachmentUploadBatch,
  active: () => boolean = () => true,
): Promise<void> {
  function checkActive() {
    if (!active()) throw new Error("Upload canceled because the account was locked");
  }
  for (const upload of batch.files) {
    checkActive();
    if (upload.ready) continue;
    if (upload.ticket && upload.attempted) {
      try {
        await finalizeAttachment({
          serverId: batch.workspaceId,
          attachmentId: upload.ticket.attachmentId,
        });
        upload.ready = true;
        continue;
      } catch (err) {
        if (
          graphqlErrorCode(err) !== VALIDATION ||
          graphqlErrorMessage(err, "") !== "attachment must be uploaded before finalizing"
        )
          throw err;
      }
    }
    if (upload.ticket?.expiresAt && Date.parse(upload.ticket.expiresAt) <= Date.now()) {
      upload.ticket = undefined;
      upload.attempted = false;
    }
    upload.ticket ??= (
      await createAttachment({
        serverId: batch.workspaceId,
        conversationId: batch.conversationId,
        messageId: batch.messageId,
        filename: upload.file.name,
        contentType: attachmentContentType(upload.file),
        sizeBytes: upload.file.size,
        blobSha256: upload.blobSha256,
      })
    ).createAttachment;
    checkActive();
    upload.attempted = true;
    const file = upload.file.type
      ? upload.file
      : new File([upload.file], upload.file.name, { type: attachmentContentType(upload.file) });
    await uploadFileRest(
      file,
      upload.ticket.uploadToken,
      upload.ticket.attachmentId,
      batch.workspaceId,
    );
    checkActive();
    await finalizeAttachment({
      serverId: batch.workspaceId,
      attachmentId: upload.ticket.attachmentId,
    });
    upload.ready = true;
  }
}
