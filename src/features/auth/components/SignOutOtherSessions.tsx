import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import { logoutOtherSessions } from "../api/sessions";

function endedText(ended: number): string {
  if (ended === 0) return "No other sessions were signed in.";
  return `Signed out ${ended} other ${ended === 1 ? "session" : "sessions"}.`;
}

/**
 * "Sign out other sessions": ends every session of the account but this one, on every device
 * and browser, and says how many ended.
 */
export function SignOutOtherSessions({ description }: { description: string }) {
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOutOthers() {
    setBusy(true);
    setError(null);
    setEnded(null);
    try {
      setEnded(await logoutOtherSessions());
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not sign out the other sessions."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-rim-text-muted">{description}</p>
      <Button variant="secondary" onClick={() => void signOutOthers()} isLoading={busy}>
        Sign out other sessions
      </Button>
      {ended !== null && (
        <p role="status" className="text-xs text-rim-text-muted">
          {endedText(ended)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}
