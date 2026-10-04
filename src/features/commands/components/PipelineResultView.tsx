import { useState } from "react";
import { Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../../shared/ui/cn";
import type { PipeStageResult, CommandResultStatus } from "../types";

interface PipelineResultViewProps {
  stages: PipeStageResult[];
}

function statusIcon(status: CommandResultStatus) {
  if (status === "SUCCESS") {
    return <Check className="h-3.5 w-3.5 text-rim-success" />;
  }
  return <X className="h-3.5 w-3.5 text-rim-danger" />;
}

function StagePayload({ payload }: { payload: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (payload == null) return null;

  const json = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  return (
    <div className="mt-1">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-rim-text-faint hover:text-rim-text-muted transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        payload
      </button>
      {expanded && (
        <pre className="mt-1 max-h-32 overflow-auto rounded bg-rim-void px-2 py-1 text-[11px] text-rim-text-muted font-mono">
          {json}
        </pre>
      )}
    </div>
  );
}

export function PipelineResultView({ stages }: PipelineResultViewProps) {
  if (stages.length === 0) return null;

  return (
    <div
      className="mt-2 space-y-1"
      data-testid="pipeline-result-view"
      role="list"
      aria-label="Pipeline execution results"
    >
      <div className="text-[10px] uppercase tracking-wider text-rim-text-faint px-1 pb-0.5">
        Pipeline stages
      </div>
      {stages.map((stage) => {
        const isError = stage.status === "ERROR";
        const stageLabel = `Stage ${stage.stageIndex + 1}: ${stage.status === "SUCCESS" ? "success" : "failed"}`;
        return (
          <div
            key={stage.stageIndex}
            data-testid={`pipeline-stage-${stage.stageIndex}`}
            role="listitem"
            className={cn(
              "flex flex-col rounded px-2 py-1.5 text-xs",
              isError ? "bg-rim-danger/10 border border-rim-danger/30" : "bg-rim-void/50",
            )}
          >
            <div className="flex items-center gap-2">
              <span aria-label={stageLabel}>{statusIcon(stage.status)}</span>
              <span className="font-mono text-rim-text-muted">{stage.stageIndex + 1}.</span>
              <span className="font-medium text-rim-text truncate">{stage.commandId}</span>
            </div>
            <div
              className={cn(
                "mt-0.5 pl-6 text-[11px]",
                isError ? "text-rim-danger" : "text-rim-text-muted",
              )}
            >
              {stage.message}
            </div>
            <div className="pl-6">
              <StagePayload payload={stage.payload} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
