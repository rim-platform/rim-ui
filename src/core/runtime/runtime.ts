export type AppPlatform = "desktop" | "web" | "mobile";

export type OsType = "macos" | "windows" | "linux" | "unknown";

export type RuntimeCapabilities = {
  multiPaneShell: boolean;
  dockedThreadPane: boolean;
  pluginHost: boolean;
  deviceLocalKeybinds: boolean;
  globalShortcuts: boolean;
  localProcess: boolean;
  filesystemAccess: boolean;
  nativeNotifications: boolean;
  customTitleBar: boolean;
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
      multiPaneShell: true,
      dockedThreadPane: true,
      pluginHost: true,
      deviceLocalKeybinds: true,
      globalShortcuts: true,
      localProcess: true,
      filesystemAccess: true,
      nativeNotifications: true,
      customTitleBar: true,
    };
  }

  if (platform === "web") {
    return {
      multiPaneShell: true,
      dockedThreadPane: true,
      pluginHost: false,
      deviceLocalKeybinds: true,
      globalShortcuts: false,
      localProcess: false,
      filesystemAccess: false,
      nativeNotifications: false,
      customTitleBar: false,
    };
  }

  return {
    multiPaneShell: false,
    dockedThreadPane: false,
    pluginHost: false,
    deviceLocalKeybinds: false,
    globalShortcuts: false,
    localProcess: false,
    filesystemAccess: false,
    nativeNotifications: false,
    customTitleBar: false,
  };
}
