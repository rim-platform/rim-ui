import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { SignOutOtherSessions } from "../../auth/components/SignOutOtherSessions";
import { AccountDeletionSection } from "../../account-deletion/components/AccountDeletionSection";

interface AccountSettingsProps {
  /** Opens Settings → Workspace, where an owned workspace is handed over or deleted. */
  onNavigateToWorkspace: () => void;
}

/**
 * Settings → Account: the person's status, this session, signing out and deleting the account.
 * Set status runs `people.set_status` and Sign out… runs `app.sign_out`, as the palette does.
 */
export function AccountSettings({ onNavigateToWorkspace }: AccountSettingsProps) {
  const { data: user, isPending: userLoading } = useCurrentUser();
  const setStatus = () => void runCommandFromClick("people.set_status");

  if (userLoading) {
    return <p className="text-sm text-rim-text-muted">Loading account...</p>;
  }

  return (
    <div className="space-y-0">
      <h2 className="text-lg font-semibold text-rim-text mb-6">Account</h2>

      {/* Current Status */}
      <section>
        <h3 className="text-sm font-medium text-rim-text mb-2">Current Status</h3>
        {user?.statusText ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-rim-text">{user.statusText}</p>
            <button
              type="button"
              onClick={setStatus}
              className="text-xs text-rim-accent hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-rim-text-muted">No status set</p>
            <button
              type="button"
              onClick={setStatus}
              className="rounded-lg border border-rim-line bg-rim-void px-3 py-1 text-xs text-rim-text-muted transition hover:text-rim-text"
            >
              Set status
            </button>
          </div>
        )}
      </section>

      <hr className="border-rim-line my-6" />

      {/* Session */}
      <section>
        <h3 className="text-sm font-medium text-rim-text mb-2">Session</h3>
        <div className="space-y-1 text-sm text-rim-text-muted">
          <p>
            Logged in as:{" "}
            <span className="text-rim-text font-medium">{user?.username ?? "Unknown"}</span>
          </p>
          <p>
            Session started:{" "}
            <span className="text-rim-text">
              {new Date().toLocaleDateString([], {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </p>
        </div>
        <div className="mt-4">
          <SignOutOtherSessions description="Ends every other session of your account, on other devices and browsers. This one stays signed in." />
        </div>
      </section>

      <hr className="border-rim-line my-6" />

      {/* Sign out */}
      <section>
        <h3 className="text-sm font-medium text-rim-text mb-2">Sign out</h3>
        <button
          type="button"
          onClick={() => void runCommandFromClick("app.sign_out")}
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-4 py-2 text-sm font-medium text-rim-danger transition hover:bg-rim-danger/20"
        >
          Sign out...
        </button>
      </section>

      {user && (
        <>
          <hr className="border-rim-line my-6" />
          <AccountDeletionSection
            username={user.username}
            onOpenWorkspaceSettings={onNavigateToWorkspace}
          />
        </>
      )}
    </div>
  );
}
