import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { logger } from "../../../core/logger";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { toast } from "../../../shared/toast";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { showPluginNotification } from "./pluginNotification";
import { isCancelledResult } from "./pluginCommandInfo";
import type { PluginCapability } from "../types";

// Plugin iframe → Host message types
type PluginToHostMessage =
  | { type: "rim.ui.notification.show"; title: string; body: string }
  | { type: "rim.ui.dialog.confirm"; title: string; body: string; requestId: string }
  | {
      type: "rim.command.execute";
      commandId: string;
      args?: Record<string, unknown>;
      requestId?: string;
    }
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
  | { type: "conversation.changed"; conversationId: string | null }
  /** The answer to a panel's `rim.command.execute` that carried a `requestId`. */
  | {
      type: "rim.command.result";
      requestId: string;
      ok: boolean;
      message: string;
      payload: unknown;
      /** The user declined to confirm a dangerous command, so nothing ran. */
      cancelled?: boolean;
    };

// Capability requirements for each message type
const messageCapabilities: Record<string, PluginCapability | null> = {
  "rim.ui.notification.show": "ui.notify",
  "rim.ui.dialog.confirm": null,
  "rim.command.execute": null,
  "rim.settings.get": null,
  "rim.settings.set": null,
  "rim.plugin.ui_event": null,
};

const EXPECTED_ORIGIN = "null"; // sandboxed iframes have origin "null"

interface BridgeConfig {
  pluginId: string;
  /** Shown with the panel's notifications, so they cannot pass for the app's own. */
  pluginName?: string;
  approvedCapabilities: PluginCapability[];
  iframe: HTMLIFrameElement;
}

/** How long a request id from a panel may be, so it cannot flood the reply. */
const MAX_REQUEST_ID_LENGTH = 100;

export function createPluginBridge(config: BridgeConfig) {
  const { pluginId, approvedCapabilities, iframe } = config;
  const pluginName = config.pluginName ?? pluginId;

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
        void showPluginNotification(pluginName, msg.title, msg.body);
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
        // The panel never confirms a dangerous command: only `args` and the
        // caller go through, and the host asks the user itself.
        const requestId =
          typeof msg.requestId === "string" && msg.requestId.length <= MAX_REQUEST_ID_LENGTH
            ? msg.requestId
            : null;
        const answer = (
          result: Omit<HostToPluginMessage & { type: "rim.command.result" }, "type" | "requestId">,
        ) => {
          if (requestId !== null)
            sendToPlugin({ type: "rim.command.result", requestId, ...result });
        };
        dispatchCommand(
          {
            id: msg.commandId,
            title: "",
            description: "",
            category: "",
            sourceKind: "PLUGIN",
            executionTarget: "DESKTOP_LOCAL",
            requiredContext: [],
            requiredCapabilities: [],
            visibleInPalette: false,
            visibleInContextMenus: false,
            keybindCapable: false,
            dangerous: false,
          },
          async () => ({
            executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
          }),
          { args: msg.args, callerPluginId: pluginId },
        )
          .then((result) => {
            if (isCancelledResult(result)) {
              answer({ ok: false, message: "Cancelled", payload: null, cancelled: true });
            } else if (result === null || result.status === "ERROR") {
              const message = result?.message || "Command failed";
              // A panel that asked for no answer still lets the user see the failure.
              if (requestId === null) toast.error(`${pluginName}: ${message}`);
              answer({ ok: false, message, payload: null });
            } else {
              answer({ ok: true, message: result.message, payload: result.payload });
            }
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[RIM:PluginBridge] ${pluginId} ${msg.commandId} failed`, error);
            answer({ ok: false, message, payload: null });
          });
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
    // Sandboxed iframes have origin "null", so we must use "*" for postMessage.
    // Inbound messages are validated by origin check in the message event handler.
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
  const result = await safeInvoke<void>("plugin_relay_ui_event", {
    pluginId,
    eventName,
    payload: payload ?? null,
  });
  if (!result.ok) {
    if (result.error.kind === "ipc_unavailable") {
      logger.debug(`[RIM:PluginBridge] Mock relay ui_event: ${pluginId}.${eventName}`);
      return;
    }
    logger.warn(
      `[RIM:PluginBridge] relay ui_event failed (${result.error.kind}):`,
      result.error.message,
    );
  }
}

/** The Tauri event the host emits each time a plugin changes one of its panels' state. */
export const PANEL_STATE_EVENT = "plugin-panel-state";

interface PanelStateChange {
  plugin_id: string;
  panel_id: string;
  state: unknown;
}

/** A panel's link to its plugin's state, from {@link followPanelState}. */
export interface PanelStateFollower {
  /**
   * Send the panel the state its plugin holds now. Call it each time the panel
   * page (re)loads; a live change that arrives meanwhile wins over it.
   */
  load: () => Promise<void>;
  /** Stop sending changes. */
  stop: () => void;
}

/**
 * Send the panel every state change its plugin makes from now on, as
 * `panel.state_update` (`state: null` once the plugin stopped), and its stored
 * state on {@link PanelStateFollower.load}. Outside the desktop app there is no
 * plugin host, so nothing is sent.
 */
export function followPanelState(
  pluginId: string,
  panelId: string,
  sendToPlugin: (message: HostToPluginMessage) => void,
): PanelStateFollower {
  let active = true;
  let liveChanges = 0;
  let unlisten: (() => void) | null = null;

  const ready: Promise<void> = isTauri()
    ? listen<PanelStateChange>(PANEL_STATE_EVENT, (event) => {
        const change = event.payload;
        if (!active || change.plugin_id !== pluginId || change.panel_id !== panelId) return;
        liveChanges += 1;
        sendToPlugin({ type: "panel.state_update", state: change.state });
      })
        .then((stop) => {
          if (active) unlisten = stop;
          else stop();
        })
        .catch((error: unknown) => {
          logger.warn(`[RIM:PluginBridge] cannot follow panel state of ${pluginId}`, error);
        })
    : Promise.resolve();

  return {
    async load() {
      // Listen first, so no change falls between the stored state and the live ones.
      await ready;
      const before = liveChanges;
      await fetchAndRelayPanelState(pluginId, panelId, (message) => {
        // A change pushed while the stored state was on its way is newer.
        if (active && liveChanges === before) sendToPlugin(message);
      });
    },
    stop() {
      active = false;
      unlisten?.();
      unlisten = null;
    },
  };
}

/**
 * Fetch cached panel state from Tauri and send to iframe.
 * Called when a plugin panel is (re)opened.
 */
export async function fetchAndRelayPanelState(
  pluginId: string,
  panelId: string,
  sendToPlugin: (message: HostToPluginMessage) => void,
): Promise<void> {
  const result = await safeInvoke<unknown>("plugin_panel_state", { pluginId, panelId });
  if (!result.ok) {
    if (result.error.kind === "ipc_unavailable") {
      logger.debug(`[RIM:PluginBridge] Mock fetch panel state: ${pluginId}`);
      return;
    }
    logger.warn(
      `[RIM:PluginBridge] fetch panel state failed (${result.error.kind}):`,
      result.error.message,
    );
    return;
  }
  if (result.value !== null && result.value !== undefined) {
    sendToPlugin({ type: "panel.state_update", state: result.value });
  }
}
