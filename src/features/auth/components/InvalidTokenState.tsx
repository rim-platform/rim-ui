/**
 * `InvalidTokenState` — error screen rendered when a `/join/:token` invite
 * token fails the preview check.
 *
 * Accepts an `InviteErrorCode` discriminator and maps it to human-readable
 * copy. The three supported codes mirror the backend's collapsed error surface:
 *
 * | Code           | Meaning                                      |
 * |----------------|----------------------------------------------|
 * | `INVALID_TOKEN`| Missing, consumed, or revoked — indistinct.  |
 * | `EXPIRED_TOKEN`| Valid token that has passed its expiry.      |
 * | `NETWORK`      | Fetch failed — connection or unknown error.  |
 *
 * The `NETWORK` variant renders a retry button that calls `onRetry`.
 */

import type { InviteErrorCode } from "../types";

const COPY: Record<InviteErrorCode, string> = {
  INVALID_TOKEN: "This invite link is no longer valid. Ask your admin for a fresh invite.",
  EXPIRED_TOKEN: "This invite has expired. Ask your admin for a fresh invite.",
  NETWORK: "Couldn't load invite. Check your connection and refresh.",
};

interface InvalidTokenStateProps {
  /**
   * Which error to display. Maps to the backend error code or `"NETWORK"` for
   * connection failures.
   */
  code: InviteErrorCode;
  /** Called when the user clicks the "Try again" button (NETWORK variant only). */
  onRetry?: () => void;
}

/**
 * Full-screen error state for invalid/expired/network-failed invite tokens.
 */
export function InvalidTokenState({ code, onRetry }: InvalidTokenStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <p className="text-sm text-rim-danger">{COPY[code]}</p>
        {code === "NETWORK" && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-sm text-rim-text-muted transition hover:text-rim-text"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
