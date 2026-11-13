import { HardDrive } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "../../../shared/ui/Button";

/**
 * The browser refused to keep this site's data: what that means for the keys, with "Continue"
 * and "Go back". It scrolls into view and takes focus when it appears.
 */
export function StorageRefusedPrompt({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView?.({ block: "center" });
    el.focus();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alertdialog"
      aria-label="This browser may clear what it keeps for RIM"
      className="space-y-3 rounded-[14px] border border-rim-warm/40 bg-rim-panel-soft p-5 outline-none"
    >
      <div className="flex items-start gap-2">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-rim-warm" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-rim-text">This browser may clear what it keeps for RIM</p>
          <p className="text-rim-text-muted">
            Your browser didn&apos;t promise to keep this site&apos;s data, so it may clear it, for
            example when the disk is low. You&apos;ll save a recovery kit on the next screen: with
            it, you can always get your account back.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onContinue}>
          Continue
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onBack}>
          Go back
        </Button>
      </div>
    </div>
  );
}
