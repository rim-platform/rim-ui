import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { useHostDialogOpen } from "../../../shared/ui/hostDialogs";
import {
  createPluginBridge,
  type HostToPluginMessage,
  type PanelStateFollower,
} from "../runtime/pluginBridge";
import { usePluginFocusManager } from "../runtime/pluginFocusManager";
import { createThemeChangeMessage, onThemeChange } from "../runtime/pluginThemeBridge";
import type { PluginCapability } from "../types";
import { mediaTypeOf, type BundleFile } from "../web/bundle";
import { FRAME_ALLOW, FRAME_SANDBOX } from "../web/webPluginHost";

const LOADING_DELAY = 2000;
const SLOW_DELAY = 15000;
const TIMEOUT_DELAY = 30000;

/** Messages a minute a panel frame may send the host; the rest are dropped. */
const PANEL_MESSAGES_PER_MINUTE = 600;

/**
 * `credentialless` is not in React's iframe prop types yet. React renders it as
 * a boolean attribute, so it must be `true`: an empty string leaves it out.
 */
const CREDENTIALLESS = { credentialless: true } as object;

type LoadState = "waiting" | "loading" | "slow" | "timeout" | "loaded";

export interface PluginFrameProps {
  /** The frame shell page to load; its policy header bounds what the panel may reach. */
  shellSrc: string;
  pluginId: string;
  panelId: string;
  pluginName: string;
  approvedCapabilities: PluginCapability[];
  /** Reads the panel's files, with paths relative to its folder. */
  loadFiles: () => Promise<BundleFile[]>;
  /** The origins the panel may reach. */
  origins: readonly string[];
  /**
   * Sends the panel every change its plugin makes to its state from now on,
   * and the stored state on `load`.
   */
  followState: (send: (message: HostToPluginMessage) => void) => PanelStateFollower;
  onClose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300) || "The panel failed to load.";
}

/**
 * One open plugin panel: a sandboxed frame that loads the frame shell, gets the
 * panel's files in `rim.frame.init` once the shell says hello, and then speaks
 * the panel bridge. The host sends it the theme and its plugin's panel state
 * once the shell says the panel rendered. Retry starts over with a new frame.
 */
export function PluginFrame(props: PluginFrameProps) {
  const [attempt, setAttempt] = useState(0);
  return <FrameAttempt key={attempt} {...props} onRetry={() => setAttempt((n) => n + 1)} />;
}

function FrameAttempt({
  shellSrc,
  pluginId,
  panelId,
  pluginName,
  approvedCapabilities,
  loadFiles,
  origins,
  followState,
  onClose,
  onRetry,
}: PluginFrameProps & { onRetry: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { focusIframe, onWrapperKeyDown } = usePluginFocusManager(iframeRef, onClose);
  const inert = useHostDialogOpen();
  const [files, setFiles] = useState<BundleFile[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("waiting");
  const [failure, setFailure] = useState<string | null>(null);
  // Loads of this frame so far; any after the first are the panel navigating away.
  const loads = useRef(0);
  // Whether the panel's files went to the frame: once per frame, never again.
  const initSent = useRef(false);

  useEffect(() => {
    let current = true;
    loadFiles().then(
      (loaded) => {
        if (current) setFiles(loaded);
      },
      (error: unknown) => {
        if (current) setFailure(errorMessage(error));
      },
    );
    return () => {
      current = false;
    };
  }, [loadFiles]);

  useEffect(() => {
    const advance = (next: LoadState) => () =>
      setLoadState((state) => (state === "loaded" ? state : next));
    const timers = [
      setTimeout(advance("loading"), LOADING_DELAY),
      setTimeout(advance("slow"), SLOW_DELAY),
      setTimeout(advance("timeout"), TIMEOUT_DELAY),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // A layout effect, so its listeners are in place before the shell can say hello
  // or the frame can fire `load`.
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !files) return;
    const bridge = createPluginBridge({
      pluginId,
      pluginName,
      approvedCapabilities,
      iframe,
      maxMessagesPerMinute: PANEL_MESSAGES_PER_MINUTE,
    });
    const panelState = followState(bridge.sendToPlugin);

    function handleLoad() {
      loads.current += 1;
      // Only the panel's own code can navigate its frame: the panel is closed.
      if (loads.current > 1) {
        setFailure("The panel navigated away from its page, so it was closed.");
      }
    }

    /** Hand the panel's files to the shell, which said hello before any of them ran. */
    function sendInit() {
      if (initSent.current || loads.current > 1) return;
      initSent.current = true;
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
      if (data.type === "rim.frame.hello") sendInit();
      if (data.type === "rim.frame.ready") {
        setLoadState("loaded");
        bridge.sendToPlugin(createThemeChangeMessage());
        void panelState.load();
      }
      if (data.type === "rim.frame.error") {
        setFailure(errorMessage(typeof data.message === "string" ? data.message : ""));
      }
    }

    iframe.addEventListener("load", handleLoad);
    window.addEventListener("message", handleMessage);
    const unsubscribeTheme = onThemeChange((message) => bridge.sendToPlugin(message));
    return () => {
      iframe.removeEventListener("load", handleLoad);
      window.removeEventListener("message", handleMessage);
      unsubscribeTheme();
      panelState.stop();
      bridge.destroy();
    };
  }, [files, pluginId, panelId, pluginName, approvedCapabilities, origins, followState]);

  if (failure) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <AlertTriangle className="h-5 w-5 text-rim-danger" />
        <p className="text-xs text-rim-danger">Failed to load plugin</p>
        <p className="text-xs text-rim-text-faint">{failure}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col" onKeyDown={onWrapperKeyDown} tabIndex={-1}>
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
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {files && (
        <iframe
          ref={iframeRef}
          src={shellSrc}
          sandbox={FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          allow={FRAME_ALLOW}
          {...CREDENTIALLESS}
          inert={inert}
          title={`Plugin: ${pluginName}`}
          className="h-full w-full border-0"
          onFocus={focusIframe}
        />
      )}
    </div>
  );
}
