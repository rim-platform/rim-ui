import { Dialog } from "../../../shared/ui/Dialog";

interface AgentDisclaimerDialogProps {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export function AgentDisclaimerDialog({ open, onAccept, onCancel }: AgentDisclaimerDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title="AI Agent — Data Sharing Notice" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-4 py-3">
          <p className="text-xs leading-relaxed text-rim-warm">
            When you use the AI Agent, workspace data — including messages, channel names,
            member usernames, and other content — is sent to the selected third-party AI
            provider (Anthropic, OpenAI, etc.) for processing.
          </p>
        </div>

        <p className="text-xs leading-relaxed text-rim-text-muted">
          The AI provider may process this data according to their own privacy policy
          and terms of service. RIM does not control how the provider handles your data
          once it is transmitted.
        </p>

        <p className="text-xs leading-relaxed text-rim-text-muted">
          Do not use the AI Agent if your workspace contains sensitive, confidential,
          or regulated data that should not be shared with third parties.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-rim-line bg-rim-void px-4 py-2 text-xs text-rim-text-muted transition hover:text-rim-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded bg-rim-accent px-4 py-2 text-xs font-medium text-rim-void transition hover:bg-rim-accent/90"
          >
            I understand
          </button>
        </div>
      </div>
    </Dialog>
  );
}
