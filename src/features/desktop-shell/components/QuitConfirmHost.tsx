import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { desktopQuit } from "../api/desktopShell";
import { useQuitConfirmStore } from "../state/useQuitConfirmStore";

const NO_MESSAGES = "You won't get messages or notifications until you open it again.";
const NEEDS_PASSWORD = " You'll need your password next time.";

/** Shows the confirmation of Ctrl+Q and the `app.quit` command, and quits on its Quit button. */
export function QuitConfirmHost() {
  const request = useQuitConfirmStore((s) => s.request);
  const close = useQuitConfirmStore((s) => s.close);
  if (!request) return null;
  const quit = () => {
    close();
    desktopQuit().catch((error: unknown) => {
      logger.warn("[RIM:desktop] could not quit:", error);
      toast.error("RIM could not quit");
    });
  };
  return (
    <ConfirmActionDialog
      title="Quit RIM?"
      description={request.needsPassword ? NO_MESSAGES + NEEDS_PASSWORD : NO_MESSAGES}
      confirmLabel="Quit"
      focusConfirm
      onConfirm={quit}
      onClose={close}
    />
  );
}
