import { memo, useEffect, useState } from "react";
import { Download, FileIcon, Loader2 } from "lucide-react";

import type { MessageAttachment } from "../../../core/types/messages";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { encryptedStoreAccount } from "../../messages/api/messageCache";
import {
  AUTO_MEDIA_BYTES,
  DownloadedMedia,
} from "../../messages/components/message-item/DownloadedMedia";
import { mediaKindOf } from "../../messages/components/message-item/mediaKind";
import type { MediaKind } from "../../messages/components/message-item/mediaKind";
import { useMessageDisplaySettingsStore } from "../../messages/state/useMessageDisplaySettingsStore";
import { fetchMessageAttachments } from "../api/e2eeApi";
import { decryptAttachment } from "../api/e2eeCommands";
import { downloadBlob } from "../runtime/send";

interface EncryptedAttachmentsProps {
  messageId: string;
  serverId: string;
  conversationId: string;
  attachments: MessageAttachment[];
  hasText: boolean;
}

/**
 * The server's id of an attachment's blob. The cached row may predate the upload; the server
 * is asked by blob hash then.
 */
async function uploadedId(
  props: EncryptedAttachmentsProps,
  attachment: MessageAttachment,
): Promise<string | null> {
  if (!attachment.id.startsWith("pending:") && attachment.status === "READY") return attachment.id;
  const uploads = await fetchMessageAttachments(
    props.serverId,
    props.conversationId,
    props.messageId,
  );
  const upload = uploads.find((u) => u.blobSha256 === attachment.blobSha256);
  return upload && upload.status === "READY" ? upload.id : null;
}

/** Download, check and decrypt one attachment: a blob URL of the file with its own type. */
async function openAttachment(
  props: EncryptedAttachmentsProps,
  attachment: MessageAttachment,
): Promise<string> {
  const account = encryptedStoreAccount();
  const id = await uploadedId(props, attachment);
  if (!account || !id || !attachment.blobSha256) throw new Error("The file is not uploaded yet");
  const blob = await downloadBlob(props.serverId, id);
  const plain = await decryptAttachment(account, props.messageId, attachment.blobSha256, blob);
  return URL.createObjectURL(new Blob([plain as BlobPart], { type: attachment.contentType }));
}

/**
 * An encrypted image or video: decrypted into an object URL, shown like any other inline
 * media and revoked on unmount. Files above the automatic size wait for a click.
 */
function EncryptedMedia({
  props,
  attachment,
  kind,
}: {
  props: EncryptedAttachmentsProps;
  attachment: MessageAttachment;
  kind: MediaKind;
}) {
  const [requested, setRequested] = useState(attachment.sizeBytes <= AUTO_MEDIA_BYTES);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!requested || attachment.status !== "READY") return;
    setFailed(false);
    let revoked = false;
    let created: string | null = null;
    openAttachment(props, attachment)
      .then((u) => {
        created = u;
        if (revoked) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch((err: unknown) => {
        logger.warn("[RIM:e2ee] an attachment could not be opened:", err);
        if (!revoked) setFailed(true);
      });
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
    // The attachment is identified by its hash; the props object changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, attachment.blobSha256, attachment.id, attachment.status]);
  return (
    <DownloadedMedia
      kind={kind}
      filename={attachment.filename}
      sizeBytes={attachment.sizeBytes}
      src={url}
      requested={requested}
      failed={failed}
      onRequest={() => setRequested(true)}
    />
  );
}

/** An encrypted message's attachments: decrypted on this device before anything is shown. */
export const EncryptedAttachments = memo(function EncryptedAttachments(
  props: EncryptedAttachmentsProps,
) {
  const [busy, setBusy] = useState<string | null>(null);
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);

  async function save(attachment: MessageAttachment) {
    setBusy(attachment.blobSha256 ?? attachment.id);
    try {
      const url = await openAttachment(props, attachment);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      toast.error("The file could not be opened", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", props.hasText ? "mt-2" : "mt-0.5")}>
      {props.attachments.map((attachment) => {
        const key = attachment.blobSha256 ?? attachment.id;
        const kind = showInlineMedia ? mediaKindOf(attachment.contentType) : null;
        if (kind) {
          return <EncryptedMedia key={key} props={props} attachment={attachment} kind={kind} />;
        }
        return (
          <button
            key={key}
            type="button"
            onClick={() => void save(attachment)}
            disabled={busy === key}
            className="flex w-fit items-center gap-2 rounded-lg border border-rim-line bg-rim-panel-soft px-3 py-2 text-xs text-rim-text hover:border-rim-accent/40"
          >
            <FileIcon className="h-4 w-4 text-rim-text-muted" aria-hidden />
            <span className="max-w-60 truncate">{attachment.filename}</span>
            <span className="text-rim-text-faint">{Math.ceil(attachment.sizeBytes / 1024)} KB</span>
            {busy === key ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
});
