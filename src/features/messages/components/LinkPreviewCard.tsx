import { useCallback } from "react";

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

export function LinkPreviewCard({ preview }: LinkPreviewCardProps) {
  const handleClick = useCallback(() => {
    import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(preview.url))
      .catch(() => window.open(preview.url, "_blank"));
  }, [preview.url]);

  // Don't render if there's nothing meaningful to show
  if (!preview.title && !preview.description && !preview.imageUrl) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-2 flex w-full max-w-md items-start gap-3 overflow-hidden rounded-lg border border-rim-line bg-rim-panel-soft p-3 text-left transition hover:brightness-110"
    >
      {preview.imageUrl && (
        <img src={preview.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
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
  );
}
