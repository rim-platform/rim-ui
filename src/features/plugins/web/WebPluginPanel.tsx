import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { PluginFrame } from "../components/PluginFrame";
import type { HostToPluginMessage, PanelStateFollower } from "../runtime/pluginBridge";
import type { PluginCapability } from "../types";
import { shellUrl } from "./webPluginEnvironment";
import { webPluginHost } from "./webPluginHost";

interface WebPluginPanelProps {
  pluginId: string;
  panelId: string;
  pluginName: string;
  approvedCapabilities: PluginCapability[];
  onClose: () => void;
}

/**
 * One open panel of a web plugin: its verified files from the running plugin's
 * bundle in a {@link PluginFrame}, with the panel state the plugin keeps in the
 * web host's relay.
 */
export function WebPluginPanel({
  pluginId,
  panelId,
  pluginName,
  approvedCapabilities,
  onClose,
}: WebPluginPanelProps) {
  const { platform } = useRuntime();
  const health = useSyncExternalStore(
    (listener) => webPluginHost.subscribe(listener),
    () => webPluginHost.status(pluginId).health,
  );
  const files = useMemo(
    () => (health === "running" ? webPluginHost.panelFiles(pluginId, panelId) : null),
    [health, pluginId, panelId],
  );
  const origins = useMemo(
    () => (health === "running" ? webPluginHost.panelOrigins(pluginId) : []),
    [health, pluginId],
  );
  const loadFiles = useCallback(() => Promise.resolve(files ?? []), [files]);
  const followState = useCallback(
    (send: (message: HostToPluginMessage) => void): PanelStateFollower => {
      const stop = webPluginHost.relay.subscribe((change) => {
        if (change.pluginId === pluginId && change.panelId === panelId) {
          send({ type: "panel.state_update", state: change.state });
        }
      });
      return {
        async load() {
          const state = webPluginHost.relay.getState(pluginId, panelId);
          if (state !== null) send({ type: "panel.state_update", state });
        },
        stop,
      };
    },
    [pluginId, panelId],
  );

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
    <PluginFrame
      shellSrc={shellUrl(platform)}
      pluginId={pluginId}
      panelId={panelId}
      pluginName={pluginName}
      approvedCapabilities={approvedCapabilities}
      loadFiles={loadFiles}
      origins={origins}
      followState={followState}
      onClose={onClose}
    />
  );
}
