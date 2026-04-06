import { X, FileIcon } from "lucide-react";

interface PendingFile {
  file: File;
  previewUrl: string | null;
}

interface FilePreviewBarProps {
  pendingFiles: PendingFile[];
  onRemove: (index: number) => void;
}

export function FilePreviewBar({ pendingFiles, onRemove }: FilePreviewBarProps) {
  if (pendingFiles.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {pendingFiles.map((pf, i) => (
        <div
          key={`${pf.file.name}-${i}`}
          className="flex items-center gap-1.5 rounded-lg border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text"
        >
          {pf.previewUrl ? (
            <img
              src={pf.previewUrl}
              alt={pf.file.name}
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <FileIcon className="h-4 w-4 text-rim-text-muted" />
          )}
          <span className="max-w-[120px] truncate">{pf.file.name}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
            aria-label={`Remove ${pf.file.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
