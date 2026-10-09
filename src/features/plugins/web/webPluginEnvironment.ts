// The page side of the web plugin host: real iframes with the exact frame
// attributes, the window's messages, MessageChannels, page visibility, and
// which store backs the host on each platform.

import { logger } from "../../../core/logger";
import type { AppPlatform } from "../../../core/runtime/runtime";
import { hostDialogOpen, subscribeHostDialogs } from "../../../shared/ui/hostDialogs";
import { browserPluginStore } from "./browserPluginStore";
import { desktopPluginServices, rimOrigins, type PluginServices } from "./pluginServices";
import type { SessionPort } from "./pluginSession";
import {
  DESKTOP_SHELL_URL,
  FRAME_ALLOW,
  FRAME_SANDBOX,
  WEB_SHELL_URL,
  webPluginHost,
  type FrameHandle,
  type HostEnvironment,
} from "./webPluginHost";

/** The app's version, sent to plugins as `hostVersion`. */
export const HOST_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/** Where the frame shell is served on `platform`. */
export function shellUrl(platform: AppPlatform): string {
  return platform === "desktop" ? DESKTOP_SHELL_URL : WEB_SHELL_URL;
}

/**
 * Give `iframe` the attributes every plugin frame and panel frame has, before
 * its `src` is set: `sandbox` exactly `allow-scripts`, no referrer, no powerful
 * feature, and `credentialless` where the browser supports it.
 */
export function applyFrameAttributes(iframe: HTMLIFrameElement, title: string): void {
  iframe.setAttribute("sandbox", FRAME_SANDBOX);
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("allow", FRAME_ALLOW);
  iframe.setAttribute("credentialless", "");
  iframe.setAttribute("title", title);
}

let container: HTMLDivElement | null = null;

/** The hidden element plugin frames live in, inert while a host dialog is open. */
function frameContainer(): HTMLDivElement {
  if (container?.isConnected) return container;
  const div = document.createElement("div");
  div.id = "rim-plugin-frames";
  div.hidden = true;
  div.setAttribute("aria-hidden", "true");
  const sync = () => div.toggleAttribute("inert", hostDialogOpen());
  sync();
  subscribeHostDialogs(sync);
  document.body.appendChild(div);
  container = div;
  return div;
}

export function createDomEnvironment(platform: AppPlatform): HostEnvironment {
  const src = shellUrl(platform);
  return {
    shellUrl: src,
    hostVersion: HOST_VERSION,
    createFrame(title): FrameHandle {
      const iframe = document.createElement("iframe");
      applyFrameAttributes(iframe, title);
      iframe.style.display = "none";
      iframe.src = src;
      frameContainer().appendChild(iframe);
      return {
        get window() {
          return iframe.contentWindow;
        },
        onLoad(listener) {
          iframe.addEventListener("load", listener);
        },
        remove() {
          iframe.remove();
        },
      };
    },
    listen(listener) {
      const handle = (event: MessageEvent) =>
        listener({ origin: event.origin, source: event.source, data: event.data });
      window.addEventListener("message", handle);
      return () => window.removeEventListener("message", handle);
    },
    createChannel() {
      const channel = new MessageChannel();
      return { host: channel.port1 as SessionPort, plugin: channel.port2 };
    },
    isHidden: () => document.visibilityState === "hidden",
    log(pluginId, level, message) {
      const line = `[plugin:${pluginId}] ${message}`;
      if (level === "error") logger.error(line);
      else if (level === "warn") logger.warn(line);
      else logger.debug(line);
    },
  };
}

/** The store behind the host on `platform`. */
export function pluginServices(platform: AppPlatform): PluginServices {
  return platform === "desktop" ? desktopPluginServices : browserPluginStore;
}

let configuredFor: AppPlatform | null = null;

/** Connect the shared host to this page, once. */
export function configureWebPluginHost(platform: AppPlatform): void {
  if (configuredFor === platform) return;
  configuredFor = platform;
  webPluginHost.configure(createDomEnvironment(platform), pluginServices(platform), rimOrigins());
}
