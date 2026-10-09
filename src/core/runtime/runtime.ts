export type AppPlatform = "desktop" | "web" | "mobile";

export type OsType = "macos" | "windows" | "linux" | "unknown";

export type RuntimeCapabilities = {
  dockedThreadPane: boolean;
  pluginHost: boolean;
  agent: boolean;
  deviceLocalKeybinds: boolean;
  customTitleBar: boolean;
  /** Device keys in the OS keyring: key sign-in, enrollment and recovery (Stage 3). */
  deviceKeys: boolean;
};

export function detectPlatform(): AppPlatform {
  if ("__TAURI_INTERNALS__" in window) return "desktop";
  if (/Mobi|Android/i.test(navigator.userAgent)) return "mobile";
  return "web";
}

export function detectOs(): OsType {
  const ua = navigator.userAgent;
  if (ua.includes("Macintosh") || ua.includes("Mac OS")) return "macos";
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Linux")) return "linux";
  return "unknown";
}

export function getRuntimeCapabilities(platform: AppPlatform): RuntimeCapabilities {
  if (platform === "desktop") {
    return {
      dockedThreadPane: true,
      pluginHost: true,
      agent: true,
      deviceLocalKeybinds: true,
      customTitleBar: true,
      deviceKeys: true,
    };
  }

  if (platform === "web") {
    return {
      dockedThreadPane: true,
      pluginHost: false,
      agent: false,
      deviceLocalKeybinds: true,
      customTitleBar: false,
      deviceKeys: false,
    };
  }

  return {
    dockedThreadPane: false,
    pluginHost: false,
    agent: false,
    deviceLocalKeybinds: false,
    customTitleBar: false,
    deviceKeys: false,
  };
}
