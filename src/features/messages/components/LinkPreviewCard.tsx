import { useCallback } from "react";

import { isHttpUrl } from "../../../shared/ui/markdown/safeUrl";
import { IsolatedMenu } from "../../../shared/ui/contextMenu/IsolatedMenu";
import { linkMenuItems, openExternalUrl } from "../../../shared/ui/contextMenu/menuActions";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";

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
 * A link the server previewed: title, description and site, with no image. The page's image
 * would come from another site, which the app's content policy blocks and which would tell that
 * site who is reading. Only an http(s) URL opens. Its context menu opens the link or copies its
 * address.
 */
export function LinkPreviewCard({ preview }: LinkPreviewCardProps) {
  const canOpen = isHttpUrl(preview.url);

  const contextMenu = useContextMenu();

  const handleClick = useCallback(() => {
    if (canOpen) openExternalUrl(preview.url);
  }, [canOpen, preview.url]);

  // Don't render if there's nothing meaningful to show
  if (!preview.title && !preview.description) {
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
