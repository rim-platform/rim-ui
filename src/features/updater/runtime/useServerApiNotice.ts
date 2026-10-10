import { useEffect } from "react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import { NEWER_SERVER_API_MESSAGE, useServerInfo } from "../hooks/useServerInfo";

/** The id of the "newer server API" toast. */
export const SERVER_API_TOAST_ID = "server-api-newer";

/** Whether this launch has already shown the toast. */
let announced = false;

/** Forgets that this launch showed the toast; for tests. */
export function resetServerApiNotice(): void {
  announced = false;
}

/** Raises one info toast per launch when the server speaks a newer API than this client. */
export function useServerApiNotice(): void {
  const { newerApi } = useServerInfo();

  useEffect(() => {
    if (!newerApi || announced) return;
    announced = true;
    toast.info("Newer server API", {
      id: SERVER_API_TOAST_ID,
      description: NEWER_SERVER_API_MESSAGE,
      action: {
        label: "View About",
        onClick: () => useShellStore.getState().setMainSurface({ kind: "settings", tab: "about" }),
      },
    });
  }, [newerApi]);
}
