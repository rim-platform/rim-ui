import { useEffect, useRef } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { resumePendingDeviceLinks } from "../api/deviceLink";

/**
 * Once per signed-in account and run, carry on device links left pending in the keyring.
 * Desktop only, and only while the server can be reached.
 */
export function useResumeDeviceLinks() {
  const { capabilities } = useRuntime();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const offline = useOfflineStore((s) => s.offline);
  const resumedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!capabilities.identityKeys || !userId || offline || resumedFor.current === userId) return;
    const controller = new AbortController();
    void resumePendingDeviceLinks({ signal: controller.signal }).then(() => {
      if (!controller.signal.aborted) resumedFor.current = userId;
    });
    return () => controller.abort();
  }, [capabilities.identityKeys, userId, offline]);
}
