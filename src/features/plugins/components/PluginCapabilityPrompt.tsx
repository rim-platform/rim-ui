import { useState } from "react";
import { Shield } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { useApproveCapabilities } from "../api/usePluginCapabilities";
import { TrustBadge } from "./TrustBadge";
import type { PluginManifest, PluginCapability } from "../types";

const capabilityLabels: Record<PluginCapability, string> = {
  filesystem: "File System Access",
  network: "Network Access",
  notifications: "Notifications",
  clipboard: "Clipboard Access",
  shell: "Shell Commands",
  system_info: "System Information",
};

const capabilityDescriptions: Record<PluginCapability, string> = {
  filesystem: "Read and write files on your device",
  network: "Make network requests to external services",
  notifications: "Show desktop notifications",
  clipboard: "Read and write to the clipboard",
  shell: "Execute shell commands on your device",
  system_info: "Read system information",
};

interface PluginCapabilityPromptProps {
  open: boolean;
  onClose: () => void;
  manifest: PluginManifest;
}

export function PluginCapabilityPrompt({ open, onClose, manifest }: PluginCapabilityPromptProps) {
  const [selected, setSelected] = useState<Set<PluginCapability>>(
    () => new Set(manifest.capabilities),
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
      { pluginId: manifest.id, capabilities: Array.from(selected) },
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-rim-text">{manifest.name}</span>
              <TrustBadge level={manifest.trust_level} />
            </div>
            <p className="text-xs text-rim-text-muted">v{manifest.version} by {manifest.author}</p>
          </div>
        </div>

        <p className="text-xs text-rim-text-muted">
          This plugin requests the following permissions. Uncheck any you want to deny.
        </p>

        <div className="space-y-1">
          {manifest.capabilities.map((cap) => (
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
                <p className="text-sm text-rim-text">{capabilityLabels[cap]}</p>
                <p className="text-xs text-rim-text-muted">{capabilityDescriptions[cap]}</p>
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
