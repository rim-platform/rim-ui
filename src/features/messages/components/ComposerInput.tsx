import { useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Send, SmilePlus, Paperclip, Loader2 } from "lucide-react";

import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { Z } from "../../../shared/ui/zIndex";
import { getShortcodeSuggestions } from "../utils/emojiShortcodes";
import { getSlashCommandSuggestions } from "../utils/slashCommands";
import type { SlashCommand } from "../utils/slashCommands";
import { cn } from "../../../shared/ui/cn";
import { Avatar } from "../../../shared/ui/Avatar";
import { useCommands, useExecuteCommandMutation } from "../../commands/api/useCommands";
import { useResolvedKeybinds } from "../../commands/api/useKeybinds";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useCustomEmojis } from "../../emoji/api/useCustomEmojis";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { toast } from "../../../shared/toast";
import type { CommandDefinition } from "../../commands/types";

interface MentionSuggestion {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface CommandSuggestion {
  id: string;
  title: string;
  description: string;
  category: string;
  keybind: string | null;
  /** Original command definition for execution */
  command: CommandDefinition;
}

const MAX_COMMAND_SUGGESTIONS = 8;

/** Discriminated union for the unified slash/command suggestion list */
type SlashItem =
  | { kind: "builtin"; value: SlashCommand }
  | { kind: "command"; value: CommandSuggestion };

interface ComposerInputProps {
  text: string;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
  onKeystroke: () => void;
  saveDraftDebounced: (text: string) => void;
  isSubmitting: boolean;
  isUploading: boolean;
  canSubmit: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionMapRef: React.RefObject<Map<string, string>>;
  serverMembers: Array<{ userId: string; username: string; displayName: string | null; avatarUrl: string | null }> | undefined;
  onFilePickerOpen: () => void;
}

export function ComposerInput({
  text,
  onTextChange,
  onSubmit,
  onKeystroke,
  saveDraftDebounced,
  isSubmitting,
  isUploading,
  canSubmit,
  textareaRef,
  mentionMapRef,
  serverMembers,
  onFilePickerOpen,
}: ComposerInputProps) {
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Fetch all commands and keybinds for inline command preview
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { emojis: customEmojis } = useCustomEmojis(workspaceId);
  const { data: allCommands } = useCommands("PALETTE");
  const { data: keybinds } = useResolvedKeybinds(workspaceId ?? undefined);
  const executeCommandMutation = useExecuteCommandMutation();
  const executeMutationRef = useRef(executeCommandMutation);
  executeMutationRef.current = executeCommandMutation;

  // Build command-id -> keystroke lookup
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

  // Autocomplete state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ code: string; emoji: string }>>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [slashItems, setSlashItems] = useState<SlashItem[]>([]);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [selectedMention, setSelectedMention] = useState(0);

  // Extract the current partial shortcode being typed (word touching cursor)
  const getPartialShortcode = useCallback((value: string, cursorPos: number): string | null => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/:([a-zA-Z0-9_]*)$/);
    if (match) return match[0];
    return null;
  }, []);

  // Extract partial @mention query from cursor position
  const getPartialMention = useCallback((value: string, cursorPos: number): string | null => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    if (match) return match[1];
    return null;
  }, []);

  // Filter members based on mention query
  const updateMentionSuggestions = useCallback((query: string) => {
    if (!serverMembers) {
      setMentionSuggestions([]);
      return;
    }
    const lower = query.toLowerCase();
    const filtered = serverMembers
      .filter((m) => {
        const name = (m.displayName ?? m.username ?? "").toLowerCase();
        const uname = (m.username ?? "").toLowerCase();
        return name.includes(lower) || uname.includes(lower);
      })
      .slice(0, 8)
      .map((m) => ({
        userId: m.userId,
        username: m.username,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      }));
    setMentionSuggestions(filtered);
    setSelectedMention(0);
  }, [serverMembers]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.currentTarget.value;
    const cursorPos = e.currentTarget.selectionStart ?? value.length;
    onTextChange(value);
    saveDraftDebounced(value);
    onKeystroke();

    // Auto-resize
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;

    // Slash command detection (takes priority over emoji)
    if (value.startsWith("/")) {
      const slashPartial = value.split(" ")[0];
      if (!value.includes(" ")) {
        // Build unified list: built-in slash commands first, then registry commands
        const items: SlashItem[] = [];

        // Built-in slash commands (/agent, /macro)
        for (const cmd of getSlashCommandSuggestions(slashPartial)) {
          items.push({ kind: "builtin", value: cmd });
        }

        // All registered commands from the command registry
        const query = slashPartial.slice(1).toLowerCase(); // strip leading /
        if (allCommands) {
          const filtered = allCommands
            .filter((cmd) => {
              const titleMatch = cmd.title.toLowerCase().includes(query);
              const idMatch = cmd.id.toLowerCase().includes(query);
              const categoryMatch = cmd.category.toLowerCase().includes(query);
              return titleMatch || idMatch || categoryMatch;
            })
            .slice(0, MAX_COMMAND_SUGGESTIONS);
          for (const cmd of filtered) {
            items.push({
              kind: "command",
              value: {
                id: cmd.id,
                title: cmd.title,
                description: cmd.description,
                category: cmd.category,
                keybind: keybindMap.get(cmd.id) ?? null,
                command: cmd,
              },
            });
          }
        }

        setSlashItems(items);
        setSelectedSlashIndex(0);
      } else {
        setSlashItems([]);
      }
      setSuggestions([]);
    } else {
      setSlashItems([]);

      // @mention detection (takes priority over emoji)
      const mentionPartial = getPartialMention(value, cursorPos);
      if (mentionPartial !== null) {
        updateMentionSuggestions(mentionPartial);
        setSuggestions([]);
      } else {
        setMentionSuggestions([]);

        // Emoji shortcode detection
        const partial = getPartialShortcode(value, cursorPos);
        if (partial && partial.length >= 2) {
          const results = getShortcodeSuggestions(partial);
          setSuggestions(results);
          setSelectedSuggestion(0);
        } else {
          setSuggestions([]);
        }
      }
    }
  }

  function applySuggestion(suggestion: { code: string; emoji: string }) {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const match = before.match(/:([a-zA-Z0-9_]*)$/);
    if (match) {
      const newBefore = before.slice(0, before.length - match[0].length) + suggestion.emoji;
      onTextChange(newBefore + after);
    }
    setSuggestions([]);
    textareaRef.current?.focus();
  }

  function applySlashSuggestion(command: SlashCommand) {
    onTextChange(command.command + " ");
    setSlashItems([]);
    textareaRef.current?.focus();
  }

  function applySlashItem(item: SlashItem) {
    if (item.kind === "builtin") {
      applySlashSuggestion(item.value);
    } else {
      applyCommandSuggestion(item.value);
    }
  }

  function applyCommandSuggestion(suggestion: CommandSuggestion) {
    const needsArgs = suggestion.command.requiredContext.length > 0;
    if (needsArgs) {
      // Insert as slash text so user can type arguments
      onTextChange("/" + suggestion.id + " ");
    } else {
      // Execute the command immediately
      onTextChange("");
      void (async () => {
        try {
          const result = await dispatchCommand(
            suggestion.command,
            (input) => executeMutationRef.current.mutateAsync(input),
            { commandContext: workspaceId ? { workspaceId } : undefined },
          );
          if (result && result.status === "ERROR") {
            toast.error(result.message || "Command failed");
          }
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Command execution failed");
        }
      })();
    }
    setSlashItems([]);
    textareaRef.current?.focus();
  }

  function applyMention(member: { userId: string; username: string; displayName: string | null }) {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const match = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    if (match) {
      const atStart = before.length - match[0].length + (match[0].startsWith(" ") || match[0].startsWith("\n") ? 1 : 0);
      const newBefore = before.slice(0, atStart) + `@${member.username} `;
      const newText = newBefore + after;
      onTextChange(newText);
      // Store username -> userId mapping for submit-time replacement
      mentionMapRef.current.set(member.username, member.userId);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newBefore.length;
          textareaRef.current.selectionEnd = newBefore.length;
        }
      });
    }
    setMentionSuggestions([]);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedMention((prev) => Math.min(prev + 1, mentionSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedMention((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(mentionSuggestions[selectedMention]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionSuggestions([]);
        return;
      }
    }

    // Unified slash/command suggestion navigation (single flat index)
    if (slashItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSlashIndex((i) => Math.min(i + 1, slashItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = slashItems[selectedSlashIndex];
        if (item) applySlashItem(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashItems([]);
        return;
      }
    }

    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggestions([]);
        return;
      }
    }

    // Escape with no active suggestions: enter navigation mode
    if (e.key === "Escape") {
      e.preventDefault();
      const { setNavigationMode } = useShellStore.getState();
      setNavigationMode(true);
      const msgList = document.querySelector<HTMLDivElement>("[data-message-list]");
      if (msgList) msgList.focus();
      return;
    }

    // Enter without Shift sends the message
    if (e.key === "Enter" && !e.shiftKey && suggestions.length === 0 && slashItems.length === 0 && mentionSuggestions.length === 0) {
      e.preventDefault();
      onSubmit();
    }
  }

  function insertEmoji(emoji: string) {
    onTextChange(text + emoji);
    setEmojiPickerOpen(false);
    textareaRef.current?.focus();
  }

  const getEmojiPickerPosition = useCallback(() => {
    if (!emojiButtonRef.current) return { x: 0, y: 0 };
    const rect = emojiButtonRef.current.getBoundingClientRect();
    return {
      x: Math.min(rect.left, window.innerWidth - 220),
      y: rect.top,
    };
  }, []);

  // Compute suggestions position — only measure DOM when suggestions are visible
  const hasSuggestions = suggestions.length > 0 || slashItems.length > 0 || mentionSuggestions.length > 0;
  const suggestionsStyle = useMemo<React.CSSProperties>(() => {
    if (!hasSuggestions || !textareaRef.current) return { position: "absolute", top: 0, left: 0 };
    const rect = textareaRef.current.getBoundingClientRect();
    return {
      position: "fixed",
      bottom: window.innerHeight - rect.top + 4,
      left: rect.left,
      minWidth: 220,
      zIndex: Z.POPOVER,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- textareaRef is stable, recalc only when suggestions visibility changes
  }, [hasSuggestions]);

  return (
    <>
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={onFilePickerOpen}
          className="rounded-lg p-2 text-rim-text-muted transition hover:text-rim-accent"
          title="Attach file"
          aria-label="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={textareaRef}
          data-composer-input
          rows={1}
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            useShellStore.getState().setFocusedSurface("composer");
            useShellStore.getState().setNavigationMode(false);
          }}
          placeholder="Write a message..."
          className="flex-1 resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
          style={{ height: "auto" }}
        />
        <button
          ref={emojiButtonRef}
          type="button"
          onClick={() => setEmojiPickerOpen((prev) => !prev)}
          className="rounded-lg p-2 text-rim-text-muted transition hover:text-rim-accent"
          title="Insert emoji"
          aria-label="Insert emoji"
        >
          <SmilePlus className="h-4 w-4" />
        </button>
        <button
          type="submit"
          disabled={isSubmitting || isUploading || !canSubmit}
          className="rounded-lg bg-rim-accent p-2 text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
          aria-label="Send message"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {slashItems.length > 0 && createPortal(
        <div
          className="max-h-[320px] overflow-y-auto rounded-lg border border-rim-line bg-rim-panel shadow-lg"
          style={suggestionsStyle}
          ref={commandListRef}
          role="listbox"
        >
          {slashItems.map((item, i) => {
            const isSelected = i === selectedSlashIndex;
            // Insert separator before first command item if preceded by built-in items
            const showSeparator = item.kind === "command" && i > 0 && slashItems[i - 1].kind === "builtin";

            return item.kind === "builtin" ? (
              <button
                key={`builtin-${item.value.command}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => applySlashSuggestion(item.value)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-1.5",
                  isSelected ? "bg-rim-accent/10" : "hover:bg-rim-void/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-rim-text">{item.value.command}</span>
                  <span className="rounded bg-rim-void px-1.5 py-0.5 text-[10px] text-rim-text-faint">chat</span>
                </div>
                <span className="truncate text-xs text-rim-text-muted">{item.value.description}</span>
              </button>
            ) : (
              <div key={`cmd-${item.value.id}`}>
                {showSeparator && <div className="mx-3 border-t border-rim-line" />}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => applyCommandSuggestion(item.value)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-1.5",
                    isSelected ? "bg-rim-accent/10" : "hover:bg-rim-void/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-rim-text">{item.value.title}</span>
                    <span className="rounded bg-rim-void px-1.5 py-0.5 text-[10px] text-rim-text-faint">{item.value.category}</span>
                    {item.value.keybind && (
                      <span className="ml-auto font-mono text-[10px] text-rim-text-faint">{item.value.keybind}</span>
                    )}
                  </div>
                  <span className="truncate text-xs text-rim-text-muted">{item.value.description}</span>
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}

      {suggestions.length > 0 && createPortal(
        <div
          ref={suggestionsRef}
          className="rounded-lg border border-rim-line bg-rim-panel shadow-lg"
          style={suggestionsStyle}
        >
          {suggestions.map((s, i) => (
            <button
              key={s.code}
              type="button"
              onClick={() => applySuggestion(s)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-sm",
                i === selectedSuggestion ? "bg-rim-accent/20 text-rim-text" : "text-rim-text hover:bg-rim-void/50",
              )}
            >
              <span className="text-base">{s.emoji}</span>
              <span className="text-rim-text-muted">{s.code}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {mentionSuggestions.length > 0 && createPortal(
        <div
          className="rounded-lg border border-rim-line bg-rim-panel shadow-lg"
          style={suggestionsStyle}
        >
          {mentionSuggestions.map((m, i) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => applyMention(m)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-sm",
                i === selectedMention ? "bg-rim-accent/20 text-rim-text" : "text-rim-text hover:bg-rim-void/50",
              )}
            >
              <Avatar url={m.avatarUrl} name={m.displayName ?? m.username} userId={m.userId} size="sm" />
              <span className="font-medium">{m.displayName ?? m.username}</span>
              <span className="text-rim-text-faint">@{m.username}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {emojiPickerOpen && (
        <EmojiPicker
          position={getEmojiPickerPosition()}
          onSelect={insertEmoji}
          onClose={() => setEmojiPickerOpen(false)}
          customEmojis={customEmojis}
        />
      )}
    </>
  );
}
