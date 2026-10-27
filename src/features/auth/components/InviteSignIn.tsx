import { Link } from "react-router-dom";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useDeviceKeyAccounts } from "../../key-identity/api/useDeviceKeyAccounts";
import { DeviceKeySignIn } from "../../key-identity/components/DeviceKeySignIn";

interface InviteSignInProps {
  /** The invite's token, for the way back from the sign-in page. */
  token: string;
  /** The invite's workspace name, when the preview gave one. */
  workspaceName?: string;
  /** Called with the account that signed in here. */
  onSignedIn: (userId: string) => void;
}

/**
 * The sign-in a workspace invite offers someone signed out: "Sign in as …" for each account this
 * device holds a key for, else a link to the sign-in page that comes back to the invite.
 */
export function InviteSignIn({ token, workspaceName, onSignedIn }: InviteSignInProps) {
  const { capabilities } = useRuntime();
  const accounts = useDeviceKeyAccounts();

  if (capabilities.deviceKeys && accounts.isPending) return null;

  if (capabilities.deviceKeys && accounts.data?.length) {
    return (
      <section
        aria-label="Sign in"
        className="space-y-3 rounded-xl border border-rim-line bg-rim-panel p-6"
      >
        <p className="text-sm text-rim-text-muted">
          Already have an account? Sign in to join {workspaceName ?? "the workspace"}.
        </p>
        <DeviceKeySignIn onSuccess={onSignedIn} />
      </section>
    );
  }

  return (
    <p className="text-center text-sm text-rim-text-muted">
      Already have an account?{" "}
      <Link
        to="/login"
        state={{ returnTo: `/join/${encodeURIComponent(token)}` }}
        className="font-medium text-rim-accent hover:underline"
      >
        Sign in
      </Link>
    </p>
  );
}
