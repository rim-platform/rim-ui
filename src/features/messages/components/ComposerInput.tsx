import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Send, SmilePlus, Paperclip, Loader2 } from "lucide-react";

import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { Z } from "../../../shared/ui/zIndex";
import {
  cachedEmojiIndex,
  loadEmojiIndex,
  searchEmoji,
  SHORTCODE_QUERY,
  type EmojiSuggestion,
} from "../utils/emojiSearch";
import { getSlashCommandSuggestions } from "../utils/slashCommands";
import type { SlashCommand } from "../utils/slashCommands";
import { cn } from "../../../shared/ui/cn";
import { Avatar } from "../../../shared/ui/Avatar";
import { useCommands, useExecuteCommandMutation } from "../../commands/api/useCommands";
import { useResolvedKeybinds } from "../../commands/api/useKeybinds";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useCustomEmojis } from "../../emoji/api/useCustomEmojis";
import { CustomEmojiImage } from "../../emoji/components/CustomEmojiImage";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import { toast } from "../../../shared/toast";
import { offeredForConversation } from "../../commands/runtime/conversationActionGate";
import { offeredInSituation } from "../../commands/runtime/paletteAvailability";
import { useConversation } from "../../conversations/api/useConversation";
import { useApplicableDirectOrigin } from "../../conversations/state/directOrigin";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { hasPanelToClose } from "../../../shell/state/closeTopPanel";
import { lacksArguments, runComposerCommand } from "../../commands/runtime/composerCommand";
import {
  commandArguments,
  commandsMatching,
  namesCommand,
  splitCommandLine,
} from "../../commands/runtime/commandLine";
import { missingArgumentNames, NOT_FROM_MESSAGE_BOX } from "../../commands/runtime/commandRunnable";
import { commandOfferedHere } from "../../agent/agentAvailability";
import { BotBadge } from "../../../shared/ui/BotBadge";
import type { CommandDefinition } from "../../commands/types";

/** A member the mention list offers. */
interface MentionSuggestion {
  userId: string;
  /** The text a mention inserts after `@`: the handle as it reads, `null` when none reads. */
  mention: string | null;
  /** The member's whole handle without `@`, when known. */
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** The member is a bot. */
  isBot?: boolean;
}

interface CommandSuggestion {
  id: string;
  title: string;
  description: string;
  category: string;
  keybind: string | null;
  /** The arguments the command needs typed after its name. */
  needs: string[];
  /** Original command definition for execution */
  command: CommandDefinition;
}

const MAX_COMMAND_SUGGESTIONS = 8;

/** The `@` mention being typed before the caret: a username, or a handle with its domain. */
const MENTION_QUERY = /(?:^|\s)@([a-zA-Z0-9_-]*(?::[a-zA-Z0-9.-]*)?)$/;

/** Discriminated union for the unified slash/command suggestion list */
type SlashItem =
  { kind: "builtin"; value: SlashCommand } | { kind: "command"; value: CommandSuggestion };

interface ComposerInputProps {
  text: string;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
  /** Called with the text after each change. */
  onKeystroke: (value: string) => void;
  saveDraftDebounced: (text: string) => void;
  isSubmitting: boolean;
  isUploading: boolean;
  canSubmit: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionMapRef: React.RefObject<Map<string, string>>;
  serverMembers: MentionSuggestion[] | undefined;
  /** Opens the file picker; without it the composer shows no attach button. */
  onFilePickerOpen?: () => void;
  /** Where the box writes: a conversation's composer or a thread's reply box. */
  variant?: "conversation" | "thread";
  /** Called on Escape with no suggestion list open; returns true when it handled the key. */
  onEscape?: () => boolean;
  /** Set while Esc has closed the command list for the line, which is then sent as text. */
  commandListClosedRef: React.RefObject<boolean>;
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
  variant = "conversation",
  onEscape,
  commandListClosedRef,
}: ComposerInputProps) {
  const inThread = variant === "thread";
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

  const selectedConversationId = useShellStore((s) => s.selectedConversationId);
  const { data: openConversation } = useConversation(workspaceId, selectedConversationId);

  // Esc closes the command list for one line: until it is emptied or the conversation changes.
  useEffect(() => {
    commandListClosedRef.current = false;
  }, [selectedConversationId, commandListClosedRef]);
  useEffect(() => {
    if (!text.startsWith("/")) commandListClosedRef.current = false;
  }, [text, commandListClosedRef]);
  const inDirectSpace = useIsDirectSpace(workspaceId ?? undefined);
  const hasDirectOrigin = useApplicableDirectOrigin() !== null;

  /** What decides which situational commands the list offers, as the palette reads it. */
  function situation() {
    return {
      inDirectSpace,
      hasDirectOrigin,
      panelOpen: hasPanelToClose(),
      unreadsOpen: useShellStore.getState().mainSurface.kind === "unreads",
    };
  }

  // Autocomplete state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [shortcodeQuery, setShortcodeQuery] = useState<string | null>(null);
  const [emojiIndex, setEmojiIndex] = useState(cachedEmojiIndex);
  const suggestions = useMemo(
    () => (shortcodeQuery ? searchEmoji(shortcodeQuery, emojiIndex, customEmojis) : []),
    [shortcodeQuery, emojiIndex, customEmojis],
  );
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [slashItems, setSlashItems] = useState<SlashItem[]>([]);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [selectedMention, setSelectedMention] = useState(0);

  // The selected `/` suggestion stays in view as the arrow keys move it.
  useEffect(() => {
    commandListRef.current
      ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedSlashIndex, slashItems]);

  // Extract the current `:` emoji query being typed (word touching cursor), without the colon
  const getPartialShortcode = useCallback((value: string, cursorPos: number): string | null => {
    const before = value.slice(0, cursorPos);
    const match = before.match(SHORTCODE_QUERY);
    if (match) return match[1];
    return null;
  }, []);

  // Extract partial @mention query from cursor position
  const getPartialMention = useCallback((value: string, cursorPos: number): string | null => {
    const before = value.slice(0, cursorPos);
    const match = before.match(MENTION_QUERY);
    if (match) return match[1];
    return null;
  }, []);

  // Filter members based on mention query
  const updateMentionSuggestions = useCallback(
    (query: string) => {
      if (!serverMembers) {
        setMentionSuggestions([]);
        return;
      }
      const lower = query.toLowerCase();
      const filtered = serverMembers
        .filter((m) => {
          if (lower.includes(":")) return (m.handle ?? "").startsWith(lower);
          const name = (m.displayName ?? "").toLowerCase();
          const mention = (m.mention ?? "").toLowerCase();
          return name.includes(lower) || mention.includes(lower);
        })
        .filter((m) => m.mention !== null || m.displayName)
        .slice(0, 8);
      setMentionSuggestions(filtered);
      setSelectedMention(0);
    },
    [serverMembers],
  );

  /**
   * Lists the commands the words typed after `/` name, and highlights the first. The list stays
   * open across spaces and arguments; it is empty, so Enter sends the text, for a line no
   * command matches, a pipe, or one Esc closed.
   */
  function showSlashList(value: string) {
    const items: SlashItem[] = [];
    if (!commandListClosedRef.current && !value.includes("|")) {
      // Built-in slash commands (/agent, /macro) take their text after the name.
      if (!inThread && !value.includes(" ")) {
        for (const cmd of getSlashCommandSuggestions(value)) {
          items.push({ kind: "builtin", value: cmd });
        }
      }
      const { head } = splitCommandLine(value);
      const offered = (allCommands ?? [])
        .filter((cmd) => commandOfferedHere(cmd.id) && !NOT_FROM_MESSAGE_BOX.has(cmd.id))
        .filter((cmd) => offeredInSituation(cmd.id, situation()))
        .filter((cmd) => offeredForConversation(cmd.id, openConversation));
      for (const cmd of commandsMatching(head, offered).slice(0, MAX_COMMAND_SUGGESTIONS)) {
        items.push({
          kind: "command",
          value: {
            id: cmd.id,
            title: cmd.title,
            description: cmd.description,
            category: cmd.category,
            keybind: keybindMap.get(cmd.id) ?? null,
            needs: missingArgumentNames(cmd, currentCommandContext()),
            command: cmd,
          },
        });
      }
    }
    setSlashItems(items);
    setSelectedSlashIndex(0);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.currentTarget.value;
    const cursorPos = e.currentTarget.selectionStart ?? value.length;
    onTextChange(value);
    saveDraftDebounced(value);
    onKeystroke(value);

    // Auto-resize
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;

    // Slash command list (takes priority over emoji)
    if (value === "" || !value.startsWith("/")) commandListClosedRef.current = false;
    if (value.startsWith("/")) {
      showSlashList(value);
      setShortcodeQuery(null);
    } else {
      setSlashItems([]);

      // @mention detection (takes priority over emoji)
      const mentionPartial = getPartialMention(value, cursorPos);
      if (mentionPartial !== null) {
        updateMentionSuggestions(mentionPartial);
        setShortcodeQuery(null);
      } else {
        setMentionSuggestions([]);

        // Emoji shortcode detection
        const query = getPartialShortcode(value, cursorPos);
        if (query && query.length >= 2) {
          setShortcodeQuery(query);
          setSelectedSuggestion(0);
          // Without the index the suggestions list custom emoji only; the next shortcode tries
          // again.
          if (!emojiIndex) void loadEmojiIndex().then(setEmojiIndex, () => {});
        } else {
          setShortcodeQuery(null);
        }
      }
    }
  }

  function applySuggestion(suggestion: EmojiSuggestion) {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const match = before.match(SHORTCODE_QUERY);
    if (match) {
      // A custom emoji is sent as `:name:` text, which needs a space to stand apart.
      const newBefore =
        before.slice(0, before.length - match[1].length - 1) +
        suggestion.insert +
        (suggestion.imageUrl ? " " : "");
      onTextChange(newBefore + after);
    }
    setShortcodeQuery(null);
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

  /**
   * Runs a command picked from the list with the arguments typed after its name. A picked command
   * that still needs arguments is left as `/id ` to finish, with the list open; typed out in
   * full, it says which are missing and sends nothing.
   */
  function applyCommandSuggestion(suggestion: CommandSuggestion) {
    const { command } = suggestion;
    const typed = splitCommandLine(text);
    if (typed.error) {
      toast.error(`${command.title}: ${typed.error}`);
      return;
    }
    const args = commandArguments(command, typed.pairs);
    if (missingArgumentNames(command, currentCommandContext(), args).length > 0) {
      if (namesCommand(command, typed.head)) {
        lacksArguments(command, args);
      } else {
        const next = `/${command.id} `;
        onTextChange(next);
        showSlashList(next);
      }
      textareaRef.current?.focus();
      return;
    }
    onTextChange("");
    commandListClosedRef.current = false;
    setSlashItems([]);
    textareaRef.current?.focus();
    void runComposerCommand(
      command,
      (input) => executeMutationRef.current.mutateAsync(input),
      Object.keys(args).length > 0 ? args : undefined,
    );
  }

  function applyMention(member: MentionSuggestion) {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const match = before.match(MENTION_QUERY);
    const name = member.mention ?? member.displayName ?? "";
    if (match) {
      const atStart =
        before.length -
        match[0].length +
        (match[0].startsWith(" ") || match[0].startsWith("\n") ? 1 : 0);
      const newBefore = before.slice(0, atStart) + `@${name} `;
      const newText = newBefore + after;
      onTextChange(newText);
      // The inserted name becomes the member's mention token when the message is sent
      mentionMapRef.current.set(name, member.userId);
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
        commandListClosedRef.current = true;
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
        setShortcodeQuery(null);
        return;
      }
    }

    if (e.key === "Escape" && onEscape?.()) {
      e.preventDefault();
      return;
    }

    // Esc on a pipe, which has no list, marks the line as text too.
    if (
      e.key === "Escape" &&
      !commandListClosedRef.current &&
      text.startsWith("/") &&
      text.includes("|")
    ) {
      e.preventDefault();
      commandListClosedRef.current = true;
      return;
    }

    // Escape with no active suggestions: enter navigation mode; in a thread it closes the pane
    if (!inThread && e.key === "Escape") {
      e.preventDefault();
      const { setNavigationMode } = useShellStore.getState();
      setNavigationMode(true);
      const msgList = document.querySelector<HTMLDivElement>("[data-message-list]");
      if (msgList) msgList.focus();
      return;
    }

    // Enter without Shift sends the message
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      suggestions.length === 0 &&
      slashItems.length === 0 &&
      mentionSuggestions.length === 0
    ) {
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
  const hasSuggestions =
    suggestions.length > 0 || slashItems.length > 0 || mentionSuggestions.length > 0;
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
        {onFilePickerOpen && (
          <button
            type="button"
            onClick={onFilePickerOpen}
            className="rounded-lg p-2 text-rim-text-muted transition hover:text-rim-accent"
            title="Attach file"
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}
        <textarea
          ref={textareaRef}
          data-composer-input={inThread ? undefined : true}
          data-thread-composer-input={inThread ? true : undefined}
          data-suggestions-open={hasSuggestions ? true : undefined}
          rows={1}
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!inThread) useShellStore.getState().setFocusedSurface("composer");
            useShellStore.getState().setNavigationMode(false);
          }}
          placeholder={inThread ? "Reply in thread..." : "Write a message..."}
          aria-label={inThread ? "Reply in thread" : undefined}
          className="w-0 flex-1 resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
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
          className="rounded-lg bg-rim-text p-2 text-rim-panel transition hover:bg-rim-text/90 disabled:opacity-50"
          aria-label={inThread ? "Send reply" : "Send message"}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>

      {slashItems.length > 0 &&
        createPortal(
          <div
            className="max-h-[320px] overflow-y-auto rounded-lg border border-rim-line bg-rim-panel shadow-lg"
            style={suggestionsStyle}
            ref={commandListRef}
            role="listbox"
          >
            {slashItems.map((item, i) => {
              const isSelected = i === selectedSlashIndex;
              // Insert separator before first command item if preceded by built-in items
              const showSeparator =
                item.kind === "command" && i > 0 && slashItems[i - 1].kind === "builtin";

              return item.kind === "builtin" ? (
                <button
                  key={`builtin-${item.value.command}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => applySlashSuggestion(item.value)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left",
                    isSelected ? "bg-rim-accent/10" : "hover:bg-rim-void/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-rim-text">
                      {item.value.command}
                    </span>
                    <span className="rounded bg-rim-void px-1.5 py-0.5 text-[10px] text-rim-text-faint">
                      chat
                    </span>
                  </div>
                  <span className="truncate text-xs text-rim-text-muted">
                    {item.value.description}
                  </span>
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
                      "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left",
                      isSelected
                        ? "border-l-2 border-rim-accent bg-rim-accent/10"
                        : "border-l-2 border-transparent hover:bg-rim-void/50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-rim-text">
                        {item.value.title}
                      </span>
                      <span className="rounded bg-rim-void px-1.5 py-0.5 text-[10px] text-rim-text-faint">
                        {item.value.category}
                      </span>
                      {item.value.keybind && (
                        <span className="ml-auto font-mono text-[10px] text-rim-text-faint">
                          {item.value.keybind}
                        </span>
                      )}
                    </div>
                    <span className="truncate text-xs text-rim-text-muted">
                      {item.value.description}
                      {item.value.needs.length > 0 && ` Needs ${item.value.needs.join(", ")}.`}
                    </span>
                  </button>
                </div>
              );
            })}
            <div className="sticky bottom-0 border-t border-rim-line bg-rim-panel px-3 py-1 text-[11px] text-rim-text-muted">
              Enter runs the highlighted command. Esc closes the list and sends the text.
            </div>
          </div>,
          document.body,
        )}

      {suggestions.length > 0 &&
        createPortal(
          <div
            ref={suggestionsRef}
            className="rounded-lg border border-rim-line bg-rim-panel shadow-lg"
            style={suggestionsStyle}
          >
            {suggestions.map((s, i) => (
              <button
                key={s.insert}
                type="button"
                onClick={() => applySuggestion(s)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-sm",
                  i === selectedSuggestion
                    ? "bg-rim-accent/20 text-rim-text"
                    : "text-rim-text hover:bg-rim-void/50",
                )}
              >
                {s.imageUrl ? (
                  <CustomEmojiImage url={s.imageUrl} name="" className="h-4 w-4" />
                ) : (
                  <span className="text-base">{s.emoji}</span>
                )}
                <span className="text-rim-text-muted">:{s.code}:</span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {mentionSuggestions.length > 0 &&
        createPortal(
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
                  i === selectedMention
                    ? "bg-rim-accent/20 text-rim-text"
                    : "text-rim-text hover:bg-rim-void/50",
                )}
              >
                <Avatar
                  url={m.avatarUrl}
                  name={m.displayName ?? m.mention ?? ""}
                  userId={m.userId}
                  size="sm"
                />
                <span className="font-medium">{m.displayName ?? m.mention}</span>
                {m.isBot && <BotBadge />}
                {m.mention && <span className="text-rim-text-faint">@{m.mention}</span>}
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
