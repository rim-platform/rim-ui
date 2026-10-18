import { useEffect } from "react";

import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./router/AppRouter";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { persistSessionRecord } from "../features/offline/api/offlineSession";
import { useUpdateSchedule } from "../features/updater/runtime/useUpdateSchedule";
import { useServerApiNotice } from "../features/updater/runtime/useServerApiNotice";
import { useRuntime } from "../core/runtime/RuntimeProvider";
import { useNativeContextMenuPolicy } from "../shared/ui/contextMenu/nativeContextMenu";

/**
 * Boot-time side-effects, rendered inside `AppProviders`.
 * Currently handles:
 *   - Keeping the offline session record in step with sign-ins and sign-outs (desktop only;
 *     a no-op in the web app).
 *   - Checking for app updates at launch and daily (desktop builds with an update endpoint).
 *   - Telling the user once per launch when the server speaks a newer API than this app.
 *   - Hiding the webview's default right-click menu (desktop only).
 */
function AppBoot() {
  const { platform } = useRuntime();
  useEffect(() => persistSessionRecord(), []);
  useUpdateSchedule();
  useServerApiNotice();
  useNativeContextMenuPolicy(platform);

  return null;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <AppBoot />
        <AppRouter />
      </AppProviders>
    </AppErrorBoundary>
  );
}
