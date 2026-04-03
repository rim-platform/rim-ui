import { invoke } from "@tauri-apps/api/core";

import { logger } from "../../../core/logger";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import type { PluginCapability } from "../types";

// Plugin iframe → Host message types
type PluginToHostMessage =
  | { type: "rim.ui.notification.show"; title: string; body: string }
  | { type: "rim.ui.dialog.confirm"; title: string; body: string; requestId: string }
  | { type: "rim.command.execute"; commandId: string; args?: Record<string, unknown>; requestId?: string }
  | { type: "rim.settings.get"; key: string; requestId: string }
  | { type: "rim.settings.set"; key: string; value: unknown }
  | { type: "rim.plugin.ui_event"; eventName: string; payload: unknown };

// Host → Plugin iframe message types
export type HostToPluginMessage =
  | { type: "theme.changed"; variables: Record<string, string> }
  | { type: "panel.visibility"; visible: boolean }
  | { type: "panel.focus" }
  | { type: "panel.blur" }
  | { type: "panel.state_update"; state: unknown }
  | { type: "panel.state_patch"; patch: Record<string, unknown> }
  | { type: "conversation.changed"; conversationId: string | null };

// Capability requirements for each message type
const messageCapabilities: Record<string, PluginCapability | null> = {
  "rim.ui.notification.show": "notifications",
  "rim.ui.dialog.confirm": null,
  "rim.command.execute": null,
  "rim.settings.get": null,
  "rim.settings.set": null,
  "rim.plugin.ui_event": null,
};

const EXPECTED_ORIGIN = "null"; // sandboxed iframes have origin "null"

interface BridgeConfig {
  pluginId: string;
  approvedCapabilities: PluginCapability[];
  iframe: HTMLIFrameElement;
}

export function createPluginBridge(config: BridgeConfig) {
  const { pluginId, approvedCapabilities, iframe } = config;

  function handleMessage(event: MessageEvent) {
    // Strict origin validation — sandboxed iframes without allow-same-origin report origin "null"
    if (event.origin !== EXPECTED_ORIGIN) return;

    // Verify source is our iframe (lookup plugin_id from event.source, NOT message payload)
    if (event.source !== iframe.contentWindow) return;

    const msg = event.data as PluginToHostMessage;
    if (!msg || typeof msg.type !== "string") return;

    // Capability gating
    const requiredCap = messageCapabilities[msg.type];
    if (requiredCap && !approvedCapabilities.includes(requiredCap)) {
      logger.warn(`[RIM:PluginBridge] ${pluginId} denied: requires ${requiredCap} for ${msg.type}`);
      return;
    }

    switch (msg.type) {
      case "rim.ui.notification.show":
        logger.debug(`[RIM:PluginBridge] ${pluginId} notification:`, msg.title);
        break;

      case "rim.ui.dialog.confirm":
        logger.debug(`[RIM:PluginBridge] ${pluginId} dialog confirm:`, msg.title);
        break;

      case "rim.command.execute": {
        // Scope validation: plugin can only execute its own commands
        const allowedPrefix = `plugin.${pluginId}.`;
        if (!msg.commandId.startsWith(allowedPrefix)) {
          logger.warn(
            `[RIM:PluginBridge] ${pluginId} denied: attempted to execute "${msg.commandId}" outside its scope (must start with "${allowedPrefix}")`,
          );
          return;
        }
        logger.debug(`[RIM:PluginBridge] ${pluginId} execute:`, msg.commandId);
        dispatchCommand(
          {
            id: msg.commandId,
            title: "",
            description: "",
            category: "",
            sourceKind: "Plugin",
            executionTarget: "DesktopLocal",
            requiredContext: [],
            requiredCapabilities: [],
            visibleInPalette: false,
            visibleInContextMenus: false,
            keybindCapable: false,
            dangerous: false,
          },
          async () => ({ executeCommand: { status: "Success", message: "", payload: null, followUpCommands: [] } }),
          { args: msg.args },
        );
        break;
      }

      case "rim.plugin.ui_event":
        // UI event relay: iframe → frontend → Tauri invoke → plugin process
        logger.debug(`[RIM:PluginBridge] ${pluginId} ui_event:`, msg.eventName);
        relayUiEventToProcess(pluginId, msg.eventName, msg.payload);
        break;

      case "rim.settings.get":
        logger.debug(`[RIM:PluginBridge] ${pluginId} settings.get:`, msg.key);
        break;

      case "rim.settings.set":
        logger.debug(`[RIM:PluginBridge] ${pluginId} settings.set:`, msg.key);
        break;
    }
  }

  window.addEventListener("message", handleMessage);

  function sendToPlugin(message: HostToPluginMessage) {
    iframe.contentWindow?.postMessage(message, "*");
  }

  function destroy() {
    window.removeEventListener("message", handleMessage);
  }

  return { sendToPlugin, destroy };
}

// ─── Host relay: process ↔ iframe ──────────────────────────────────

/**
 * Relay a UI event from iframe to the plugin process via Tauri invoke.
 */
async function relayUiEventToProcess(
  pluginId: string,
  eventName: string,
  payload: unknown,
): Promise<void> {
  try {
    await invoke("plugin_relay_ui_event", {
      ...{ pluginId, eventName, payload: payload ?? null },
    });
  } catch {
    // Tauri command not yet available — no-op for development
    logger.debug(`[RIM:PluginBridge] Mock relay ui_event: ${pluginId}.${eventName}`);
  }
}

/**
 * Fetch cached panel state from Tauri and send to iframe.
 * Called when a plugin panel is (re)opened.
 */
export async function fetchAndRelayPanelState(
  pluginId: string,
  sendToPlugin: (message: HostToPluginMessage) => void,
): Promise<void> {
  try {
    const state = await invoke<unknown>("plugin_panel_state", {
      ...{ pluginId },
    });
    if (state !== null && state !== undefined) {
      sendToPlugin({ type: "panel.state_update", state });
    }
  } catch {
    // Tauri command not yet available — no-op for development
    logger.debug(`[RIM:PluginBridge] Mock fetch panel state: ${pluginId}`);
  }
}
