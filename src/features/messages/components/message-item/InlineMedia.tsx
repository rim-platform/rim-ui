import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Dialog } from "../../../../shared/ui/Dialog";
import type { MediaKind } from "./mediaKind";

interface MediaLightboxProps {
  src: string;
  filename: string;
  onClose: () => void;
}

/**
 * Full-size view of an image in a dialog on `document.body`. Key presses and focus stay inside
 * it, so the timeline's keyboard navigation behind it does not react; Escape closes it.
 */
function MediaLightbox({ src, filename, onClose }: MediaLightboxProps) {
  return createPortal(
    <div
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      onFocus={(e) => e.stopPropagation()}
    >
      <Dialog open onClose={onClose} title={filename} maxWidth="max-w-5xl">
        <img
          src={src}
          alt={filename}
          decoding="async"
          className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain"
        />
        <div className="mt-3 flex justify-end">
          <a
            href={src}
            download={filename}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-rim-panel-soft hover:text-rim-text"
          >
            Save image
          </a>
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}

interface InlineMediaProps {
  kind: MediaKind;
  /** A download URL or an object URL of the decrypted file. */
  src: string;
  /** The file name, used as the alt text and the accessible name. */
  filename: string;
}

/**
 * An attachment shown in the conversation: an image thumbnail that opens full size, or a
 * video with its controls that only loads its metadata until played.
 */
export function InlineMedia({ kind, src, filename }: InlineMediaProps) {
  const [open, setOpen] = useState(false);
  const thumbnailRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    thumbnailRef.current?.focus();
  };

  if (kind === "video") {
    return (
      <figure className="w-fit max-w-full">
        <video
          src={src}
          controls
          preload="metadata"
          playsInline
          aria-label={filename}
          className="max-h-80 max-w-[min(100%,28rem)] rounded-lg border border-rim-line bg-rim-void"
        />
        <figcaption className="mt-1 truncate text-xs text-rim-text-faint">{filename}</figcaption>
      </figure>
    );
  }

  return (
    <>
      <button
        ref={thumbnailRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open image ${filename}`}
        className="block w-fit max-w-full rounded-lg"
      >
        <img
          src={src}
          alt={filename}
          loading="lazy"
          decoding="async"
          className="max-h-64 max-w-[min(100%,28rem)] rounded-lg border border-rim-line object-contain"
        />
      </button>
      {open && <MediaLightbox src={src} filename={filename} onClose={close} />}
    </>
  );
}
