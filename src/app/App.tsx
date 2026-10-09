import { useEffect } from "react";

import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./router/AppRouter";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { persistSessionRecord } from "../features/offline/api/offlineSession";

/**
 * Boot-time side-effects, rendered inside `AppProviders`.
 * Currently handles:
 *   - Keeping the offline session record in step with sign-ins and sign-outs (desktop only;
 *     a no-op in the web app).
 */
function AppBoot() {
  useEffect(() => persistSessionRecord(), []);

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
