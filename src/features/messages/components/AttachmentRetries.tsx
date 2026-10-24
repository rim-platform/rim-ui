import type { useAttachmentUploads } from "../api/useAttachmentUploads";

/** Files whose message was delivered, with actions that retry the files alone or discard them. */
export function AttachmentRetries({
  uploads,
}: {
  uploads: ReturnType<typeof useAttachmentUploads>;
}) {
  return uploads.failed.map((batch) => (
    <div
      key={batch.messageId}
      role="status"
      className="mb-2 rounded border border-rim-line p-2 text-sm text-rim-text-muted"
    >
      <p>
        Message sent. Files waiting to upload:{" "}
        {batch.files
          .filter((file) => !file.ready)
          .map(({ file, displayName }) => displayName ?? file.name)
          .join(", ")}
      </p>
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          disabled={uploads.busy.includes(batch.messageId)}
          onClick={() => void uploads.run(batch)}
          className="text-rim-accent disabled:opacity-50"
        >
          Retry files
        </button>
        <button
          type="button"
          disabled={uploads.busy.includes(batch.messageId)}
          onClick={() => uploads.dismiss(batch.messageId)}
        >
          Discard files
        </button>
      </div>
    </div>
  ));
}
