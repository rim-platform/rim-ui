import { useCallback } from "react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { followPanelState, type HostToPluginMessage } from "../runtime/pluginBridge";
import type { PluginCapability } from "../types";
import { decodeBase64, type BundleFile } from "../web/bundle";
import { PluginFrame } from "./PluginFrame";

/**
 * The frame shell page for local-process panels: the same shell, served with a
 * policy header that closes the network.
 */
export const LOCAL_PANEL_SHELL_URL = "rim-plugin://shell/v1/local-panel.html";

/** No origin: a local panel reaches the network only through its plugin's process. */
const NO_ORIGINS: readonly string[] = [];

interface PluginPanelProps {
  pluginId: string;
  panelId: string;
  /** The plugin's name, shown with its notifications. */
  pluginName: string;
  approvedCapabilities: PluginCapability[];
  onClose: () => void;
}

/** The files of a local-process plugin's panel, read by the desktop host. */
async function readPanelFiles(pluginId: string, panelId: string): Promise<BundleFile[]> {
  const result = await safeInvoke<{ path: string; base64: string }[]>("plugin_panel_files", {
    pluginId,
    panelId,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.map((f) => ({ path: f.path, bytes: decodeBase64(f.base64) }));
}

/**
 * One open panel of a local-process plugin: the files of its panel folder in a
 * {@link PluginFrame}, with the panel state its plugin process sends.
 */
export function PluginPanel({
  pluginId,
  panelId,
  pluginName,
  approvedCapabilities,
  onClose,
}: PluginPanelProps) {
  const { capabilities } = useRuntime();
  const loadFiles = useCallback(() => readPanelFiles(pluginId, panelId), [pluginId, panelId]);
  const followState = useCallback(
    (send: (message: HostToPluginMessage) => void) => followPanelState(pluginId, panelId, send),
    [pluginId, panelId],
  );

  if (!capabilities.pluginHost) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-rim-text-muted">Plugins require the desktop app.</p>
      </div>
    );
  }

  return (
    <PluginFrame
      shellSrc={LOCAL_PANEL_SHELL_URL}
      pluginId={pluginId}
      panelId={panelId}
      pluginName={pluginName}
      approvedCapabilities={approvedCapabilities}
      loadFiles={loadFiles}
      origins={NO_ORIGINS}
      followState={followState}
      onClose={onClose}
    />
  );
}
