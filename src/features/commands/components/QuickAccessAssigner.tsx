import { useEffect, useState, useCallback } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { toast } from "../../../shared/toast";
import { useCreateKeybindMutation } from "../api/useKeybindSettings";
import { useHoverContextStore } from "../../../shell/state/useHoverContextStore";
import { useQuickAccessStore } from "../state/useQuickAccessStore";

export { useQuickAccessStore };

export function QuickAccessAssigner() {
  const isOpen = useQuickAccessStore((s) => s.isOpen);
  const target = useQuickAccessStore((s) => s.target);
  const close = useQuickAccessStore((s) => s.close);
  const [captured, setCaptured] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createKeybind = useCreateKeybindMutation();

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setCaptured(null);
      setSaving(false);
    }
  }, [isOpen]);

  // Listen for Ctrl+Shift+B globally to trigger
  useEffect(() => {
    function handleTrigger(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "b" || e.key === "B")) {
        const hoverTarget = useHoverContextStore.getState().target;
        if (hoverTarget) {
          e.preventDefault();
          e.stopPropagation();
          useQuickAccessStore.getState().open(hoverTarget);
        }
      }
    }

    window.addEventListener("keydown", handleTrigger, true);
    return () => window.removeEventListener("keydown", handleTrigger, true);
  }, []);

  const handleKeystrokeCapture = useCallback(
    async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        close();
        return;
      }

      // Skip if only a modifier key
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
      const keystroke = parts.join("+");

      if (!target) return;

      setCaptured(keystroke);
      setSaving(true);

      const commandId =
        target.kind === "channel"
          ? "workspace.navigate_to_channel"
          : target.kind === "dm"
            ? "workspace.navigate_to_dm"
            : "workspace.switch_workspace";

      const presetArgs =
        target.kind === "workspace"
          ? { workspaceId: target.workspaceId }
          : { conversationId: target.conversationId, serverId: target.serverId };

      try {
        await createKeybind.mutateAsync({
          scope: "USER",
          keystroke,
          commandId,
          context: "GLOBAL",
          presetArgs,
        });
        toast.success(`Shortcut ${keystroke} assigned to ${target.label}`);
        close();
      } catch {
        toast.error(`Failed to assign shortcut ${keystroke}`);
        setSaving(false);
        setCaptured(null);
      }
    },
    [target, close, createKeybind],
  );

  // Capture keystrokes when dialog is open
  useEffect(() => {
    if (!isOpen || saving) return;

    window.addEventListener("keydown", handleKeystrokeCapture, true);
    return () => window.removeEventListener("keydown", handleKeystrokeCapture, true);
  }, [isOpen, saving, handleKeystrokeCapture]);

  return (
    <Dialog open={isOpen} onClose={close} title={`Assign shortcut for ${target?.label ?? "..."}`}>
      <div className="flex flex-col items-center gap-4 py-4">
        {saving && captured ? (
          <p className="text-sm text-rim-text-muted">
            Assigning <span className="font-mono text-rim-accent">{captured}</span>...
          </p>
        ) : captured ? (
          <p className="text-sm font-mono text-rim-accent">{captured}</p>
        ) : (
          <p className="text-sm text-rim-text-muted">Press a key combination...</p>
        )}
        <p className="text-xs text-rim-text-faint">Escape to cancel</p>
      </div>
    </Dialog>
  );
}
