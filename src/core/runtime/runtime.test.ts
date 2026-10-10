import { describe, it, expect, vi, afterEach } from "vitest";
import { getRuntimeCapabilities, getDeviceKeyStore, detectPlatform, detectOs } from "./runtime";

describe("getRuntimeCapabilities", () => {
  it("returns all capabilities enabled for desktop", () => {
    const caps = getRuntimeCapabilities("desktop");
    expect(caps.dockedThreadPane).toBe(true);
    expect(caps.pluginHost).toBe(true);
    expect(caps.webPlugins).toBe(true);
    expect(caps.agent).toBe(true);
    expect(caps.customTitleBar).toBe(true);
    expect(caps.deviceKeys).toBe(true);
    expect(caps.identityKeys).toBe(true);
  });

  it("returns limited capabilities for web", () => {
    const caps = getRuntimeCapabilities("web");
    expect(caps.dockedThreadPane).toBe(true);
    expect(caps.pluginHost).toBe(false);
    expect(caps.webPlugins).toBe(true);
    expect(caps.agent).toBe(false);
    expect(caps.customTitleBar).toBe(false);
    expect(caps.deviceKeys).toBe(false);
    expect(caps.identityKeys).toBe(false);
  });

  it("gives the web a device key only in a browser that can hold one", () => {
    expect(getRuntimeCapabilities("web", "browser").deviceKeys).toBe(true);
    expect(getRuntimeCapabilities("web", "browser").identityKeys).toBe(false);
    expect(getRuntimeCapabilities("web", "checking").deviceKeys).toBe(false);
    expect(getRuntimeCapabilities("web", "unsupported").deviceKeys).toBe(false);
  });

  it("runs encrypted conversations on the desktop, and on the web once the browser is set up", () => {
    expect(getRuntimeCapabilities("desktop").encryptedConversations).toBe(true);
    expect(getRuntimeCapabilities("web", "browser").encryptedConversations).toBe(false);
    expect(getRuntimeCapabilities("web", "browser", true).encryptedConversations).toBe(true);
    expect(getRuntimeCapabilities("web", "unsupported", true).encryptedConversations).toBe(false);
    expect(getRuntimeCapabilities("mobile", "none", true).encryptedConversations).toBe(false);
  });

  it("updates itself only on the desktop", () => {
    expect(getRuntimeCapabilities("desktop").updater).toBe(true);
    expect(getRuntimeCapabilities("web", "browser", true).updater).toBe(false);
    expect(getRuntimeCapabilities("mobile").updater).toBe(false);
  });

  it("returns all capabilities disabled for mobile", () => {
    const caps = getRuntimeCapabilities("mobile");
    expect(caps.dockedThreadPane).toBe(false);
    expect(caps.pluginHost).toBe(false);
    expect(caps.webPlugins).toBe(false);
    expect(caps.agent).toBe(false);
    expect(caps.deviceLocalKeybinds).toBe(false);
    expect(caps.customTitleBar).toBe(false);
    expect(caps.deviceKeys).toBe(false);
    expect(caps.identityKeys).toBe(false);
  });

  it("web still allows device-local keybinds", () => {
    const caps = getRuntimeCapabilities("web");
    expect(caps.deviceLocalKeybinds).toBe(true);
  });

  it("desktop enables device-local keybinds", () => {
    const caps = getRuntimeCapabilities("desktop");
    expect(caps.deviceLocalKeybinds).toBe(true);
  });
});

describe("getDeviceKeyStore", () => {
  it("names where each platform keeps its device key", () => {
    expect(getDeviceKeyStore("desktop")).toBe("keyring");
    expect(getDeviceKeyStore("mobile")).toBe("none");
    expect(getDeviceKeyStore("web")).toBe("checking");
    expect(getDeviceKeyStore("web", true)).toBe("browser");
    expect(getDeviceKeyStore("web", false)).toBe("unsupported");
  });
});

describe("detectPlatform", () => {
  afterEach(() => {
    // Clean up __TAURI_INTERNALS__ if set
    if ("__TAURI_INTERNALS__" in window) {
      delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it("returns 'web' when no Tauri internals and desktop user agent", () => {
    // jsdom default UA is not mobile, and __TAURI_INTERNALS__ is not present
    expect(detectPlatform()).toBe("web");
  });

  it("returns 'desktop' when __TAURI_INTERNALS__ is present", () => {
    (window as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(detectPlatform()).toBe("desktop");
  });

  it("returns 'mobile' when user agent matches mobile pattern", () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36",
      configurable: true,
    });
    expect(detectPlatform()).toBe("mobile");
    Object.defineProperty(navigator, "userAgent", {
      value: originalUA,
      configurable: true,
    });
  });
});

describe("detectOs", () => {
  function withUserAgent(ua: string, fn: () => void) {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
    fn();
    Object.defineProperty(navigator, "userAgent", { value: original, configurable: true });
  }

  it("detects macOS from user agent", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", () => {
      expect(detectOs()).toBe("macos");
    });
  });

  it("detects Windows from user agent", () => {
    withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", () => {
      expect(detectOs()).toBe("windows");
    });
  });

  it("detects Linux from user agent", () => {
    withUserAgent("Mozilla/5.0 (X11; Linux x86_64)", () => {
      expect(detectOs()).toBe("linux");
    });
  });

  it("returns 'unknown' for unrecognized user agent", () => {
    withUserAgent("Mozilla/5.0 (FancyOS 1.0)", () => {
      expect(detectOs()).toBe("unknown");
    });
  });
});
