import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Terminal, Plug, User, Zap } from "lucide-react";
import { useFuzzySearchList, Highlight } from "@nozbe/microfuzz/react";
import { Z } from "../../../shared/ui/zIndex";
import { useCommandStore } from "../state/useCommandStore";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import { useResolvedKeybinds } from "../api/useKeybinds";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { dispatchCommand } from "../runtime/commandDispatcher";
import { cn } from "../../../shared/ui/cn";
import type { CommandDefinition, CommandSourceKind } from "../types";

function sourceIcon(source: CommandSourceKind) {
  switch (source) {
    case "BuiltIn":
      return <Terminal className="h-3.5 w-3.5 text-rim-text-muted" />;
    case "Plugin":
      return <Plug className="h-3.5 w-3.5 text-rim-accent" />;
    case "User":
      return <User className="h-3.5 w-3.5 text-rim-text-muted" />;
    case "Integration":
      return <Zap className="h-3.5 w-3.5 text-rim-text-muted" />;
  }
}

export function CommandPalette() {
  const isOpen = useCommandStore((s) => s.isCommandPaletteOpen);
  const searchQuery = useCommandStore((s) => s.searchQuery);
  const setSearchQuery = useCommandStore((s) => s.setSearchQuery);
  const closeCommandPalette = useCommandStore((s) => s.closeCommandPalette);
  const setFocusedSurface = useShellStore((s) => s.setFocusedSurface);

  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: commands } = useCommands("Palette");
  const pluginCommands = usePluginCommands();
  const { data: keybinds } = useResolvedKeybinds(workspaceId ?? undefined);
  const executeCommandMutation = useExecuteCommandMutation();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Pre-filter to palette-visible commands, merge with plugin commands
  const visibleCommands = useMemo(() => {
    const base = commands?.filter((cmd) => cmd.visibleInPalette) ?? [];
    return [...base, ...pluginCommands.filter((cmd) => cmd.visibleInPalette)];
  }, [commands, pluginCommands]);

  const getCommandText = useCallback(
    (cmd: CommandDefinition) => [cmd.title, cmd.description, cmd.category],
    [],
  );

  const mapCommandResult = useCallback(
    (result: { item: CommandDefinition; score: number; matches: Array<Array<[number, number]> | null> }) => result,
    [],
  );

  // Fuzzy-filter commands by search query via microfuzz
  const fuzzyResults = useFuzzySearchList({
    list: visibleCommands,
    queryText: searchQuery,
    getText: getCommandText,
    mapResultItem: mapCommandResult,
  });

  // Sort filtered commands by category and compute category groups
  const sortedResults = useMemo(() => {
    return [...fuzzyResults].sort((a, b) => a.item.category.localeCompare(b.item.category));
  }, [fuzzyResults]);

  // Compute category header positions
  const categoryHeaders = useMemo(() => {
    const headers = new Map<number, string>();
    let lastCategory = "";
    for (let i = 0; i < sortedResults.length; i++) {
      if (sortedResults[i].item.category !== lastCategory) {
        lastCategory = sortedResults[i].item.category;
        headers.set(i, lastCategory);
      }
    }
    return headers;
  }, [sortedResults]);

  // Build keybind lookup
  const keybindMap = useMemo(() => {
    const map = new Map<string, string>();
    if (keybinds) {
      for (const kb of keybinds) {
        if (kb.isEnabled && !map.has(kb.commandId)) {
          map.set(kb.commandId, kb.keystroke);
        }
      }
    }
    return map;
  }, [keybinds]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Focus input when palette opens
  useEffect(() => {
    if (isOpen) {
      setFocusedSurface("commandPalette");
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setFocusedSurface(null);
    }
  }, [isOpen, setFocusedSurface]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-command-item]");
    if (items[selectedIndex]) {
      (items[selectedIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const executeSelected = useCallback(
    async (command: CommandDefinition) => {
      closeCommandPalette();
      await dispatchCommand(
        command,
        (input) => executeCommandMutation.mutateAsync(input),
        {
          commandContext: {
            workspaceId: workspaceId ?? undefined,
          },
        }
      );
    },
    [closeCommandPalette, executeCommandMutation, workspaceId]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, sortedResults.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (sortedResults[selectedIndex]) {
            executeSelected(sortedResults[selectedIndex].item);
          }
          break;
        case "Escape":
          event.preventDefault();
          closeCommandPalette();
          break;
      }
    },
    [sortedResults, selectedIndex, executeSelected, closeCommandPalette]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[12vh]"
      style={{ zIndex: Z.OVERLAY_CONTENT }}
      onClick={closeCommandPalette}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg rounded-xl border border-rim-line bg-rim-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
          <Search className="h-4 w-4 text-rim-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
          />
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {sortedResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
              No commands found.
            </div>
          ) : (
            sortedResults.map((result, index) => {
              const cmd = result.item;
              return (
                <div key={cmd.id}>
                  {categoryHeaders.has(index) && (
                    <div className="text-[10px] uppercase tracking-wider text-rim-text-faint px-3 pt-2 pb-1">
                      {categoryHeaders.get(index)}
                    </div>
                  )}
                  <button
                    data-command-item
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      index === selectedIndex
                        ? "bg-rim-accent/10 text-rim-text"
                        : "text-rim-text-muted hover:bg-rim-void/50",
                    )}
                    onClick={() => executeSelected(cmd)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {sourceIcon(cmd.sourceKind)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          <Highlight text={cmd.title} ranges={result.matches?.[0] ?? null} />
                        </span>
                        {cmd.dangerous && (
                          <span className="rounded bg-rim-danger/20 px-1.5 py-0.5 text-[10px] font-medium text-rim-danger">
                            dangerous
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-rim-text-muted truncate">
                        <Highlight text={cmd.description} ranges={result.matches?.[1] ?? null} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-rim-text-muted uppercase">
                        {cmd.category}
                      </span>
                      {keybindMap.has(cmd.id) && (
                        <kbd className="rounded border border-rim-line bg-rim-void px-1.5 py-0.5 text-[11px] font-mono text-rim-text-muted">
                          {keybindMap.get(cmd.id)}
                        </kbd>
                      )}
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-rim-line px-4 py-2 flex items-center gap-4 text-[11px] text-rim-text-muted">
          <span><kbd className="font-mono">&#8593;&#8595;</kbd> navigate</span>
          <span><kbd className="font-mono">Enter</kbd> execute</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
