import { useCallback, useState } from "react";

import { isHttpUrl } from "../../../shared/ui/markdown/safeUrl";
import { IsolatedMenu } from "../../../shared/ui/contextMenu/IsolatedMenu";
import { linkMenuItems, openExternalUrl } from "../../../shared/ui/contextMenu/menuActions";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { useMessageDisplaySettingsStore } from "../state/useMessageDisplaySettingsStore";

export interface LinkPreview {
  id: string;
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
}

interface LinkPreviewCardProps {
  preview: LinkPreview;
}

/**
 * A link the server previewed: title, description, site and, when inline media is on, the
 * page's image. Only http(s) URLs open or load; the image loads without a referrer. Its
 * context menu opens the link or copies its address.
 */
export function LinkPreviewCard({ preview }: LinkPreviewCardProps) {
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);
  const [imageFailed, setImageFailed] = useState(false);
  const canOpen = isHttpUrl(preview.url);
  const imageUrl =
    showInlineMedia && !imageFailed && preview.imageUrl && isHttpUrl(preview.imageUrl)
      ? preview.imageUrl
      : null;

  const contextMenu = useContextMenu();

  const handleClick = useCallback(() => {
    if (canOpen) openExternalUrl(preview.url);
  }, [canOpen, preview.url]);

  // Don't render if there's nothing meaningful to show
  if (!preview.title && !preview.description && !imageUrl) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        {...contextMenu.bind(() => (canOpen ? linkMenuItems(preview.url) : []))}
        disabled={!canOpen}
        className="mt-2 flex w-full max-w-md items-start gap-3 overflow-hidden rounded-lg border border-rim-line bg-rim-panel-soft p-3 text-left transition hover:brightness-110"
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-20 w-20 shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          {preview.title && (
            <p className="truncate text-sm font-medium text-rim-text">{preview.title}</p>
          )}
          {preview.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-rim-text-muted">{preview.description}</p>
          )}
          {preview.siteName && (
            <p className="mt-1 text-[10px] text-rim-text-faint">{preview.siteName}</p>
          )}
        </div>
      </button>
      <IsolatedMenu>{contextMenu.menu}</IsolatedMenu>
    </>
  );
}
