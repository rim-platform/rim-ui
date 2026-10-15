import { useState } from "react";
import { Copy } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { Button } from "../../../shared/ui/Button";
import type { RecoveryKitText } from "../api/keyIdentity";

/**
 * The recovery kit of a started enrollment, shown once before it is sent: what it is for, the
 * account id and the 12-word phrase, a button that copies the whole kit, and the "I saved it"
 * checkbox that gates the next step.
 */
export function SaveRecoveryKit({
  draft,
  saved,
  onSavedChange,
}: {
  draft: RecoveryKitText;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-rim-text">Save your recovery kit</p>
      <p className="text-sm text-rim-text-muted">
        This is the only time RIM shows it. Write down the 12 words in order with your account id,
        or copy the kit into a password manager. Keep it somewhere safe that is not this device.
        Anyone who has it can take over your account.
      </p>
      <RecoveryKitView kit={draft} />
      <label className="flex items-center gap-2 text-sm text-rim-text">
        <input type="checkbox" checked={saved} onChange={(e) => onSavedChange(e.target.checked)} />I
        saved my recovery kit somewhere safe
      </label>
      <SecondDeviceNudge />
    </div>
  );
}

/**
 * The account id and the recovery phrase as a numbered grid of 12 words, and a button that
 * copies the whole kit text.
 */
export function RecoveryKitView({ kit }: { kit: RecoveryKitText }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyKit() {
    try {
      await navigator.clipboard.writeText(kit.recoveryKit);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-rim-text-muted">Account id</p>
        <code className="mt-1 block select-all break-all font-mono text-xs text-rim-text">
          {kit.principalId}
        </code>
      </div>
      <ol aria-label="Recovery phrase" className="grid grid-cols-3 gap-2">
        {kit.recoveryPhrase.map((word, i) => (
          // A phrase may repeat a word, so its position is the key.
          <li
            key={i}
            className="flex items-baseline gap-2 rounded-md border border-rim-line bg-rim-void px-2 py-1.5 font-mono text-sm text-rim-text"
          >
            <span className="w-5 shrink-0 text-right text-xs text-rim-text-faint">{i + 1}.</span>
            <span>{word}</span>
          </li>
        ))}
      </ol>
      <Button variant="secondary" size="sm" type="button" onClick={() => void copyKit()}>
        <span className="flex items-center gap-1.5">
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy kit"}
        </span>
      </Button>
      {copyFailed && (
        <p role="alert" className="text-sm text-rim-danger">
          Could not copy. Select the kit and copy it by hand.
        </p>
      )}
    </div>
  );
}

/**
 * "A second device also keeps you signed in…": with `onOpenSettings`, "Settings > Security" is a
 * link that opens that page and then calls it; without, plain text.
 */
export function SecondDeviceNudge({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  return (
    <p className="text-xs text-rim-text-faint">
      A second device also keeps you signed in if this one is lost. Link one from{" "}
      {onOpenSettings ? (
        <button
          type="button"
          onClick={() => {
            setMainSurface({ kind: "settings", tab: "security" });
            onOpenSettings();
          }}
          className="underline underline-offset-2 transition hover:text-rim-text-muted"
        >
          Settings &gt; Security
        </button>
      ) : (
        "Settings > Security"
      )}
      .
    </p>
  );
}
