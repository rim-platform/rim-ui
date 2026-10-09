import { useState } from "react";

import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useLogoutMutation } from "../../auth/api/useAuthMutations";
import { SignOutOtherSessions } from "../../auth/components/SignOutOtherSessions";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { Dialog } from "../../../shared/ui/Dialog";

interface AccountSettingsProps {
  onNavigateToProfile: () => void;
}

export function AccountSettings({ onNavigateToProfile }: AccountSettingsProps) {
  const { data: user, isPending: userLoading } = useCurrentUser();
  const logoutMutation = useLogoutMutation();
  const clearSession = useAuthStore((s) => s.clearSession);
  const resetShell = useShellStore((s) => s.reset);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);

  async function handleLogout() {
    setShowSignOutDialog(false);
    setLoggingOut(true);
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Logout may fail if the session is already expired — still clear local state
    }
    clearSession();
    resetShell();
  }

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
              onClick={onNavigateToProfile}
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
              onClick={onNavigateToProfile}
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

      {/* Security */}
      <section>
        <h3 className="text-sm font-medium text-rim-text mb-2">Security</h3>
        <HoverTooltip content={<span className="text-xs text-rim-text-muted">Coming soon</span>}>
          <button
            type="button"
            disabled
            className="rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-sm text-rim-text-muted opacity-50 cursor-not-allowed"
          >
            Change password
          </button>
        </HoverTooltip>
      </section>

      <hr className="border-rim-line my-6" />

      {/* Sign out */}
      <section>
        <h3 className="text-sm font-medium text-rim-text mb-2">Sign out</h3>
        <button
          type="button"
          onClick={() => setShowSignOutDialog(true)}
          disabled={loggingOut}
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-4 py-2 text-sm font-medium text-rim-danger transition hover:bg-rim-danger/20 disabled:opacity-50"
        >
          {loggingOut ? "Signing out..." : "Sign out"}
        </button>
      </section>

      <Dialog open={showSignOutDialog} onClose={() => setShowSignOutDialog(false)} title="Sign out">
        <p className="text-sm text-rim-text-muted mb-4">Are you sure you want to sign out?</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowSignOutDialog(false)}
            className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text transition hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-4 py-2 text-sm font-medium text-rim-danger transition hover:bg-rim-danger/20"
          >
            Sign out
          </button>
        </div>
      </Dialog>
    </div>
  );
}
