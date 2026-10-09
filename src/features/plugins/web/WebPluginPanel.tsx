import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { useHostDialogOpen } from "../../../shared/ui/hostDialogs";
import { createPluginBridge } from "../runtime/pluginBridge";
import { usePluginFocusManager } from "../runtime/pluginFocusManager";
import { createThemeChangeMessage, onThemeChange } from "../runtime/pluginThemeBridge";
import type { PluginCapability } from "../types";
import { mediaTypeOf } from "./bundle";
import { shellUrl } from "./webPluginEnvironment";
import { FRAME_ALLOW, FRAME_SANDBOX, webPluginHost } from "./webPluginHost";

/** Messages a minute a panel frame may send the host; the rest are dropped. */
const PANEL_MESSAGES_PER_MINUTE = 600;

/** `credentialless` is not in React's iframe props yet; the browser reads it as an attribute. */
const CREDENTIALLESS = { credentialless: "" } as object;

interface WebPluginPanelProps {
  pluginId: string;
  panelId: string;
  pluginName: string;
  approvedCapabilities: PluginCapability[];
  onClose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One open panel of a web plugin: a sandboxed frame that loads the frame shell,
 * gets the panel's verified files in `rim.frame.init`, and then speaks the
 * panel bridge like any plugin panel. The host sends it the theme and its
 * plugin's panel state once the shell says the panel rendered.
 */
export function WebPluginPanel({
  pluginId,
  panelId,
  pluginName,
  approvedCapabilities,
  onClose,
}: WebPluginPanelProps) {
  const { platform } = useRuntime();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { focusIframe, onWrapperKeyDown } = usePluginFocusManager(iframeRef, onClose);
  const inert = useHostDialogOpen();
  const health = useSyncExternalStore(
    (listener) => webPluginHost.subscribe(listener),
    () => webPluginHost.status(pluginId).health,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const files = useMemo(
    () => (health === "running" ? webPluginHost.panelFiles(pluginId, panelId) : null),
    [health, pluginId, panelId],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !files) return;
    const bridge = createPluginBridge({
      pluginId,
      pluginName,
      approvedCapabilities,
      iframe,
      maxMessagesPerMinute: PANEL_MESSAGES_PER_MINUTE,
    });
    const origins = webPluginHost.panelOrigins(pluginId);
    let loads = 0;

    function sendStoredState() {
      bridge.sendToPlugin(createThemeChangeMessage());
      const state = webPluginHost.relay.getState(pluginId, panelId);
      if (state !== null) bridge.sendToPlugin({ type: "panel.state_update", state });
    }

    function handleLoad() {
      loads += 1;
      // Only the panel's own code can navigate its frame: the panel is closed.
      if (loads > 1) {
        setFailure("The panel navigated away from its page, so it was closed.");
        return;
      }
      const transfer: ArrayBuffer[] = [];
      const payload = (files ?? []).map((file) => {
        const bytes = file.bytes.slice().buffer;
        transfer.push(bytes);
        return { path: file.path, type: mediaTypeOf(file.path), bytes };
      });
      iframe?.contentWindow?.postMessage(
        {
          type: "rim.frame.init",
          v: 1,
          kind: "panel",
          pluginId,
          panelId,
          policy: { origins },
          files: payload,
        },
        "*",
        transfer,
      );
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin !== "null" || event.source !== iframe?.contentWindow) return;
      const data: unknown = event.data;
      if (!isRecord(data) || data.v !== 1) return;
      if (data.type === "rim.frame.ready") sendStoredState();
      if (data.type === "rim.frame.error") {
        setFailure(
          typeof data.message === "string"
            ? data.message.slice(0, 300)
            : "The panel failed to load.",
        );
      }
    }

    iframe.addEventListener("load", handleLoad);
    window.addEventListener("message", handleMessage);
    const unsubscribeState = webPluginHost.relay.subscribe((change) => {
      if (change.pluginId === pluginId && change.panelId === panelId) {
        bridge.sendToPlugin({ type: "panel.state_update", state: change.state });
      }
    });
    const unsubscribeTheme = onThemeChange((message) => bridge.sendToPlugin(message));
    return () => {
      iframe.removeEventListener("load", handleLoad);
      window.removeEventListener("message", handleMessage);
      unsubscribeState();
      unsubscribeTheme();
      bridge.destroy();
    };
  }, [files, pluginId, panelId, pluginName, approvedCapabilities]);

  if (failure) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <AlertTriangle className="h-5 w-5 text-rim-danger" />
        <p className="text-xs text-rim-danger">{failure}</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  if (!files) {
    const error = webPluginHost.status(pluginId).error;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm text-rim-text-muted">{pluginName} is not running.</p>
        {error && <p className="text-xs text-rim-text-faint">{error}</p>}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col" onKeyDown={onWrapperKeyDown} tabIndex={-1}>
      <iframe
        ref={iframeRef}
        src={shellUrl(platform)}
        sandbox={FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        allow={FRAME_ALLOW}
        {...CREDENTIALLESS}
        inert={inert}
        title={`Plugin: ${pluginName}`}
        className="h-full w-full border-0"
        onFocus={focusIframe}
      />
    </div>
  );
}
