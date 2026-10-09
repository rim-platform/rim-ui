import { useState, useRef, useEffect, useMemo } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useSendMessageMutation } from "../api/useMessages";
import {
  useCreateAttachmentMutation,
  useFinalizeAttachmentMutation,
  uploadFileRest,
} from "../api/useAttachments";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { queryKeys } from "../../../core/query/keys";
import { replaceShortcodes } from "../utils/emojiShortcodes";
import { isSlashCommand } from "../utils/slashCommands";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast/useToastStore";
import { useDraftStore } from "../state/useDraftStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useConversation } from "../../conversations/api/useConversation";
import { JoinChannelBar } from "../../conversations/components/JoinChannelBar";
import { ArchivedConversationBar } from "../../conversations/components/ArchivedConversationBar";
import { SuccessorOffer } from "../../relay/components/SuccessorOffer";
import { CONVERSATION_ARCHIVED, NOT_FOUND } from "../../conversations/errors";
import {
  graphqlErrorCode,
  graphqlErrorMessage,
  retryAfterSeconds,
  TIMED_OUT,
} from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { slowModeWaitMessage } from "../../conversations/api/useSlowMode";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useMyTimeout } from "../../workspaces/hooks/useMyTimeout";
import { noteTimedOutError } from "../../workspaces/state/useTimeoutStore";
import { useSlowModeStore } from "../state/useSlowModeStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { ComposerInput } from "./ComposerInput";
import { OfflineComposerNotice, SlowModeIndicator, TimedOutBanner } from "./ComposerNotices";
import { FilePreviewBar } from "./FilePreviewBar";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { SendBlock } from "../../e2ee/hooks/useE2eeConversation";
import { EncryptedSendError, sendEncrypted } from "../../e2ee/runtime/send";
import { toPrincipalMentions } from "../../e2ee/utils/content";

interface PendingFile {
  file: File;
  previewUrl: string | null;
}

interface ComposerProps {
  workspaceId: string;
  conversationId: string;
  /** Set in an end-to-end encrypted conversation: messages go through the encrypted path. */
  encryption?: { sendBlock: SendBlock };
}

/**
 * The composer, or the bar that replaces it: an archived conversation is read-only, and a
 * public channel the viewer has not joined offers Join instead.
 */
export function Composer({ workspaceId, conversationId, encryption }: ComposerProps) {
  const { data: conversation } = useConversation(workspaceId, conversationId);

  if (conversation?.isArchived) {
    return <ArchivedConversationBar workspaceId={workspaceId} conversation={conversation} />;
  }
  if (
    conversation &&
    conversation.conversationType === ConversationTypeEnum.CHANNEL &&
    !conversation.isMember
  ) {
    return <JoinChannelBar workspaceId={workspaceId} conversation={conversation} />;
  }
  return (
    <>
      <SuccessorOffer workspaceId={workspaceId} conversationId={conversationId} />
      <MessageComposer
        workspaceId={workspaceId}
        conversationId={conversationId}
        encryption={encryption}
      />
    </>
  );
}

function MessageComposer({ workspaceId, conversationId, encryption }: ComposerProps) {
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
  const executeCommand = useExecuteCommandMutation();
  const { handleKeystroke } = useTypingIndicator(workspaceId, conversationId);
  const { data: serverMembers } = useServerMembers(workspaceId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const sendBlocked = Boolean(encryption?.sendBlock);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const { data: conversation } = useConversation(workspaceId, conversationId);
  // Track 1.2: a timed-out viewer reads but cannot write; slow mode spaces out members'
  // messages (Owner/Moderator are exempt). The server enforces both.
  const timedOutUntil = useMyTimeout(workspaceId);
  const offline = useOfflineStore((s) => s.offline);
  const isModerator = useCanModerate(workspaceId);
  const slowModeSeconds = conversation?.slowModeSeconds ?? 0;
  const slowModeBlockedUntil = useSlowModeStore((s) => s.blockedUntil[conversationId]);

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

  /**
   * Shows the server's message for a failed send. An archived (or no longer visible)
   * conversation also refetches, so the composer flips to the archived bar. Slow mode and
   * timeouts give the text back, since the message never left.
   */
  function handleSendError(err: unknown, fallback: string, unsentText?: string) {
    const code = graphqlErrorCode(err);
    const waitSeconds = retryAfterSeconds(err);
    if (waitSeconds !== undefined) {
      useSlowModeStore.getState().markRateLimited(conversationId, waitSeconds);
      toast.error(slowModeWaitMessage(waitSeconds));
    } else {
      toast.error(code ? graphqlErrorMessage(err, fallback) : fallback);
    }
    if (noteTimedOutError(workspaceId, err)) {
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
    }
    if (unsentText !== undefined && (waitSeconds !== undefined || code === TIMED_OUT)) {
      restoreText(unsentText);
    }
    if (code === CONVERSATION_ARCHIVED || code === NOT_FOUND) {
      refetchConversation();
    }
  }

  function restoreText(value: string) {
    setText((current) => (current ? current : value));
    draftStore.getState().setDraft(conversationId, value);
  }

  function noteSent() {
    if (slowModeSeconds > 0 && !isModerator) {
      useSlowModeStore.getState().markSent(conversationId, slowModeSeconds);
    }
  }

  function refetchConversation() {
    qc.invalidateQueries({ queryKey: queryKeys.conversation(workspaceId, conversationId) });
  }

  async function handleSubmit() {
    if (timedOutUntil || offline) return;
    const unsentText = text;
    const trimmed = text.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    // Detect piped slash commands: `/cmd1 | cmd2 | cmd3`
    if (trimmed.startsWith("/") && trimmed.includes("|")) {
      const pipeExpression = trimmed.slice(1).trim(); // strip leading `/`
      const segmentCount = pipeExpression.split("|").filter((s) => s.trim()).length;
      setText("");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      draftStore.getState().clearDraft(conversationId);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      try {
        await executeCommand.mutateAsync({
          commandId: pipeExpression,
          commandContext: { workspaceId },
        });
        toast.success(`Piped ${segmentCount} commands successfully`);
      } catch {
        toast.error("Failed to execute piped commands");
      }
      return;
    }

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

    if (encryption) {
      await submitEncrypted(unsentText, trimmed ? replaceShortcodes(trimmed) : "");
      return;
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

    // Sending a message counts as catching up — dismiss any "New messages" divider
    useUnreadStore.getState().clearWatermark(conversationId);

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
        {
          onSuccess: () => {
            noteSent();
            textareaRef.current?.focus();
          },
          onError: (err) => handleSendError(err, "Failed to send message", unsentText),
        },
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
      noteSent();

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

        await uploadFileRest(
          file,
          ticket.createAttachment.uploadToken,
          ticket.createAttachment.attachmentId,
        );

        await finalizeAttachment.mutateAsync({
          attachmentId: ticket.createAttachment.attachmentId,
          serverId: workspaceId,
        });
      }
      // Refresh messages to update attachment status from PENDING -> READY
      qc.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, conversationId) });
    } catch (err) {
      handleSendError(err, "Failed to upload attachment");
      // The REST upload answers 409 (no GraphQL code) when the conversation was archived
      // in the meantime; refetching lets the archived bar take over if so.
      refetchConversation();
    } finally {
      setIsUploading(false);
      textareaRef.current?.focus();
    }
  }

  /** Send through the encrypted path: mentions as principal tokens, files encrypted first. */
  async function submitEncrypted(unsentText: string, text: string) {
    if (sendBlocked) return;
    const members = serverMembers ?? [];
    const principalOf = (userId: string) => members.find((m) => m.userId === userId)?.principalId;
    const body = toPrincipalMentions(text, mentionMapRef.current, principalOf);
    const files = pendingFiles.map((pf) => pf.file);
    pendingFiles.forEach((pf) => {
      if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
    });
    useUnreadStore.getState().clearWatermark(conversationId);
    setText("");
    setPendingFiles([]);
    mentionMapRef.current = new Map();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    draftStore.getState().clearDraft(conversationId);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const me = members.find((m) => m.userId === currentUserId);
    setIsUploading(files.length > 0);
    try {
      await sendEncrypted(workspaceId, conversationId, {
        body,
        files,
        author: {
          id: currentUserId ?? "",
          username: me?.username ?? "",
          displayName: me?.displayName ?? null,
          avatarUrl: me?.avatarUrl ?? null,
          principalId: me?.principalId ?? null,
        },
      });
      noteSent();
    } catch (err) {
      const fallback = "Failed to send the encrypted message";
      if (err instanceof EncryptedSendError) {
        toast.error(err.message || fallback);
        restoreText(unsentText);
      } else {
        handleSendError(err, fallback, unsentText);
      }
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
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col border-t border-rim-line px-4 py-3",
        isDragOver && "bg-rim-accent/5 ring-2 ring-inset ring-rim-accent/30",
      )}
    >
      {timedOutUntil && <TimedOutBanner until={timedOutUntil} />}
      {offline && !timedOutUntil && <OfflineComposerNotice />}
      <SlowModeIndicator
        seconds={slowModeSeconds}
        blockedUntil={slowModeBlockedUntil}
        exempt={isModerator}
      />
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

      <fieldset
        disabled={Boolean(timedOutUntil) || sendBlocked}
        aria-label={timedOutUntil ? "Composer (disabled while timed out)" : undefined}
        className="m-0 min-w-0 border-0 p-0 disabled:opacity-50"
      >
        <ComposerInput
          text={text}
          onTextChange={setText}
          onSubmit={() => void handleSubmit()}
          onKeystroke={handleKeystroke}
          saveDraftDebounced={saveDraftDebounced}
          isSubmitting={send.isPending}
          isUploading={isUploading}
          canSubmit={!offline && !!(text.trim() || pendingFiles.length > 0)}
          textareaRef={textareaRef}
          mentionMapRef={mentionMapRef}
          serverMembers={serverMembers}
          onFilePickerOpen={() => fileInputRef.current?.click()}
        />
      </fieldset>
    </form>
  );
}
