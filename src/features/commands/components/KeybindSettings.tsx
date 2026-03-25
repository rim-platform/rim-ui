import { useMemo, useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

import { useResolvedKeybinds } from "../api/useKeybinds";
import {
  useCreateKeybindMutation,
  useUpdateKeybindMutation,
  useDeleteKeybindMutation,
} from "../api/useKeybindSettings";
import { useCommands } from "../api/useCommands";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { cn } from "../../../shared/ui/cn";
import type { KeybindContext, ResolvedKeybind } from "../types";

const CONTEXTS: KeybindContext[] = [
  "Global",
  "Composer",
  "MessageList",
  "ThreadView",
  "ConversationView",
  "Panel",
  "CommandPalette",
];

export function KeybindSettings() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const { data: keybinds, isLoading } = useResolvedKeybinds(
    workspaceId ?? undefined
  );
  const { data: commands } = useCommands("Palette");
  const createMutation = useCreateKeybindMutation();
  const updateMutation = useUpdateKeybindMutation();
  const deleteMutation = useDeleteKeybindMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [newKeystroke, setNewKeystroke] = useState("");
  const [newCommandId, setNewCommandId] = useState("");
  const [newContext, setNewContext] = useState<KeybindContext>("Global");

  const keybindableCommands = commands?.filter((cmd) => cmd.keybindCapable) ?? [];

  // L4: Build a lookup from command ID to title
  const commandTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    if (commands) {
      for (const cmd of commands) {
        map.set(cmd.id, cmd.title);
      }
    }
    return map;
  }, [commands]);

  function handleCreate() {
    if (!newKeystroke || !newCommandId) return;
    createMutation.mutate(
      {
        scope: "User",
        keystroke: newKeystroke,
        commandId: newCommandId,
        context: newContext,
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewKeystroke("");
          setNewCommandId("");
          setNewContext("Global");
        },
      }
    );
  }

  function handleToggle(keybind: ResolvedKeybind) {
    updateMutation.mutate({
      keybindId: keybind.id,
      keystroke: keybind.keystroke,
      commandId: keybind.commandId,
      context: keybind.context,
      isEnabled: !keybind.isEnabled,
    });
  }

  function handleDelete(keybindId: string) {
    deleteMutation.mutate({ keybindId });
  }

  function handleKeystrokeCapture(event: React.KeyboardEvent) {
    event.preventDefault();
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
    if (event.shiftKey) parts.push("Shift");
    if (event.altKey) parts.push("Alt");
    let key = event.key;
    if (["Control", "Meta", "Shift", "Alt"].includes(key)) return;
    if (key === " ") key = "Space";
    if (key.length === 1) key = key.toUpperCase();
    parts.push(key);
    setNewKeystroke(parts.join("+"));
  }

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-rim-text-muted">Loading keybinds...</div>
    );
  }

  return (
    <div className="p-3">
      {/* Add button */}
      <button
        className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted hover:text-rim-text transition-colors"
        onClick={() => setShowCreate(!showCreate)}
        aria-label="Add keybind"
      >
        <Plus className="h-3.5 w-3.5" />
        Add keybind
      </button>

      {/* Create form */}
      {showCreate && (
        <div className="mb-3 rounded-md border border-rim-line bg-rim-void p-3 space-y-2">
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Keystroke
            </label>
            <input
              type="text"
              value={newKeystroke}
              onKeyDown={handleKeystrokeCapture}
              onChange={() => {}}
              placeholder="Press a key combination..."
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
              readOnly
            />
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Command
            </label>
            <select
              value={newCommandId}
              onChange={(e) => setNewCommandId(e.target.value)}
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
            >
              <option value="">Select command...</option>
              {keybindableCommands.map((cmd) => (
                <option key={cmd.id} value={cmd.id}>
                  {cmd.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Context
            </label>
            <select
              value={newContext}
              onChange={(e) => setNewContext(e.target.value as KeybindContext)}
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
            >
              {CONTEXTS.map((ctx) => (
                <option key={ctx} value={ctx}>
                  {ctx}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={
                !newKeystroke || !newCommandId || createMutation.isPending
              }
              className="flex-1 rounded bg-rim-accent px-2 py-1 text-xs font-medium text-rim-void hover:bg-rim-accent/90 disabled:opacity-50"
            >
              {createMutation.isPending ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded px-2 py-1 text-xs text-rim-text-muted hover:text-rim-text"
            >
              Cancel
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-[11px] text-red-400">
              {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Keybind list */}
      <div className="space-y-1">
        {(!keybinds || keybinds.length === 0) && (
          <p className="text-xs text-rim-text-muted py-4 text-center">
            No keybinds configured.
          </p>
        )}
        {keybinds?.map((kb) => (
          <div
            key={kb.id}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
              kb.isEnabled ? "text-rim-text" : "text-rim-text-muted opacity-60",
            )}
          >
            <kbd className="shrink-0 rounded border border-rim-line bg-rim-void px-1.5 py-0.5 font-mono text-[11px]">
              {kb.keystroke}
            </kbd>
            <span className="flex-1 truncate">{commandTitleMap.get(kb.commandId) ?? kb.commandId}</span>
            <span className="shrink-0 text-[10px] text-rim-text-muted uppercase">
              {kb.context}
            </span>
            <button
              onClick={() => handleToggle(kb)}
              className="shrink-0 text-rim-text-muted hover:text-rim-text"
              title={kb.isEnabled ? "Disable" : "Enable"}
              aria-label={kb.isEnabled ? "Disable keybind" : "Enable keybind"}
            >
              {kb.isEnabled ? (
                <ToggleRight className="h-4 w-4 text-rim-accent" />
              ) : (
                <ToggleLeft className="h-4 w-4" />
              )}
            </button>
            {kb.source !== "Default" && (
              <button
                onClick={() => handleDelete(kb.id)}
                className="shrink-0 text-rim-text-muted hover:text-red-400"
                title="Delete"
                aria-label="Delete keybind"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
