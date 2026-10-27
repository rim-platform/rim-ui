import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Terminal, Plug, User, Zap } from "lucide-react";
import { Highlight } from "@nozbe/microfuzz/react";
import { Z } from "../../../shared/ui/zIndex";
import { useCommandStore } from "../state/useCommandStore";
import { useCommands, useExecuteCommandMutation } from "../api/useCommands";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { isRegistryPaletteItem, useRegistryPaletteItems } from "../../plugins/registry/palette";
import { useRegistryStore } from "../../plugins/registry/state";
import { useRunnableHere } from "../../plugins/runtime/pluginContext";
import {
  isCancelledResult,
  toastPluginCommandResult,
} from "../../plugins/runtime/pluginCommandInfo";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  argumentPromptName,
  commandResultOf,
  dispatchCommand,
  hasLocalHandler,
} from "../runtime/commandDispatcher";
import {
  serverRunsWithContext,
  unfilledRequiredArguments,
  type ArgumentContext,
} from "../runtime/commandArguments";
import { commandSuccessText } from "../runtime/commandResultText";
import { currentCommandContext } from "../runtime/commandContext";
import { runWithHumanConfirmation } from "../runtime/humanConfirmation";
import {
  appOnlyStageError,
  pipeConfirmationSubject,
  readablePipeError,
} from "../runtime/pipeStages";
import { useEffectiveKeybinds } from "../runtime/effectiveKeybinds";
import { LOCAL_COMMANDS, withClientLabel } from "../runtime/localCommands";
import { createPaletteSearch } from "../runtime/paletteSearch";
import { cn } from "../../../shared/ui/cn";
import { PipelineResultView } from "./PipelineResultView";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { commandOfferedHere } from "../../agent/agentAvailability";
import type { CommandDefinition, CommandSourceKind, CommandResult } from "../types";

function sourceIcon(source: CommandSourceKind) {
  switch (source) {
    case "BUILT_IN":
      return <Terminal className="h-3.5 w-3.5 text-rim-text-muted" />;
    case "PLUGIN":
      return <Plug className="h-3.5 w-3.5 text-rim-accent" />;
    case "USER":
      return <User className="h-3.5 w-3.5 text-rim-text-muted" />;
    case "INTEGRATION":
      return <Zap className="h-3.5 w-3.5 text-rim-text-muted" />;
  }
}

/**
 * Whether the palette can run `command` as picked, with no arguments typed: this app runs it
 * itself, or every argument it requires comes from the context or from the surface that asks
 * for it.
 */
function runsFromPalette(command: CommandDefinition, context: ArgumentContext): boolean {
  if (hasLocalHandler(command.id)) return true;
  const prompted = argumentPromptName(command.id);
  return unfilledRequiredArguments(command, context).every(
    (argument) => argument.name === prompted,
  );
}

export function CommandPalette() {
  const isOpen = useCommandStore((s) => s.isCommandPaletteOpen);
  const searchQuery = useCommandStore((s) => s.searchQuery);
  const setSearchQuery = useCommandStore((s) => s.setSearchQuery);
  const closeCommandPalette = useCommandStore((s) => s.closeCommandPalette);
  const setFocusedSurface = useShellStore((s) => s.setFocusedSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const selectedConversationId = useShellStore((s) => s.selectedConversationId) ?? undefined;
  const argumentContext = useMemo<ArgumentContext>(
    () => ({ workspaceId, conversationId: workspaceId ? selectedConversationId : undefined }),
    [workspaceId, selectedConversationId],
  );

  const { data: commands, isLoading: isLoadingCommands } = useCommands("PALETTE");
  const pluginCommands = usePluginCommands();
  const runnableHere = useRunnableHere();
  const registryItems = useRegistryPaletteItems();
  const keybinds = useEffectiveKeybinds();
  const executeCommandMutation = useExecuteCommandMutation();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Pipe chain state: segments locked in before the current search query
  const [pipeSegments, setPipeSegments] = useState<string[]>([]);
  // Pipeline result state for post-execution display
  const [pipelineResult, setPipelineResult] = useState<CommandResult | null>(null);
  const [pipeExecuting, setPipeExecuting] = useState(false);

  // Pre-filter to palette-visible commands, merge with plugin commands
  const visibleCommands = useMemo(() => {
    const base =
      commands
        ?.filter((cmd) => cmd.visibleInPalette && runsFromPalette(cmd, argumentContext))
        .filter((cmd) => commandOfferedHere(cmd.id))
        .map(withClientLabel) ?? [];
    const serverIds = new Set(base.map((cmd) => cmd.id));
    const local = LOCAL_COMMANDS.filter((cmd) => !serverIds.has(cmd.id));
    return [
      ...base,
      ...local,
      // A plugin command whose context is missing (no conversation open) is left out.
      ...pluginCommands.filter((cmd) => cmd.visibleInPalette && runnableHere(cmd.requiredContext)),
      ...registryItems,
    ];
  }, [commands, pluginCommands, registryItems, runnableHere, argumentContext]);

  // Every command the palette knows, to name pipe stages in messages.
  const knownCommands = useMemo(
    () => [...(commands ?? []), ...LOCAL_COMMANDS, ...pluginCommands],
    [commands, pluginCommands],
  );

  // After `|`, only the server's commands that it runs with this context can be the next stage.
  const pipeCommands = useMemo(
    () =>
      (commands ?? [])
        .filter((cmd) => cmd.visibleInPalette && serverRunsWithContext(cmd, argumentContext))
        .map(withClientLabel),
    [commands, argumentContext],
  );

  // When pipe segments exist, searchQuery already contains only the active segment
  // (text after the last `|`) because handleSearchChange resets it on pipe.
  const listed = pipeSegments.length > 0 ? pipeCommands : visibleCommands;
  const search = useMemo(() => createPaletteSearch(listed), [listed]);
  const sortedResults = useMemo(() => search(searchQuery), [search, searchQuery]);

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
    for (const kb of keybinds) {
      if (kb.isEnabled && !map.has(kb.commandId)) {
        map.set(kb.commandId, kb.keystroke);
      }
    }
    return map;
  }, [keybinds]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Focus input when palette opens; reset pipe chain on close
  useEffect(() => {
    if (isOpen) {
      setFocusedSurface("commandPalette");
      setPipeSegments([]);
      setPipelineResult(null);
      setPipeExecuting(false);
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

  // Handle typing `|` to lock in a pipe segment
  const handleSearchChange = useCallback(
    (value: string) => {
      if (value.endsWith("|")) {
        const segment = value.slice(0, -1).trim();
        if (segment) {
          setPipeSegments((prev) => [...prev, segment]);
          setSearchQuery("");
          return;
        }
      }
      setSearchQuery(value);
    },
    [setSearchQuery],
  );

  // Execute a pipe chain as a single command string
  const executePipeChain = useCallback(
    async (segments: string[], finalSegment?: string) => {
      const allSegments = finalSegment ? [...segments, finalSegment] : segments;
      if (allSegments.length === 0) return;
      const pipeExpression = allSegments.join(" | ");
      const refusal = appOnlyStageError(allSegments, knownCommands);
      if (refusal) {
        toast.error(refusal);
        return;
      }
      setPipeSegments([]);
      setPipeExecuting(true);
      const stageCount = allSegments.length;
      const toastId = toast.info(`Executing pipe: stage 1/${stageCount}...`, {
        id: "pipe-progress",
        persistent: true,
      });
      try {
        const outcome = await runWithHumanConfirmation(
          async (confirmation) => {
            const res = await executeCommandMutation.mutateAsync({
              commandId: pipeExpression,
              commandContext: currentCommandContext(),
              isPipe: true,
              confirmation,
            });
            return res.executeCommand;
          },
          pipeConfirmationSubject(allSegments, commands),
        );
        const result = commandResultOf(outcome);
        toast.dismiss(toastId);
        if (isCancelledResult(result)) {
          closeCommandPalette();
        } else if (result.pipelineStages && result.pipelineStages.length > 0) {
          setPipelineResult(result);
          if (result.status === "ERROR") {
            const failedStage = result.pipelineStages.find((s) => s.status === "ERROR");
            toast.error(
              `Pipe failed at stage ${(failedStage?.stageIndex ?? 0) + 1}: ${failedStage?.message ?? result.message}`,
            );
          } else {
            toast.success("Pipe executed successfully");
          }
        } else {
          closeCommandPalette();
          if (result.status === "ERROR") {
            toast.error(result.message);
          } else {
            toast.success(result.message || "Command executed");
          }
        }
      } catch (err) {
        toast.dismiss(toastId);
        toast.error(
          readablePipeError(graphqlErrorMessage(err, "Pipe execution failed"), knownCommands),
        );
        closeCommandPalette();
      } finally {
        setPipeExecuting(false);
      }
    },
    [closeCommandPalette, executeCommandMutation, commands, knownCommands],
  );

  const executeSelected = useCallback(
    async (command: CommandDefinition) => {
      // A registry entry opens its install dialog; one that cannot be installed here stays put.
      if (isRegistryPaletteItem(command)) {
        if (command.registry.refusal !== null) return;
        closeCommandPalette();
        useRegistryStore
          .getState()
          .openInstall(command.registry.serverId, command.registry.pluginId);
        return;
      }
      // With pipe segments, add this command to the chain and execute the whole pipe
      if (pipeSegments.length > 0) {
        await executePipeChain(pipeSegments, command.id);
        return;
      }
      // Close immediately so the palette dismisses before the async result arrives —
      // the toast will appear on top without requiring the palette to stay open.
      closeCommandPalette();
      try {
        const result = await dispatchCommand(
          command,
          (input) => executeCommandMutation.mutateAsync(input),
          { commandContext: currentCommandContext() },
        );
        if (command.sourceKind === "PLUGIN") {
          // A plugin answers in words (its payload is for scripts and the agent).
          toastPluginCommandResult(command.title, result);
        } else if (isCancelledResult(result)) {
          // The user declined the confirmation, or was told it expired.
        } else if (result === null || result.status === "ERROR") {
          toast.error(`${command.title}: ${result?.message ?? "Command failed"}`);
        } else {
          toast.success(commandSuccessText(command.title, result));
        }
      } catch (err) {
        // Show the server's own message (e.g. FORBIDDEN, RATE_LIMITED)
        // rather than graphql-request's serialized response dump.
        toast.error(`${command.title}: ${graphqlErrorMessage(err, "Command failed")}`);
      }
    },
    [closeCommandPalette, executeCommandMutation, pipeSegments, executePipeChain],
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
          if (pipeSegments.length > 0 && !searchQuery.trim()) {
            // An empty search in a pipe runs the chain built so far.
            void executePipeChain(pipeSegments);
          } else if (sortedResults[selectedIndex]) {
            void executeSelected(sortedResults[selectedIndex].item);
          }
          break;
        case "Tab":
          // In a pipe, Tab adds the highlighted command as the last stage and runs the chain.
          if (pipeSegments.length > 0 && sortedResults[selectedIndex]) {
            event.preventDefault();
            void executeSelected(sortedResults[selectedIndex].item);
          }
          break;
        case "Backspace":
          // Remove last pipe segment when search input is empty
          if (searchQuery === "" && pipeSegments.length > 0) {
            event.preventDefault();
            setPipeSegments((prev) => {
              const restored = prev[prev.length - 1];
              setSearchQuery(restored);
              return prev.slice(0, -1);
            });
          }
          break;
        case "Escape":
          event.preventDefault();
          if (pipeSegments.length > 0) {
            // First Escape clears the pipe chain
            setPipeSegments([]);
            setSearchQuery("");
          } else {
            closeCommandPalette();
          }
          break;
      }
    },
    [
      sortedResults,
      selectedIndex,
      executeSelected,
      closeCommandPalette,
      pipeSegments,
      searchQuery,
      setSearchQuery,
      executePipeChain,
    ],
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
        {/* Pipe chain display */}
        {pipeSegments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-rim-line px-4 py-2">
            {pipeSegments.map((segment, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="bg-rim-accent/10 text-rim-accent text-xs rounded px-2 py-0.5 font-mono">
                  {segment}
                </span>
                <span className="text-rim-text-faint text-xs" aria-hidden="true">
                  {"\u2192"}
                </span>
              </span>
            ))}
            <span className="text-rim-text-muted text-xs">...</span>
          </div>
        )}

        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
          <Search className="h-4 w-4 text-rim-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              pipeSegments.length > 0
                ? "Next command, or Enter to run the pipe..."
                : "Type a command..."
            }
            className="flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
          />
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {isLoadingCommands ? (
            <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
              <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-rim-text-muted border-t-transparent mr-2 align-middle" />
              Loading commands...
            </div>
          ) : sortedResults.length === 0 ? (
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
                      isRegistryPaletteItem(cmd) && cmd.registry.refusal !== null && "opacity-60",
                    )}
                    aria-disabled={
                      isRegistryPaletteItem(cmd) && cmd.registry.refusal !== null ? true : undefined
                    }
                    onClick={() => executeSelected(cmd)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {sourceIcon(cmd.sourceKind)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          <Highlight text={cmd.title} ranges={result.titleRanges} />
                        </span>
                        {cmd.dangerous && (
                          <span className="rounded bg-rim-danger/20 px-1.5 py-0.5 text-[10px] font-medium text-rim-danger">
                            dangerous
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-rim-text-muted truncate">
                        <Highlight text={cmd.description} ranges={result.descriptionRanges} />
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

        {/* Pipeline result display */}
        {pipelineResult?.pipelineStages && pipelineResult.pipelineStages.length > 0 && (
          <div className="border-t border-rim-line px-3 py-2 max-h-60 overflow-y-auto">
            <PipelineResultView stages={pipelineResult.pipelineStages} />
          </div>
        )}

        {/* Pipe execution progress */}
        {pipeExecuting && (
          <div className="border-t border-rim-line px-4 py-2 flex items-center gap-2 text-xs text-rim-text-muted">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rim-accent border-t-transparent" />
            Executing pipe...
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-rim-line px-4 py-2 flex items-center gap-4 text-[11px] text-rim-text-muted">
          <span>
            <kbd className="font-mono">&#8593;&#8595;</kbd> navigate
          </span>
          {pipeSegments.length > 0 ? (
            <>
              <span>
                <kbd className="font-mono">Tab</kbd> add and run
              </span>
              <span>
                <kbd className="font-mono">Enter</kbd> run pipe
              </span>
              <span>
                <kbd className="font-mono">Esc</kbd> clear pipe
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd className="font-mono">Enter</kbd> execute
              </span>
              <span>
                <kbd className="font-mono">|</kbd> pipe
              </span>
              <span>
                <kbd className="font-mono">Esc</kbd> close
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
