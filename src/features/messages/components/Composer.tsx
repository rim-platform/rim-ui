import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Send, SmilePlus, Paperclip, X, Loader2, FileIcon } from "lucide-react";

import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { Z } from "../../../shared/ui/zIndex";
import { useSendMessageMutation } from "../api/useMessages";
import { useCreateAttachmentMutation, useFinalizeAttachmentMutation, uploadFileRest } from "../api/useAttachments";
import { replaceShortcodes, getShortcodeSuggestions } from "../utils/emojiShortcodes";
import { getSlashCommandSuggestions, isSlashCommand } from "../utils/slashCommands";
import type { SlashCommand } from "../utils/slashCommands";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast/useToastStore";

interface PendingFile {
  file: File;
  previewUrl: string | null;
}

export function Composer({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [text, setText] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ code: string; emoji: string }>>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
  const [selectedSlashSuggestion, setSelectedSlashSuggestion] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const send = useSendMessageMutation();
  const createAttachment = useCreateAttachmentMutation();
  const finalizeAttachment = useFinalizeAttachmentMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    // Detect slash commands
    if (trimmed) {
      const matchedCommand = isSlashCommand(trimmed);
      if (matchedCommand?.handler) {
        const args = trimmed.slice(matchedCommand.command.length).trim();
        if (args) {
          matchedCommand.handler(args);
          setText("");
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      }
    }

    const processed = trimmed ? replaceShortcodes(trimmed) : "";
    const filesToUpload = pendingFiles.map((pf) => pf.file);

    // Revoke blob URLs before clearing
    pendingFiles.forEach((pf) => {
      if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
    });

    // Clear UI immediately
    setText("");
    setPendingFiles([]);
    setSuggestions([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (filesToUpload.length === 0) {
      // No files — simple send
      send.mutate(
        { workspaceId, conversationId, text: processed },
        { onSuccess: () => textareaRef.current?.focus() },
      );
      return;
    }

    // With files: send message first, then attach files
    setIsUploading(true);
    try {
      const sendResult = await send.mutateAsync({
        workspaceId,
        conversationId,
        text: processed || " ",
      });
      const messageId = sendResult.sendMessage.id;

      // Upload each file
      for (const file of filesToUpload) {
        const ticket = await createAttachment.mutateAsync({
          serverId: workspaceId,
          conversationId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          messageId,
        });

        await uploadFileRest(file, ticket.createAttachment.uploadToken);

        await finalizeAttachment.mutateAsync({
          attachmentId: ticket.createAttachment.attachmentId,
          serverId: workspaceId,
        });
      }
    } catch {
      toast.error("Failed to upload attachment");
    } finally {
      setIsUploading(false);
      textareaRef.current?.focus();
    }
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).map((file) => ({
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPendingFiles((prev) => [...prev, ...arr]);
  }

  function removeFile(index: number) {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  // Revoke all blob URLs on unmount
  useEffect(() => {
    return () => {
      pendingFiles.forEach((pf) => {
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  // Extract the current partial shortcode being typed (word touching cursor)
  const getPartialShortcode = useCallback((value: string, cursorPos: number): string | null => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/:([a-zA-Z0-9_]*)$/);
    if (match) return match[0];
    return null;
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.currentTarget.value;
    const cursorPos = e.currentTarget.selectionStart ?? value.length;
    setText(value);

    // Auto-resize
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;

    // Slash command detection (takes priority over emoji)
    if (value.startsWith("/")) {
      const slashPartial = value.split(" ")[0];
      if (!value.includes(" ")) {
        const results = getSlashCommandSuggestions(slashPartial);
        setSlashSuggestions(results);
        setSelectedSlashSuggestion(0);
      } else {
        setSlashSuggestions([]);
      }
      setSuggestions([]);
    } else {
      setSlashSuggestions([]);

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

  function applySuggestion(suggestion: { code: string; emoji: string }) {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const match = before.match(/:([a-zA-Z0-9_]*)$/);
    if (match) {
      const newBefore = before.slice(0, before.length - match[0].length) + suggestion.emoji;
      setText(newBefore + after);
    }
    setSuggestions([]);
    textareaRef.current?.focus();
  }

  function applySlashSuggestion(command: SlashCommand) {
    setText(command.command + " ");
    setSlashSuggestions([]);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSlashSuggestion((prev) => Math.min(prev + 1, slashSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSlashSuggestion((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySlashSuggestion(slashSuggestions[selectedSlashSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashSuggestions([]);
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

    // Enter without Shift sends the message
    if (e.key === "Enter" && !e.shiftKey && suggestions.length === 0 && slashSuggestions.length === 0) {
      e.preventDefault();
      void handleSubmit(e);
    }
  }

  function insertEmoji(emoji: string) {
    setText((prev) => prev + emoji);
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

  // Compute suggestions position
  const suggestionsStyle: React.CSSProperties = (() => {
    if (!textareaRef.current) return { position: "absolute", top: 0, left: 0 };
    const rect = textareaRef.current.getBoundingClientRect();
    return {
      position: "fixed",
      bottom: window.innerHeight - rect.top + 4,
      left: rect.left,
      minWidth: 220,
      zIndex: Z.POPOVER,
    };
  })();

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void handleSubmit(e); }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col border-t border-rim-line px-4 py-3",
        isDragOver && "bg-rim-accent/5 ring-2 ring-inset ring-rim-accent/30",
      )}
    >
      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingFiles.map((pf, i) => (
            <div
              key={`${pf.file.name}-${i}`}
              className="flex items-center gap-1.5 rounded-lg border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text"
            >
              {pf.previewUrl ? (
                <img
                  src={pf.previewUrl}
                  alt={pf.file.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <FileIcon className="h-4 w-4 text-rim-text-muted" />
              )}
              <span className="max-w-[120px] truncate">{pf.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
                aria-label={`Remove ${pf.file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
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
          disabled={send.isPending || isUploading || (!text.trim() && pendingFiles.length === 0)}
          className="rounded-lg bg-rim-accent p-2 text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
          aria-label="Send message"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {slashSuggestions.length > 0 && createPortal(
        <div
          className="rounded-lg border border-rim-line bg-rim-panel shadow-lg"
          style={suggestionsStyle}
        >
          {slashSuggestions.map((cmd, i) => (
            <button
              key={cmd.command}
              type="button"
              onClick={() => applySlashSuggestion(cmd)}
              className={cn(
                "flex w-full flex-col gap-0.5 px-3 py-1.5",
                i === selectedSlashSuggestion ? "bg-rim-accent/20" : "hover:bg-white/5",
              )}
            >
              <span className="text-sm font-medium text-rim-text">{cmd.command}</span>
              <span className="text-xs text-rim-text-muted">{cmd.description}</span>
            </button>
          ))}
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
                i === selectedSuggestion ? "bg-rim-accent/20 text-rim-text" : "text-rim-text hover:bg-white/5",
              )}
            >
              <span className="text-base">{s.emoji}</span>
              <span className="text-rim-text-muted">{s.code}</span>
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
        />
      )}
    </form>
  );
}
