import { SignOutDialog } from "../../auth/components/SignOutDialog";
import { StatusDropdown } from "../../settings/components/StatusDropdown";
import { ProfileCard } from "../../workspaces/components/ProfileCard";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { AddWorkspaceDialog } from "../../workspaces/components/AddWorkspaceDialog";
import { useAppDialogStore } from "../state/useAppDialogStore";

/** Where the status menu opens when a command, not a click, asks for it. */
function statusMenuPosition(): { x: number; y: number } {
  return { x: Math.max(8, window.innerWidth / 2 - 120), y: 96 };
}

/**
 * The sign-out, status and add-workspace dialogs that `useAppDialogStore` has open, for the
 * commands that open them. Mounted once in the app shell.
 */
export function AppCommandDialogs() {
  const dialog = useAppDialogStore((s) => s.dialog);
  const userId = useAppDialogStore((s) => s.userId);
  const statusAt = useAppDialogStore((s) => s.statusAt);
  const close = useAppDialogStore((s) => s.close);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  switch (dialog) {
    case "signOut":
      return <SignOutDialog open onClose={close} />;
    case "status":
      return <StatusDropdown position={statusAt ?? statusMenuPosition()} onClose={close} />;
    case "addWorkspace":
      return <AddWorkspaceDialog onClose={close} />;
    case "profile":
      return userId ? (
        <ProfileCard
          workspaceId={workspaceId}
          userId={userId}
          anchorRect={new DOMRect(window.innerWidth / 2 - 100, 120, 200, 0)}
          onClose={close}
        />
      ) : null;
    default:
      return null;
  }
}
