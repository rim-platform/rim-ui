import { useState, useRef, useEffect, useMemo } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useSendMessageMutation } from "../api/useMessages";
import { useCreateAttachmentMutation, useFinalizeAttachmentMutation, uploadFileRest } from "../api/useAttachments";
import { queryKeys } from "../../../core/query/keys";
import { replaceShortcodes } from "../utils/emojiShortcodes";
import { isSlashCommand } from "../utils/slashCommands";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast/useToastStore";
import { useDraftStore } from "../state/useDraftStore";
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { ComposerInput } from "./ComposerInput";
import { FilePreviewBar } from "./FilePreviewBar";

interface PendingFile {
  file: File;
  previewUrl: string | null;
}

export function Composer({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Maps @username -> userId for converting mentions on submit
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  const qc = useQueryClient();
  const send = useSendMessageMutation();
  const createAttachment = useCreateAttachmentMutation();
  const finalizeAttachment = useFinalizeAttachmentMutation();
  // `draftStore` is a module-level Zustand store reference — it is stable across
  // renders and does not need to appear in hook dependency arrays.
  const draftStore = useDraftStore;
  const { handleKeystroke } = useTypingIndicator(workspaceId, conversationId);
  const { data: serverMembers } = useServerMembers(workspaceId);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Load draft on mount and when conversationId changes
  useEffect(() => {
    const draft = draftStore.getState().getDraft(conversationId);
    setText(draft);
    mentionMapRef.current = new Map();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      if (draft) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
    return () => {
      // Flush any pending debounced save when switching away
      if (debounceRef.current) clearTimeout(debounceRef.current);
      draftStore.getState().setDraft(conversationId, textareaRef.current?.value ?? "");
    };
    // draftStore is a stable module-level reference and does not need to be a dependency.
  }, [conversationId]);

  // Debounced draft save
  const saveDraftDebounced = useMemo(
    () => (draftText: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        draftStore.getState().setDraft(conversationId, draftText);
      }, 500);
    },
    // draftStore is a stable module-level reference and does not need to be a dependency.
    [conversationId],
  );

  async function handleSubmit() {
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
          if (debounceRef.current) clearTimeout(debounceRef.current);
          draftStore.getState().clearDraft(conversationId);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      }
    }

    let processed = trimmed ? replaceShortcodes(trimmed) : "";
    // Replace @username with <@userId> using the mention map
    for (const [username, userId] of mentionMapRef.current) {
      processed = processed.split(`@${username}`).join(`<@${userId}>`);
    }
    const filesToUpload = pendingFiles.map((pf) => pf.file);

    // Revoke blob URLs before clearing
    pendingFiles.forEach((pf) => {
      if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
    });

    // Clear UI immediately
    setText("");
    setPendingFiles([]);
    mentionMapRef.current = new Map();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    draftStore.getState().clearDraft(conversationId);
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
        text: processed,
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
      // Refresh messages to update attachment status from PENDING -> READY
      qc.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, conversationId) });
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
      pendingFilesRef.current.forEach((pf) => {
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
      });
    };
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

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col border-t border-rim-line px-4 py-3",
        isDragOver && "bg-rim-accent/5 ring-2 ring-inset ring-rim-accent/30",
      )}
    >
      <FilePreviewBar pendingFiles={pendingFiles} onRemove={removeFile} />

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

      <ComposerInput
        text={text}
        onTextChange={setText}
        onSubmit={() => void handleSubmit()}
        onKeystroke={handleKeystroke}
        saveDraftDebounced={saveDraftDebounced}
        isSubmitting={send.isPending}
        isUploading={isUploading}
        canSubmit={!!(text.trim() || pendingFiles.length > 0)}
        textareaRef={textareaRef}
        mentionMapRef={mentionMapRef}
        serverMembers={serverMembers}
        onFilePickerOpen={() => fileInputRef.current?.click()}
      />
    </form>
  );
}
