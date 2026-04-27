import { useState } from "react";
import { Shield } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { useApproveCapabilities } from "../api/usePluginCapabilities";
import { parsePluginCapabilities, type PluginInfo, type PluginCapability } from "../types";

const capabilityLabels: Record<PluginCapability, string> = {
  "chat.read": "Read Chat Messages",
  "chat.write": "Send Chat Messages",
  "events.read": "Receive Workspace Events",
  "local.process": "Run Local Processes",
  "network": "Network Access",
  "fs.read": "Read Files",
  "fs.write": "Write Files",
  "ui.notify": "Show Notifications",
  "ui.panel": "Render UI Panels",
};

const capabilityDescriptions: Record<PluginCapability, string> = {
  "chat.read": "Read messages and search conversation history",
  "chat.write": "Send, edit, and delete messages on your behalf",
  "events.read": "Subscribe to workspace events such as member joins and status changes",
  "local.process": "Spawn and control processes on your device",
  "network": "Make outbound network requests to external services",
  "fs.read": "Read files and list directories on your device",
  "fs.write": "Create, modify, and delete files on your device",
  "ui.notify": "Show desktop notifications",
  "ui.panel": "Render custom UI panels inside the workspace",
};

interface PluginCapabilityPromptProps {
  open: boolean;
  onClose: () => void;
  plugin: PluginInfo;
}

export function PluginCapabilityPrompt({ open, onClose, plugin }: PluginCapabilityPromptProps) {
  const parsedCapabilities = parsePluginCapabilities(plugin.capabilities);
  const [selected, setSelected] = useState<Set<PluginCapability>>(
    () => new Set(parsedCapabilities),
  );
  const approve = useApproveCapabilities();

  function toggleCapability(cap: PluginCapability) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
      } else {
        next.add(cap);
      }
      return next;
    });
  }

  function handleApprove() {
    approve.mutate(
      { pluginId: plugin.plugin_id, capabilities: Array.from(selected) },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Plugin Permissions" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rim-accent/15">
            <Shield className="h-5 w-5 text-rim-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-rim-text">{plugin.display_name}</span>
            <p className="text-xs text-rim-text-muted">v{plugin.version}{plugin.author ? ` by ${plugin.author}` : ""}</p>
          </div>
        </div>

        <p className="text-xs text-rim-text-muted">
          This plugin requests the following permissions. Uncheck any you want to deny.
        </p>

        <div className="space-y-1">
          {parsedCapabilities.map((cap) => (
            <label
              key={cap}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={selected.has(cap)}
                onChange={() => toggleCapability(cap)}
                className="mt-0.5 accent-rim-accent"
              />
              <div>
                <p className="text-sm text-rim-text">{capabilityLabels[cap] ?? cap}</p>
                <p className="text-xs text-rim-text-muted">{capabilityDescriptions[cap] ?? ""}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" isLoading={approve.isPending} onClick={handleApprove}>
            Approve
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
