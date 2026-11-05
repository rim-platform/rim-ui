import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useNotificationClicks } from "../runtime/useNotificationClicks";
import { useTrayState } from "../runtime/useTrayState";

function DesktopRuntime() {
  useTrayState();
  useNotificationClicks();
  return null;
}

/**
 * Keeps the tray icon up to date and answers clicks on notifications. It sits at the top of the
 * app, so it works from the sign-in screen on, and does nothing outside the desktop app.
 */
export function DesktopRuntimeHost() {
  const { capabilities } = useRuntime();
  return capabilities.desktopShell ? <DesktopRuntime /> : null;
}
