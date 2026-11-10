import { forwardRef, useId } from "react";

import { toast } from "../../../../shared/toast";
import { Button } from "../../../../shared/ui/Button";
import type { PermissionOption } from "../../acp/acpClient";
import type { AgentSession, PendingPermission } from "../../acp/agentSession";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { KIND_LABELS, rawInputPreview } from "./sessionText";

/** How an option's button looks, by what the option means. */
function optionStyle(option: PermissionOption): {
  variant: "primary" | "secondary";
  className?: string;
} {
  switch (option.kind) {
    case "allow_once":
      return { variant: "primary" };
    case "allow_always":
      return { variant: "secondary" };
    case "reject_once":
    case "reject_always":
      return {
        variant: "secondary",
        className: "border-rim-danger/50 text-rim-danger hover:text-rim-danger",
      };
  }
}

/**
 * A permission request waiting for the person, with one button for each answer the agent
 * offered. The buttons answer this request only; they are not commands, so nothing else can
 * press them.
 */
export const ApprovalCard = forwardRef<
  HTMLDivElement,
  { session: AgentSession; agentName: string; pending: PendingPermission }
>(function ApprovalCard({ session, agentName, pending }, ref) {
  const headingId = useId();
  const title = pending.toolCall.title.trim() === "" ? "use a tool" : pending.toolCall.title;
  const input = rawInputPreview(pending.toolCall.rawInput);
  const answer = (optionId: string) => {
    try {
      session.answerPermission(pending.requestId, { outcome: "selected", optionId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That answer did not reach the agent.");
    }
  };
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby={headingId}
      className="space-y-2 rounded-lg border border-rim-warm/50 bg-rim-panel px-3 py-3 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
    >
      <p id={headingId} className="break-words text-sm font-medium text-rim-text">
        {showInvisibleCharacters(agentName)} wants to: {showInvisibleCharacters(title)}
      </p>
      <p className="text-xs text-rim-text-muted">{KIND_LABELS[pending.toolCall.kind]}</p>
      {input !== null && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-rim-void px-2 py-1 font-mono text-xs text-rim-text-muted">
          {input}
        </pre>
      )}
      <div className="flex flex-wrap gap-2">
        {pending.options.map((option) => {
          const style = optionStyle(option);
          return (
            <Button
              key={option.optionId}
              type="button"
              size="sm"
              variant={style.variant}
              className={style.className}
              onClick={() => answer(option.optionId)}
            >
              {showInvisibleCharacters(option.name)}
            </Button>
          );
        })}
      </div>
    </div>
  );
});
