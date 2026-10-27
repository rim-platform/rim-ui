export type AppPlatform = "desktop" | "web" | "mobile";

export type OsType = "macos" | "windows" | "linux" | "unknown";

export type RuntimeCapabilities = {
  dockedThreadPane: boolean;
  /** Plugins that run as local processes. Desktop only. */
  pluginHost: boolean;
  /** WebSandboxed plugins, which run in sandboxed frames of the app: desktop and web. */
  webPlugins: boolean;
  agent: boolean;
  deviceLocalKeybinds: boolean;
  customTitleBar: boolean;
  /**
   * A device key of this app's own: key sign-in and linking this device with a code. On the
   * web, only when the browser has WebCrypto Ed25519.
   */
  deviceKeys: boolean;
  /**
   * An identity key of this app's own: enrollment, key-only signup, recovery, rotation, the
   * profile card and linking other devices. On the web, wherever the browser can hold a device
   * key.
   */
  identityKeys: boolean;
  /** The identity key's backup in the history archive, and taking it over. Desktop only. */
  identityBackup: boolean;
  /** Signing plugin manifests as their publisher with the identity key. Desktop only. */
  pluginSigning: boolean;
  /**
   * Reading and sending in end-to-end encrypted conversations: the desktop, and the web once
   * the browser holds a device key for the account and the MLS module has loaded.
   */
  encryptedConversations: boolean;
  /** Checking for, downloading and installing new versions of the app. Desktop only. */
  updater: boolean;
};

/**
 * Where this app keeps its device key: the secret vault (desktop), the browser (web, with
 * WebCrypto Ed25519), or nowhere. `checking` while the browser is probed, `unsupported` when it
 * lacks Ed25519 or IndexedDB.
 */
export type DeviceKeyStore = "keyring" | "browser" | "checking" | "unsupported" | "none";

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

/** The shortcut that confirms a dialog, as this platform writes it: ⌘↵ on macOS, Ctrl+↵ elsewhere. */
export function confirmShortcutLabel(): string {
  return detectOs() === "macos" ? "⌘↵" : "Ctrl+↵";
}

/** Where `platform` keeps its device key; `browserKeys` is the web probe's answer, if known. */
export function getDeviceKeyStore(platform: AppPlatform, browserKeys?: boolean): DeviceKeyStore {
  if (platform === "desktop") return "keyring";
  if (platform !== "web") return "none";
  if (browserKeys === undefined) return "checking";
  return browserKeys ? "browser" : "unsupported";
}

export function getRuntimeCapabilities(
  platform: AppPlatform,
  deviceKeyStore: DeviceKeyStore = getDeviceKeyStore(platform),
  webEncryptionReady = false,
): RuntimeCapabilities {
  if (platform === "desktop") {
    return {
      dockedThreadPane: true,
      pluginHost: true,
      webPlugins: true,
      agent: true,
      deviceLocalKeybinds: true,
      customTitleBar: true,
      deviceKeys: true,
      identityKeys: true,
      identityBackup: true,
      pluginSigning: true,
      encryptedConversations: true,
      updater: true,
    };
  }

  if (platform === "web") {
    return {
      dockedThreadPane: true,
      pluginHost: false,
      webPlugins: true,
      agent: false,
      deviceLocalKeybinds: true,
      customTitleBar: false,
      deviceKeys: deviceKeyStore === "browser",
      identityKeys: deviceKeyStore === "browser",
      identityBackup: false,
      pluginSigning: false,
      encryptedConversations: deviceKeyStore === "browser" && webEncryptionReady,
      updater: false,
    };
  }

  return {
    dockedThreadPane: false,
    pluginHost: false,
    webPlugins: false,
    agent: false,
    deviceLocalKeybinds: false,
    customTitleBar: false,
    deviceKeys: false,
    identityKeys: false,
    identityBackup: false,
    pluginSigning: false,
    encryptedConversations: false,
    updater: false,
  };
}
