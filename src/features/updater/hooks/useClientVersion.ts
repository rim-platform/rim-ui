import { useEffect, useState } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { logger } from "../../../core/logger";
import { BUILD_VERSION, readClientVersion } from "../api/updaterApi";

/** The running client's version; the bundle's until the desktop shell answers. */
export function useClientVersion(): string {
  const { platform } = useRuntime();
  const [version, setVersion] = useState(BUILD_VERSION);

  useEffect(() => {
    if (platform !== "desktop") return;
    let live = true;
    readClientVersion(platform)
      .then((v) => {
        if (live) setVersion(v);
      })
      .catch((err: unknown) => logger.warn("[updater] app version unavailable:", err));
    return () => {
      live = false;
    };
  }, [platform]);

  return version;
}
