import { HardDrive } from "lucide-react";

import { Button } from "../../../shared/ui/Button";

/**
 * The browser refused to keep this site's data: what that means for the keys, with "Continue
 * anyway" and "Go back".
 */
export function StorageRefusedPrompt({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="This browser may clear your keys"
      className="space-y-3 rounded-lg border border-rim-warm/30 bg-rim-warm/10 p-3"
    >
      <div className="flex items-start gap-2">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-rim-warm" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-rim-text">This browser may clear your keys</p>
          <p className="text-rim-text-muted">
            It did not agree to keep this site&apos;s data, so it may clear it, for example when the
            disk runs low. Your keys go with it, and the recovery kit is then the only way back into
            the account.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onContinue}>
          Continue anyway
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onBack}>
          Go back
        </Button>
      </div>
    </div>
  );
}
