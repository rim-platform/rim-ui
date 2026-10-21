import { Film, Image as ImageIcon, Loader2 } from "lucide-react";

import { InlineMedia } from "./InlineMedia";
import type { MediaKind } from "./mediaKind";

/** Images and videos up to this size are downloaded and shown without asking. */
export const AUTO_MEDIA_BYTES = 5 * 1024 * 1024;

interface DownloadedMediaProps {
  kind: MediaKind;
  filename: string;
  sizeBytes: number;
  /** The object URL of the downloaded file, once there is one. */
  src: string | null;
  /** Whether the download was asked for, by its size or a click. */
  requested: boolean;
  failed: boolean;
  /** Ask for the download of a file above {@link AUTO_MEDIA_BYTES}. */
  onRequest: () => void;
}

/**
 * An image or video the app downloads before it shows it: the media once downloaded, a Show
 * button until the download is asked for, then its name with a spinner, or a note that it
 * could not be opened.
 */
export function DownloadedMedia({
  kind,
  filename,
  sizeBytes,
  src,
  requested,
  failed,
  onRequest,
}: DownloadedMediaProps) {
  if (src) {
    return (
      <div className="w-fit max-w-full">
        <InlineMedia kind={kind} src={src} filename={filename} />
      </div>
    );
  }
  if (!requested) {
    return (
      <button
        type="button"
        onClick={onRequest}
        className="flex w-fit items-center gap-2 rounded-lg border border-rim-line bg-rim-panel-soft px-3 py-2 text-xs text-rim-text hover:border-rim-accent/40"
      >
        {kind === "video" ? (
          <Film className="h-4 w-4 text-rim-text-muted" aria-hidden />
        ) : (
          <ImageIcon className="h-4 w-4 text-rim-text-muted" aria-hidden />
        )}
        <span className="max-w-60 truncate">{`Show ${filename}`}</span>
        <span className="text-rim-text-faint">{Math.ceil(sizeBytes / 1024)} KB</span>
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-rim-text-muted">
      {failed ? null : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {failed ? `${filename} could not be opened` : filename}
    </span>
  );
}
