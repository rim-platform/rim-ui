import { useEffect, useRef } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { resumePendingDeviceLinks } from "../api/deviceLink";

/**
 * Once per signed-in account and run, carry on device links an earlier run confirmed as the
 * old device and did not finish (device linking, old device rule 8): send the answer again,
 * wait for the new device, or revoke a certified device nobody used. Desktop only, and only
 * while the server can be reached.
 */
export function useResumeDeviceLinks() {
  const { capabilities } = useRuntime();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const offline = useOfflineStore((s) => s.offline);
  const resumedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!capabilities.deviceKeys || !userId || offline || resumedFor.current === userId) return;
    resumedFor.current = userId;
    void resumePendingDeviceLinks();
  }, [capabilities.deviceKeys, userId, offline]);
}
