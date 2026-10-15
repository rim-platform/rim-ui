import { useMemo, useState } from "react";
import { LockOpen } from "lucide-react";

import { detectPlatform } from "../../../core/runtime/runtime";
import { useShellStore } from "../../../shell/state/useShellStore";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useOfferKeySetup } from "../../key-identity";
import { usePlaintextStatus, type PlaintextStatus } from "../hooks/useE2eeConversation";
import { joinNames } from "../utils/names";
import { plaintextNoticeSeen, rememberPlaintextNotice } from "../utils/plaintextNotice";

interface PlaintextNoticeProps {
  workspaceId: string | null | undefined;
  conversationId: string | null | undefined;
}

/** Who keeps the conversation unencrypted, in one line, when this device knows. */
function reasonOf(status: PlaintextStatus, here: string): string | null {
  const { notReady } = status;
  if (notReady.length > 0) {
    return `${joinNames(notReady)} ${notReady.length === 1 ? "has" : "have"} not set up encryption on a desktop device yet.`;
  }
  if (status.upgradeOnDesktop) {
    return "Everyone is ready: a member's desktop app turns encryption on when it opens this conversation. A browser does not.";
  }
  if (status.noDeviceKey) return `This ${here} is not set up for encryption.`;
  return null;
}

const SERVER_READS = "Messages here are not end-to-end encrypted: the server can read them.";

function focusComposer() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
  });
}

/**
 * The "Not encrypted" marker of an unencrypted DM or group, and the dialog that says so: shown
 * by itself the first time the conversation opens on this device for the account, and again
 * from the marker.
 */
export function PlaintextNotice({ workspaceId, conversationId }: PlaintextNoticeProps) {
  const userId = useAuthStore((s) => s.session?.userId);
  const status = usePlaintextStatus(workspaceId, conversationId);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const keySetup = useOfferKeySetup();
  // The conversation whose dialog was closed or reopened while this header showed it.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [reopenedFor, setReopenedFor] = useState<string | null>(null);
  const firstTime = useMemo(
    () => Boolean(userId && conversationId && !plaintextNoticeSeen(userId, conversationId)),
    [userId, conversationId],
  );

  if (!status || !conversationId) return null;
  const reopened = reopenedFor === conversationId;
  const open = reopened || (firstTime && closedFor !== conversationId);

  function close() {
    if (userId && conversationId) rememberPlaintextNotice(userId, conversationId);
    setClosedFor(conversationId ?? null);
    setReopenedFor(null);
    // Reopened from the marker, focus goes back to it; shown by itself, to the composer.
    if (!reopened) focusComposer();
  }

  // The key setup step where it can help this device, Settings > Security otherwise.
  function setUpEncryption() {
    close();
    if (keySetup.available) keySetup.offer();
    else setMainSurface({ kind: "settings", tab: "security" });
  }

  const here = detectPlatform() === "desktop" ? "computer" : "browser";
  const reason = reasonOf(status, here);
  return (
    <>
      <HoverTooltip
        content={
          <span className="block max-w-xs text-xs text-rim-text">{reason ?? SERVER_READS}</span>
        }
      >
        <button
          type="button"
          onClick={() => setReopenedFor(conversationId)}
          className="inline-flex items-center gap-1 rounded border border-rim-line px-1 text-[10px] text-rim-text-faint transition hover:text-rim-text"
        >
          <LockOpen className="h-3 w-3" aria-hidden />
          Not encrypted
        </button>
      </HoverTooltip>
      <Dialog open={open} onClose={close} title="This conversation is not encrypted">
        <div className="space-y-3 text-sm text-rim-text-muted">
          <p>{SERVER_READS}</p>
          {reason && <p>{reason}</p>}
          {status.notReady.length > 0 && (
            <p>Encryption turns on once every member has a device set up for it.</p>
          )}
          {status.noDeviceKey &&
            (keySetup.available ? (
              <p>Set up encryption on this {here} to read and send encrypted messages here.</p>
            ) : (
              <p>
                To read and send encrypted messages in this browser, link it to your account: choose
                Link a device in the desktop app&apos;s Settings &gt; Security, then sign in here
                with &ldquo;Link this browser with its code&rdquo;.
              </p>
            ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant={status.noDeviceKey ? "secondary" : "primary"}
              size="sm"
              onClick={close}
            >
              OK
            </Button>
            {status.noDeviceKey && (
              <Button size="sm" onClick={setUpEncryption}>
                {keySetup.available ? "Set up encryption" : "Open security settings"}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
