import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { browserDeviceKeysSupported } from "./ed25519";
import {
  detectPlatform,
  detectOs,
  getDeviceKeyStore,
  getRuntimeCapabilities,
  type AppPlatform,
  type DeviceKeyStore,
  type OsType,
  type RuntimeCapabilities,
} from "./runtime";

type RuntimeServices = {
  platform: AppPlatform;
  capabilities: RuntimeCapabilities;
  osType: OsType;
  /** Where this app keeps its device key; on the web, settled once the browser is probed. */
  deviceKeyStore: DeviceKeyStore;
};

const RuntimeContext = createContext<RuntimeServices | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [platform] = useState(detectPlatform);
  const [osType] = useState(detectOs);
  const [browserKeys, setBrowserKeys] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (platform !== "web") return;
    let live = true;
    void browserDeviceKeysSupported().then((supported) => {
      if (live) setBrowserKeys(supported);
    });
    return () => {
      live = false;
    };
  }, [platform]);

  const value = useMemo<RuntimeServices>(() => {
    const deviceKeyStore = getDeviceKeyStore(platform, browserKeys);
    return {
      platform,
      capabilities: getRuntimeCapabilities(platform, deviceKeyStore),
      osType,
      deviceKeyStore,
    };
  }, [platform, osType, browserKeys]);

  return <RuntimeContext value={value}>{children}</RuntimeContext>;
}

export function useRuntime(): RuntimeServices {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used within RuntimeProvider");
  return ctx;
}
