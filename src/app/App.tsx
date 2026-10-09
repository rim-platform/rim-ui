import { useEffect } from "react";

import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./router/AppRouter";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { useRuntime } from "../core/runtime/RuntimeProvider";
import { persistSessionRecord } from "../features/offline/api/offlineSession";

/**
 * Boot-time side-effects that require runtime capabilities.
 *
 * Rendered inside `AppProviders` so that `useRuntime()` is available.
 * Currently handles:
 *   - Stronghold → OS keyring migration (desktop only, one-shot, idempotent).
 *   - Keeping the offline session record in step with sign-ins and sign-outs (desktop only;
 *     a no-op in the web app).
 */
function AppBoot() {
  const { capabilities } = useRuntime();

  useEffect(() => persistSessionRecord(), []);

  useEffect(() => {
    if (!capabilities.agent) return;

    // Dynamic import keeps the Stronghold dependency out of the web bundle.
    void import("../features/agent/runtime/migrateApiKeys").then(({ migrateApiKeysOnce }) => {
      void migrateApiKeysOnce();
    });
  }, [capabilities.agent]);

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
