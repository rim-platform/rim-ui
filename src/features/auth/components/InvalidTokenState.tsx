/**
 * `InvalidTokenState` — error screen rendered when a `/join/:token` invite
 * token fails the preview check.
 *
 * Accepts an `InviteErrorCode` discriminator and maps it to human-readable
 * copy. The three supported codes mirror the backend's collapsed error surface:
 *
 * | Code           | Says                                                        |
 * |----------------|-------------------------------------------------------------|
 * | `INVALID_TOKEN`| Missing, consumed or revoked: the link is no longer valid.  |
 * | `EXPIRED_TOKEN`| Past its expiry: the same words as `INVALID_TOKEN`.         |
 * | `NETWORK`      | The server could not be reached.                            |
 *
 * Every variant offers **Go to RIM**, which opens the app (or the sign-in page when signed out);
 * the `NETWORK` variant also renders a retry button that calls `onRetry`.
 */

import { useNavigate } from "react-router-dom";

import { NETWORK_ERROR_MESSAGE } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import type { InviteErrorCode } from "../types";
import { BrandHeading } from "./BrandHeading";

/** What an invite link that is revoked, used up, expired or unknown says. */
export const DEAD_INVITE_MESSAGE =
  "This invite link is no longer valid. Ask the person who sent it for a new one.";

const COPY: Record<InviteErrorCode, string> = {
  INVALID_TOKEN: DEAD_INVITE_MESSAGE,
  EXPIRED_TOKEN: DEAD_INVITE_MESSAGE,
  NETWORK: NETWORK_ERROR_MESSAGE,
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
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-sm space-y-6">
        <BrandHeading />
        <div className="space-y-4 rounded-xl border border-rim-line bg-rim-panel p-6 text-center">
          <p role="alert" className="text-sm text-rim-text">
            {COPY[code]}
          </p>
          <div className="flex flex-col gap-2">
            {code === "NETWORK" && onRetry && (
              <Button type="button" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )}
            <Button type="button" onClick={() => navigate("/")}>
              Go to RIM
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
