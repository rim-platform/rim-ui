import { useRef, useEffect, useState, useCallback } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { createPluginBridge, followPanelState } from "../runtime/pluginBridge";
import { createThemeChangeMessage, onThemeChange } from "../runtime/pluginThemeBridge";
import { usePluginFocusManager } from "../runtime/pluginFocusManager";
import type { PluginCapability } from "../types";

const PLUGIN_PROTOCOL = "rim-plugin://";
const LOADING_DELAY = 2000;
const SLOW_DELAY = 15000;
const TIMEOUT_DELAY = 30000;

// Path traversal protection
function validatePluginUrl(pluginId: string, panelId: string): string | null {
  // Reject any path traversal attempts
  if (
    pluginId.includes("..") ||
    pluginId.includes("/") ||
    pluginId.includes("\\") ||
    panelId.includes("..") ||
    panelId.includes("/") ||
    panelId.includes("\\")
  ) {
    return null;
  }
  // Reject encoded traversal
  if (
    pluginId.includes("%2e") ||
    pluginId.includes("%2f") ||
    pluginId.includes("%5c") ||
    panelId.includes("%2e") ||
    panelId.includes("%2f") ||
    panelId.includes("%5c")
  ) {
    return null;
  }
  // Allow alphanumeric, dash, underscore, and dot (required for reverse-domain plugin IDs
  // like dev.example.hello-world). Note: we already rejected literal ".." above, so a
  // single dot here is safe — it cannot form a traversal after the earlier checks.
  const safePattern = /^[a-zA-Z0-9._-]+$/;
  if (!safePattern.test(pluginId) || !safePattern.test(panelId)) {
    return null;
  }
  return `${PLUGIN_PROTOCOL}${pluginId}/${panelId}/index.html`;
}

type LoadState = "idle" | "loading" | "slow" | "timeout" | "loaded" | "error";

interface PluginPanelProps {
  pluginId: string;
  panelId: string;
  /** The plugin's name, shown with its notifications. */
  pluginName?: string;
  approvedCapabilities: PluginCapability[];
  onClose: () => void;
}

export function PluginPanel({
  pluginId,
  panelId,
  pluginName,
  approvedCapabilities,
  onClose,
}: PluginPanelProps) {
  const { capabilities } = useRuntime();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { focusIframe, onWrapperKeyDown } = usePluginFocusManager(iframeRef, onClose);

  if (!capabilities.pluginHost) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-rim-text-muted">Plugins require the desktop app.</p>
      </div>
    );
  }

  const src = validatePluginUrl(pluginId, panelId);
  if (!src) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-rim-danger">Invalid plugin panel URL.</p>
      </div>
    );
  }

  return (
    <PluginPanelInner
      src={src}
      pluginId={pluginId}
      panelId={panelId}
      pluginName={pluginName}
      approvedCapabilities={approvedCapabilities}
      iframeRef={iframeRef}
      focusIframe={focusIframe}
      onWrapperKeyDown={onWrapperKeyDown}
      onClose={onClose}
    />
  );
}

interface PluginPanelInnerProps {
  src: string;
  pluginId: string;
  panelId: string;
  pluginName?: string;
  approvedCapabilities: PluginCapability[];
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  focusIframe: () => void;
  onWrapperKeyDown: (e: React.KeyboardEvent) => void;
  onClose: () => void;
}

function PluginPanelInner({
  src,
  pluginId,
  panelId,
  pluginName,
  approvedCapabilities,
  iframeRef,
  focusIframe,
  onWrapperKeyDown,
  onClose,
}: PluginPanelInnerProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  // Timer-based loading states
  useEffect(() => {
    setLoadState("idle");

    const loadingTimer = setTimeout(() => setLoadState("loading"), LOADING_DELAY);
    const slowTimer = setTimeout(() => setLoadState("slow"), SLOW_DELAY);
    const timeoutTimer = setTimeout(() => setLoadState("timeout"), TIMEOUT_DELAY);

    return () => {
      clearTimeout(loadingTimer);
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
    };
  }, [src, setLoadState]);

  // Bridge + theme sync
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const bridge = createPluginBridge({
      pluginId,
      pluginName,
      approvedCapabilities,
      iframe,
    });
    // Every change the plugin makes to this panel's state reaches the page.
    const panelState = followPanelState(pluginId, panelId, bridge.sendToPlugin);

    // Send the theme and the plugin's stored state each time the page (re)loads.
    function handleLoad() {
      setLoadState("loaded");
      bridge.sendToPlugin(createThemeChangeMessage());
      void panelState.load();
    }
    iframe.addEventListener("load", handleLoad);

    // Sync theme changes
    const unsubTheme = onThemeChange((msg) => bridge.sendToPlugin(msg));

    return () => {
      iframe.removeEventListener("load", handleLoad);
      unsubTheme();
      panelState.stop();
      bridge.destroy();
    };
  }, [pluginId, panelId, pluginName, approvedCapabilities, iframeRef, setLoadState]);

  const handleRetry = useCallback(() => {
    setLoadState("idle");
    if (iframeRef.current) {
      iframeRef.current.src = src;
    }
  }, [src, iframeRef, setLoadState]);

  return (
    <div className="relative flex h-full flex-col" onKeyDown={onWrapperKeyDown} tabIndex={-1}>
      {/* Loading overlay */}
      {loadState === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-rim-void/80">
          <Loader2 className="h-5 w-5 animate-spin text-rim-accent" />
        </div>
      )}

      {loadState === "slow" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-rim-void/80">
          <AlertTriangle className="h-5 w-5 text-rim-warm" />
          <p className="text-xs text-rim-warm">Plugin is taking longer than expected</p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}

      {loadState === "timeout" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-rim-void/80">
          <AlertTriangle className="h-5 w-5 text-rim-danger" />
          <p className="text-xs text-rim-danger">Plugin timed out</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {loadState === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-rim-void/80">
          <AlertTriangle className="h-5 w-5 text-rim-danger" />
          <p className="text-xs text-rim-danger">Failed to load plugin</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts"
        title={`Plugin: ${pluginId}`}
        className="h-full w-full border-0"
        onFocus={focusIframe}
        onError={() => setLoadState("error")}
      />
    </div>
  );
}
