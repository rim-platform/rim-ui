import { useCallback } from "react";
import { FileText, X, Copy, RefreshCw } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { useIncidentStore } from "../state/useIncidentStore";
import { useActiveIncident, useGeneratePostmortem } from "../api/useIncident";
import { toast } from "../../../shared/toast";

interface PostmortemPreviewProps {
  serverId: string;
  conversationId: string;
  onClose: () => void;
}

export function PostmortemPreview({ serverId, conversationId, onClose }: PostmortemPreviewProps) {
  const incident = useIncidentStore((s) => s.activeIncident);
  const { data: fullIncident } = useActiveIncident(serverId, conversationId);
  const generatePostmortem = useGeneratePostmortem();

  const postmortemDraft = fullIncident?.postmortemDraft ?? null;

  const handleGenerate = useCallback(() => {
    if (!incident) return;
    generatePostmortem.mutate(
      { incidentId: incident.id, serverId, conversationId },
      {
        onSuccess: () => toast.success("Postmortem generated"),
        onError: () => toast.error("Failed to generate postmortem"),
      },
    );
  }, [incident, generatePostmortem, serverId, conversationId]);

  const handleCopy = useCallback(() => {
    if (!postmortemDraft) return;
    navigator.clipboard.writeText(postmortemDraft);
    toast.success("Copied to clipboard");
  }, [postmortemDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  return (
    <div
      className="flex h-full flex-col border-l border-rim-line bg-rim-panel"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-rim-accent" />
          <h3 className="text-sm font-medium text-rim-text">Postmortem</h3>
        </div>
        <div className="flex items-center gap-1">
          {postmortemDraft && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy postmortem"
              className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
            >
              <Copy className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close postmortem"
            className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!postmortemDraft ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <FileText className="h-8 w-8 text-rim-text-faint" />
            <p className="text-sm text-rim-text-muted">No postmortem draft yet.</p>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generatePostmortem.isPending}
              className={cn(
                "flex items-center gap-1.5 rounded bg-rim-accent px-3 py-1.5 text-sm text-white transition",
                generatePostmortem.isPending ? "opacity-50 cursor-not-allowed" : "hover:brightness-110",
              )}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", generatePostmortem.isPending && "animate-spin")} />
              {generatePostmortem.isPending ? "Generating..." : "Generate Postmortem"}
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generatePostmortem.isPending}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
              >
                <RefreshCw className={cn("h-3 w-3", generatePostmortem.isPending && "animate-spin")} />
                Regenerate
              </button>
            </div>
            <div className="rounded-lg border border-rim-line bg-rim-void p-4">
              <MarkdownRenderer
                content={postmortemDraft}
                className="prose-rim text-sm text-rim-text"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
