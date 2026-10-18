import { useState } from "react";
import { Shield } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { usePluginEnable } from "../api/usePluginActions";
import { useApproveCapabilities } from "../api/usePluginCapabilities";
import {
  parsePluginCapabilities,
  runtimeKind,
  type PluginInfo,
  type PluginCapability,
} from "../types";
import {
  CHAT_CONSENT_TEXT,
  KIND_CONSENT_TEXT,
  isChatCapability,
  networkFetchText,
  plainCapabilityOf,
} from "./consentText";

const capabilityLabels: Record<PluginCapability, string> = {
  "chat.read": "Read Chat Messages",
  "chat.write": "Send Chat Messages",
  "chat.read.encrypted": "Read Encrypted Messages",
  "chat.write.encrypted": "Send Encrypted Messages",
  "ui.notify": "Show Notifications",
  "ui.panel": "Render UI Panels",
  "network.fetch": "Connect to listed sites",
};

const capabilityDescriptions: Record<PluginCapability, string> = {
  "chat.read": CHAT_CONSENT_TEXT["chat.read"],
  "chat.write": CHAT_CONSENT_TEXT["chat.write"],
  "chat.read.encrypted": CHAT_CONSENT_TEXT["chat.read.encrypted"],
  "chat.write.encrypted": CHAT_CONSENT_TEXT["chat.write.encrypted"],
  "ui.notify": "Show desktop notifications",
  "ui.panel": "Render custom UI panels inside the workspace",
  "network.fetch": "Send and receive data from the sites the plugin lists",
};

/** How much of a plugin's description the permission prompt shows. */
const MAX_DESCRIPTION_LENGTH = 600;

function clipDescription(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…` : text;
}

interface PluginCapabilityPromptProps {
  open: boolean;
  onClose: () => void;
  plugin: PluginInfo;
  /** Set right after an install: approving also turns the plugin on. */
  startOnApprove?: boolean;
}

export function PluginCapabilityPrompt({
  open,
  onClose,
  plugin,
  startOnApprove = false,
}: PluginCapabilityPromptProps) {
  const parsedCapabilities = parsePluginCapabilities(plugin.capabilities);
  const [selected, setSelected] = useState<Set<PluginCapability>>(
    () => new Set(parsedCapabilities),
  );
  const approve = useApproveCapabilities();
  const enable = usePluginEnable();
  const [startError, setStartError] = useState<string | null>(null);
  const start = startOnApprove && !plugin.enabled;

  // An encrypted chat capability needs its plain one: checking it checks the plain one,
  // and unchecking the plain one unchecks it.
  function toggleCapability(cap: PluginCapability) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
        for (const other of parsedCapabilities) {
          if (plainCapabilityOf(other) === cap) next.delete(other);
        }
      } else {
        next.add(cap);
        const plain = plainCapabilityOf(cap);
        if (plain && parsedCapabilities.includes(plain as PluginCapability)) {
          next.add(plain as PluginCapability);
        }
      }
      return next;
    });
  }

  function handleApprove() {
    setStartError(null);
    approve.mutate(
      { pluginId: plugin.plugin_id, capabilities: Array.from(selected) },
      {
        onSuccess: () => {
          if (!start) {
            onClose();
            return;
          }
          enable.mutate(plugin.plugin_id, {
            onSuccess: onClose,
            onError: (err) =>
              setStartError(
                `The permissions are saved, but the plugin did not start: ${err.message}. Turn it on in Settings → Plugins.`,
              ),
          });
        },
      },
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
            <p className="text-xs text-rim-text-muted">
              v{plugin.version}
              {plugin.author ? ` by ${plugin.author}` : ""}
            </p>
          </div>
        </div>

        {/* The plugin's own account of what it does, e.g. where its data goes. It is
            the author's claim, so it is labelled and set apart from the app's words. */}
        {plugin.description && (
          <figure className="space-y-1">
            <figcaption className="text-[11px] text-rim-text-faint">
              From the plugin author:
            </figcaption>
            <blockquote className="whitespace-pre-line border-l-2 border-rim-line pl-3 text-xs text-rim-text-muted">
              {clipDescription(plugin.description)}
            </blockquote>
          </figure>
        )}

        <p className="rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text">
          {KIND_CONSENT_TEXT[runtimeKind(plugin)]}
        </p>

        <p className="text-xs text-rim-text-muted">
          {parsedCapabilities.length > 0
            ? "This plugin requests the following permissions. Uncheck any you want to deny."
            : "This plugin asks for no permissions."}
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
              {isChatCapability(cap) ? (
                <ChatConsentLine text={CHAT_CONSENT_TEXT[cap]} />
              ) : cap === "network.fetch" ? (
                <p className="text-sm text-rim-text">
                  <span className="font-medium">{capabilityLabels[cap]}:</span>{" "}
                  <span className="text-rim-text-muted">
                    {networkFetchText(plugin.network_origins ?? [])}
                  </span>
                </p>
              ) : (
                <div>
                  <p className="text-sm text-rim-text">{capabilityLabels[cap] ?? cap}</p>
                  <p className="text-xs text-rim-text-muted">{capabilityDescriptions[cap] ?? ""}</p>
                </div>
              )}
            </label>
          ))}
        </div>

        {start && (
          <p className="text-xs text-rim-text-muted">
            The plugin starts once you approve. Cancel leaves it installed and turned off.
          </p>
        )}
        {startError && (
          <p className="text-xs text-rim-danger" role="alert">
            {startError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {startError ? "Close" : "Cancel"}
          </Button>
          {!startError && (
            <Button
              size="sm"
              isLoading={approve.isPending || enable.isPending}
              onClick={handleApprove}
            >
              {start ? "Approve and turn on" : "Approve"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** A chat capability's line: the words before the colon name it, the rest says what it allows. */
function ChatConsentLine({ text }: { text: string }) {
  const colon = text.indexOf(":");
  return (
    <p className="text-sm text-rim-text">
      <span className="font-medium">{text.slice(0, colon + 1)}</span>
      <span className="text-rim-text-muted">{text.slice(colon + 1)}</span>
    </p>
  );
}
