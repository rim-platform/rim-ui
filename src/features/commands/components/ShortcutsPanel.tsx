import { useMemo, useState } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { useCommands } from "../api/useCommands";
import { KEYBIND_CONTEXTS } from "../profiles/keybindProfile";
import { useEffectiveKeybinds } from "../runtime/effectiveKeybinds";
import { BUILT_IN_COMMAND_TITLES } from "../runtime/localCommands";
import { VIM_KEYS } from "../runtime/vimLayer";
import { useCommandStore } from "../state/useCommandStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import type { KeybindContext } from "../types";

const CONTEXT_LABELS: Readonly<Record<KeybindContext, string>> = {
  GLOBAL: "Everywhere",
  COMPOSER: "Composer",
  MESSAGE_LIST: "Message list",
  THREAD_VIEW: "Thread",
  CONVERSATION_VIEW: "Conversation",
  PANEL: "Panels",
  COMMAND_PALETTE: "Command palette",
};

interface ShortcutRow {
  keys: string;
  title: string;
}

interface ShortcutGroup {
  label: string;
  rows: ShortcutRow[];
}

function matches(row: ShortcutRow, query: string): boolean {
  return row.title.toLowerCase().includes(query) || row.keys.toLowerCase().includes(query);
}

/**
 * The keyboard shortcuts panel: every keybind in force on this device, generated from the same
 * bindings the keybind runtime matches, plus the Vim layer's keys while it is on.
 */
export function ShortcutsPanel() {
  const open = useCommandStore((s) => s.isShortcutsPanelOpen);
  const setOpen = useCommandStore((s) => s.setShortcutsPanelOpen);
  if (!open) return null;
  return <ShortcutsDialog onClose={() => setOpen(false)} />;
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const keybinds = useEffectiveKeybinds();
  const vimMode = useKeybindProfileStore((s) => s.profile.vimMode);
  const profileName = useKeybindProfileStore((s) => s.profile.name);
  const { data: commands } = useCommands("KEYBIND_PICKER");
  const pluginCommands = usePluginCommands();
  const [query, setQuery] = useState("");

  const groups = useMemo<ShortcutGroup[]>(() => {
    const titles = new Map<string, string>(Object.entries(BUILT_IN_COMMAND_TITLES));
    for (const command of commands ?? []) titles.set(command.id, command.title);
    for (const command of pluginCommands) titles.set(command.id, command.title);

    const needle = query.trim().toLowerCase();
    const result: ShortcutGroup[] = KEYBIND_CONTEXTS.map((context) => ({
      label: CONTEXT_LABELS[context],
      rows: keybinds
        .filter((kb) => kb.context === context && kb.isEnabled)
        .map((kb) => ({ keys: kb.keystroke, title: titles.get(kb.commandId) ?? kb.commandId }))
        .filter((row) => !needle || matches(row, needle)),
    }));
    if (vimMode) {
      result.push({
        label: "Vim normal mode",
        rows: VIM_KEYS.map(({ keys, description }) => ({ keys, title: description })).filter(
          (row) => !needle || matches(row, needle),
        ),
      });
    }
    return result.filter((group) => group.rows.length > 0);
  }, [keybinds, commands, pluginCommands, vimMode, query]);

  return (
    <Dialog open onClose={onClose} title="Keyboard shortcuts" maxWidth="max-w-xl">
      <p className="mb-3 text-xs text-rim-text-muted">
        Profile: <span className="text-rim-text">{profileName}</span>
        {vimMode ? " with Vim mode" : ""}. Change it in Settings, Keyboard.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter shortcuts..."
        aria-label="Filter shortcuts"
        className="mb-3 w-full rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text outline-none placeholder:text-rim-text-muted focus:border-rim-accent/40"
      />
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="py-4 text-center text-xs text-rim-text-muted">No shortcut matches.</p>
        )}
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
              {group.label}
            </h4>
            <dl className="space-y-1">
              {group.rows.map((row) => (
                <div
                  key={`${row.keys} ${row.title}`}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <dt className="truncate text-rim-text">{row.title}</dt>
                  <dd className="shrink-0">
                    <kbd className="rounded border border-rim-line bg-rim-void px-1.5 py-0.5 font-mono text-[11px] text-rim-text-muted">
                      {row.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
