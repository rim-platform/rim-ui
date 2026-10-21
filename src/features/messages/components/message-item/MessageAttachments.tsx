import { memo, useEffect, useRef, useState } from "react";
import { AlertCircle, Download, FileIcon, Loader2, Trash2 } from "lucide-react";

import { getApiOrigin } from "../../../../core/graphql/config";
import { loadsAsBlob, useServerMedia } from "../../../../shared/media/serverMedia";
import { toast } from "../../../../shared/toast/useToastStore";
import { cn } from "../../../../shared/ui/cn";
import type { DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { IsolatedMenu } from "../../../../shared/ui/contextMenu/IsolatedMenu";
import { followLink } from "../../../../shared/ui/contextMenu/menuActions";
import { useContextMenu } from "../../../../shared/ui/contextMenu/useContextMenu";
import { useDeleteAttachmentMutation } from "../../api/useAttachments";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";
import { AUTO_MEDIA_BYTES, DownloadedMedia } from "./DownloadedMedia";
import { InlineMedia } from "./InlineMedia";
import { mediaKindOf } from "./mediaKind";
import type { MediaKind } from "./mediaKind";
import type { MessageAttachment } from "../../../../core/types/messages";

const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export const MessageAttachments = memo(function MessageAttachments({
  attachments,
  hasText,
  serverId,
}: {
  attachments: MessageAttachment[];
  hasText: boolean;
  serverId?: string;
}) {
  const baseUrl = getApiOrigin();
  const deleteAttachment = useDeleteAttachmentMutation();
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);
  const contextMenu = useContextMenu();

  // When each attachment was first seen uploading, for the client-side timeout
  const uploadTimestamps = useRef<Map<string, number>>(new Map());
  const [timedOutIds, setTimedOutIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const now = Date.now();
    const uploading: string[] = [];

    for (const att of attachments) {
      const isUploading = att.status === "PENDING_UPLOAD" || att.status === "UPLOADED";
      if (isUploading) {
        if (!uploadTimestamps.current.has(att.id)) {
          uploadTimestamps.current.set(att.id, now);
        }
        uploading.push(att.id);
      } else {
        uploadTimestamps.current.delete(att.id);
      }
    }

    if (uploading.length === 0) return;

    // Calculate earliest timeout
    let earliest = Infinity;
    for (const id of uploading) {
      const started = uploadTimestamps.current.get(id) ?? now;
      const remaining = UPLOAD_TIMEOUT_MS - (now - started);
      if (remaining <= 0) {
        // Already timed out
        setTimedOutIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      } else {
        earliest = Math.min(earliest, remaining);
      }
    }

    if (earliest === Infinity) return;

    const timer = setTimeout(() => {
      const checkTime = Date.now();
      setTimedOutIds((prev) => {
        const next = new Set(prev);
        for (const id of uploading) {
          const started = uploadTimestamps.current.get(id);
          if (started && checkTime - started >= UPLOAD_TIMEOUT_MS) {
            next.add(id);
          }
        }
        return next.size !== prev.size ? next : prev;
      });
    }, earliest);

    return () => clearTimeout(timer);
  }, [attachments]);

  function handleDelete(attachmentId: string) {
    if (!serverId) return;
    deleteAttachment.mutate(
      { attachmentId, serverId },
      {
        onError: () => toast.error("Failed to remove attachment"),
      },
    );
  }

  /**
   * A file attachment's menu: Open and Download once it is uploaded, Delete attachment when
   * its upload failed. An attachment still uploading has none, so the message's menu opens.
   */
  function fileMenuItems(
    att: MessageAttachment,
    downloadUrl: string | null,
    canDelete: boolean,
  ): DropdownMenuItem[] {
    const items: DropdownMenuItem[] = [];
    if (downloadUrl) {
      items.push(
        { id: "open-attachment", label: "Open", onSelect: () => followLink(downloadUrl) },
        {
          id: "download-attachment",
          label: "Download",
          onSelect: () => followLink(downloadUrl, att.filename),
        },
      );
    }
    if (canDelete) {
      items.push({
        id: "delete-attachment",
        label: "Delete attachment",
        danger: true,
        onSelect: () => handleDelete(att.id),
      });
    }
    return items;
  }

  return (
    <div className={cn("flex flex-col gap-2", hasText ? "mt-2" : "mt-0.5")}>
      {attachments.map((att) => {
        const isUploading =
          (att.status === "PENDING_UPLOAD" || att.status === "UPLOADED") &&
          !timedOutIds.has(att.id);
        const isFailed = att.status === "FAILED" || timedOutIds.has(att.id);
        const canDownload = att.status === "READY";
        const downloadUrl = `${baseUrl}/api/attachments/${att.id}/download`;
        const mediaKind = showInlineMedia ? mediaKindOf(att.contentType) : null;

        if (mediaKind && canDownload) {
          return (
            <AttachmentMedia
              key={att.id}
              kind={mediaKind}
              url={downloadUrl}
              filename={att.filename}
              sizeBytes={att.sizeBytes}
            />
          );
        }

        const canDelete = isFailed && Boolean(serverId);
        return (
          <div key={att.id}>
            <div
              className="flex w-fit items-center gap-1"
              {...contextMenu.bind(
                () => fileMenuItems(att, canDownload ? downloadUrl : null, canDelete),
                { label: `Actions for ${att.filename}` },
              )}
            >
              <a
                href={canDownload ? downloadUrl : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                  isFailed
                    ? "border-rim-danger/30 bg-rim-panel text-rim-text opacity-60 pointer-events-none"
                    : "border-rim-line bg-rim-panel text-rim-text hover:bg-white/5",
                  isUploading && "opacity-60 pointer-events-none",
                )}
              >
                <FileIcon className="h-4 w-4 shrink-0 text-rim-text-muted" />
                <span className="truncate">{att.filename}</span>
                <span className="shrink-0 text-xs text-rim-text-faint">
                  {formatFileSize(att.sizeBytes)}
                </span>
                {isUploading ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 text-rim-text-muted animate-spin" />
                ) : isFailed ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rim-danger" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
                )}
              </a>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(att.id)}
                  className="rounded p-1.5 text-rim-danger transition hover:bg-rim-danger/10"
                  title="Remove attachment"
                  aria-label="Remove failed attachment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {isUploading && (
              <span className="mt-0.5 block text-xs text-rim-text-faint">Uploading...</span>
            )}
            {isFailed && (
              <span className="mt-0.5 block text-xs text-rim-danger">Upload failed</span>
            )}
          </div>
        );
      })}
      <IsolatedMenu>{contextMenu.menu}</IsolatedMenu>
    </div>
  );
});

/**
 * An uploaded image or video shown inline. The web app loads it from its download URL; the
 * desktop app downloads it first, without asking up to {@link AUTO_MEDIA_BYTES} and on a click
 * above.
 */
function AttachmentMedia({
  kind,
  url,
  filename,
  sizeBytes,
}: {
  kind: MediaKind;
  url: string;
  filename: string;
  sizeBytes: number;
}) {
  const [requested, setRequested] = useState(sizeBytes <= AUTO_MEDIA_BYTES);
  const media = useServerMedia(url, requested);
  if (!loadsAsBlob(url)) {
    return (
      <div className="w-fit max-w-full">
        <InlineMedia kind={kind} src={url} filename={filename} />
      </div>
    );
  }
  return (
    <DownloadedMedia
      kind={kind}
      filename={filename}
      sizeBytes={sizeBytes}
      src={media.src}
      requested={requested}
      failed={media.failed}
      onRequest={() => setRequested(true)}
    />
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
