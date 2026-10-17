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
  RATE_LIMITED,
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
import { useServerFeature } from "../../updater/hooks/useServerFeature";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { limitReachedText, utf8Bytes } from "../../limits/limits";
import { reportFeatureDisabled } from "../../../core/query/queryClient";
import { ComposerInput } from "./ComposerInput";
import {
  MessageBytesCounter,
  OfflineComposerNotice,
  SlowModeIndicator,
  TimedOutBanner,
} from "./ComposerNotices";
import { FilePreviewBar } from "./FilePreviewBar";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { SendBlock } from "../../e2ee/hooks/useE2eeConversation";
import { EncryptedSendError, sendEncrypted } from "../../e2ee/runtime/send";
import { toPrincipalMentions } from "../../e2ee/utils/content";
import {
  startDirectMessage,
  type StartedDirectMessage,
} from "../../conversations/api/startDirectMessage";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { NotReadyError } from "../../relay/conversations/startDirect";
import { directDraftKey } from "../../conversations/state/openDirect";
import { useShellStore, type DirectDraft } from "../../../shell/state/useShellStore";

interface PendingFile {
  file: File;
  previewUrl: string | null;
}

/** A draft direct message: its first message creates the conversation. */
export interface ComposerDraft {
  target: DirectDraft;
  /** Whether the draft tells the person its messages will be end-to-end encrypted. */
  encrypted: boolean;
}

type ComposerProps = {
  workspaceId: string;
  /** Set in an end-to-end encrypted conversation: messages go through the encrypted path. */
  encryption?: { sendBlock: SendBlock };
} & (
  | { conversationId: string; draft?: undefined }
  | { conversationId?: undefined; draft: ComposerDraft }
);

/**
 * The composer, or the bar that replaces it: an archived conversation is read-only, and a
 * public channel the viewer has not joined offers Join instead. A draft direct message has
 * no conversation yet and always gets the composer.
 */
export function Composer(props: ComposerProps) {
  const { workspaceId, encryption } = props;
  const { data: conversation } = useConversation(workspaceId, props.conversationId);

  if (props.draft) {
    return <MessageComposer workspaceId={workspaceId} draft={props.draft} />;
  }
  const { conversationId } = props;
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

function MessageComposer(props: ComposerProps) {
  const { workspaceId, conversationId, encryption, draft } = props;
  // Where the unsent text is kept: the conversation, or a key of the draft's own.
  const textKey = props.draft ? directDraftKey(props.draft.target) : props.conversationId;
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Set while a draft's conversation is being created and its first message sent.
  const [isStarting, setIsStarting] = useState(false);
  const startingRef = useRef(false);
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
  const { handleKeystroke, markSent } = useTypingIndicator(workspaceId, conversationId);
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
  const slowModeBlockedUntil = useSlowModeStore((s) =>
    conversationId ? s.blockedUntil[conversationId] : undefined,
  );
  // Without attachments on the server, the composer offers no attach button and takes no drop.
  const attachments = useServerFeature("attachments").enabled;
  // The instance's cap on a message's text in UTF-8 bytes; null without one.
  const byteCap = useServerInfo().limits?.messageBytes ?? null;
  const textBytes = byteCap === null ? 0 : utf8Bytes(text.trim());

  // Load the unsent text on mount and when the conversation (or draft) changes
  useEffect(() => {
    const saved = draftStore.getState().getDraft(textKey);
    setText(saved);
    mentionMapRef.current = new Map();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      if (saved) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
    return () => {
      // Flush any pending debounced save when switching away
      if (debounceRef.current) clearTimeout(debounceRef.current);
      draftStore.getState().setDraft(textKey, textareaRef.current?.value ?? "");
    };
    // draftStore is a stable module-level reference and does not need to be a dependency.
  }, [textKey]);

  // Debounced draft save
  const saveDraftDebounced = useMemo(
    () => (draftText: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        draftStore.getState().setDraft(textKey, draftText);
      }, 500);
    },
    // draftStore is a stable module-level reference and does not need to be a dependency.
    [textKey],
  );

  /**
   * Shows the server's message for a failed send. An archived (or no longer visible)
   * conversation also refetches, so the composer flips to the archived bar. A rate limit
   * (slow mode, or the server's message and request limits) and a timeout give the text back,
   * since the message never left.
   */
  function handleSendError(err: unknown, fallback: string, unsentText?: string) {
    if (reportFeatureDisabled(err, qc)) return;
    const code = graphqlErrorCode(err);
    const waitSeconds = retryAfterSeconds(err);
    if (conversationId && waitSeconds !== undefined && slowModeSeconds > 0 && !isModerator) {
      useSlowModeStore.getState().markRateLimited(conversationId, waitSeconds);
      toast.error(slowModeWaitMessage(waitSeconds));
    } else {
      toast.error(code ? graphqlErrorMessage(err, fallback) : fallback);
    }
    if (noteTimedOutError(workspaceId, err)) {
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
    }
    if (unsentText !== undefined && (code === RATE_LIMITED || code === TIMED_OUT)) {
      restoreText(unsentText);
    }
    if (code === CONVERSATION_ARCHIVED || code === NOT_FOUND) {
      refetchConversation();
    }
  }

  /** Refuses `sent` when its text is over the instance's byte cap; the composer keeps it. */
  function refuseOverByteCap(sent: string): boolean {
    if (byteCap === null || utf8Bytes(sent) <= byteCap) return false;
    toast.error(limitReachedText(byteCap, "bytes of text per message"));
    return true;
  }

  function restoreText(value: string) {
    setText((current) => (current ? current : value));
    draftStore.getState().setDraft(textKey, value);
  }

  /** Records a sent message: lifts the typing throttle and starts any slow-mode wait. */
  function noteSent() {
    markSent();
    if (conversationId && slowModeSeconds > 0 && !isModerator) {
      useSlowModeStore.getState().markSent(conversationId, slowModeSeconds);
    }
  }

  function refetchConversation(id: string | undefined = conversationId) {
    if (id) qc.invalidateQueries({ queryKey: queryKeys.conversation(workspaceId, id) });
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
      draftStore.getState().clearDraft(textKey);
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
          draftStore.getState().clearDraft(textKey);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          return;
        }
      }
    }

    if (draft) {
      await submitDraft(draft, unsentText, trimmed);
      return;
    }
    if (!conversationId) return;
    if (encryption) {
      await submitEncrypted(unsentText, trimmed, conversationId);
      return;
    }
    await submitPlain(unsentText, trimmed, conversationId);
  }

  /**
   * The first message of a draft direct message: creates the conversation, sends the message
   * there and opens it. When either step fails the text stays and so does the draft.
   */
  async function submitDraft(composerDraft: ComposerDraft, unsentText: string, trimmed: string) {
    if (startingRef.current || refuseOverByteCap(replaceShortcodes(trimmed))) return;
    startingRef.current = true;
    setIsStarting(true);
    try {
      let started: StartedDirectMessage;
      try {
        started = await startDirectMessage(composerDraft.target);
      } catch (err) {
        // Someone on another relay who cannot receive encrypted messages is named.
        if (err instanceof NotReadyError) toast.error(err.message);
        else handleSendError(err, "Failed to start the conversation");
        return;
      }
      const { workspaceId: spaceId, conversationId: id, encrypted } = started;
      if (composerDraft.encrypted && !encrypted) {
        // The draft said encrypted, and the server handed back an existing plaintext DM: the
        // text moves there unsent, for the person to decide.
        draftStore.getState().setDraft(id, unsentText);
        draftStore.getState().clearDraft(textKey);
        if (textareaRef.current) textareaRef.current.value = "";
        toast.error(
          "Not sent: your conversation with this person is not end-to-end encrypted. Your message waits there.",
        );
        openStarted(composerDraft.target, spaceId, id);
        return;
      }
      const sent = encrypted
        ? await submitEncrypted(unsentText, trimmed, id)
        : await submitPlain(unsentText, trimmed, id);
      if (!sent) {
        restoreText(unsentText);
        return;
      }
      openStarted(composerDraft.target, spaceId, id);
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }

  /**
   * Opens the conversation a draft became, which drops the draft. A plugin panel opened while
   * the first message was sending stays open.
   */
  function openStarted(target: DirectDraft, spaceId: string, id: string) {
    qc.invalidateQueries({ queryKey: queryKeys.conversations(spaceId) });
    const options = { keepPluginPanel: true };
    if ("spaceId" in target) selectDirectConversation(spaceId, id, options);
    else useShellStore.getState().setSelectedConversationId(id, options);
  }

  /** Clears the composer once a message leaves: its text, files and saved draft. */
  function clearSent() {
    pendingFiles.forEach((pf) => {
      if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
    });
    // Sending a message counts as catching up — dismiss any "New messages" divider
    if (conversationId) useUnreadStore.getState().clearWatermark(conversationId);
    setText("");
    setPendingFiles([]);
    mentionMapRef.current = new Map();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    draftStore.getState().clearDraft(textKey);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  /** Send in plaintext, then attach any files. Returns whether the message went out. */
  async function submitPlain(unsentText: string, trimmed: string, target: string) {
    let processed = trimmed ? replaceShortcodes(trimmed) : "";
    // Replace @username with <@userId> using the mention map
    for (const [username, userId] of mentionMapRef.current) {
      processed = processed.split(`@${username}`).join(`<@${userId}>`);
    }
    if (refuseOverByteCap(processed)) return false;
    const filesToUpload = pendingFiles.map((pf) => pf.file);
    clearSent();

    if (filesToUpload.length === 0) {
      // No files — simple send
      try {
        await send.mutateAsync({ workspaceId, conversationId: target, text: processed });
      } catch (err) {
        handleSendError(err, "Failed to send message", unsentText);
        return false;
      }
      noteSent();
      textareaRef.current?.focus();
      return true;
    }

    // With files: send message first, then attach files
    setIsUploading(true);
    let sent = false;
    try {
      const sendResult = await send.mutateAsync({
        workspaceId,
        conversationId: target,
        text: processed,
      });
      const messageId = sendResult.sendMessage.id;
      sent = true;
      noteSent();

      // Upload each file
      for (const file of filesToUpload) {
        const ticket = await createAttachment.mutateAsync({
          serverId: workspaceId,
          conversationId: target,
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
      qc.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, target) });
    } catch (err) {
      handleSendError(err, "Failed to upload attachment");
      // The REST upload answers 409 (no GraphQL code) when the conversation was archived
      // in the meantime; refetching lets the archived bar take over if so.
      refetchConversation(target);
    } finally {
      setIsUploading(false);
      textareaRef.current?.focus();
    }
    return sent;
  }

  /**
   * Send through the encrypted path: mentions as principal tokens, files encrypted first.
   * Returns whether the message went out.
   */
  async function submitEncrypted(unsentText: string, trimmed: string, target: string) {
    if (sendBlocked) return false;
    const members = serverMembers ?? [];
    const principalOf = (userId: string) => members.find((m) => m.userId === userId)?.principalId;
    const text = trimmed ? replaceShortcodes(trimmed) : "";
    const body = toPrincipalMentions(text, mentionMapRef.current, principalOf);
    if (refuseOverByteCap(body)) return false;
    const files = pendingFiles.map((pf) => pf.file);
    clearSent();

    const me = members.find((m) => m.userId === currentUserId);
    setIsUploading(files.length > 0);
    try {
      await sendEncrypted(workspaceId, target, {
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
      return true;
    } catch (err) {
      const fallback = "Failed to send the encrypted message";
      if (err instanceof EncryptedSendError) {
        toast.error(err.message || fallback);
        restoreText(unsentText);
      } else {
        handleSendError(err, fallback, unsentText);
      }
      return false;
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
    if (!attachments) return;
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
    if (!attachments) return;
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

      {attachments && (
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
      )}

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
          isSubmitting={send.isPending || isStarting}
          isUploading={isUploading}
          canSubmit={!offline && !!(text.trim() || pendingFiles.length > 0)}
          textareaRef={textareaRef}
          mentionMapRef={mentionMapRef}
          serverMembers={serverMembers}
          onFilePickerOpen={attachments ? () => fileInputRef.current?.click() : undefined}
        />
      </fieldset>
      <MessageBytesCounter bytes={textBytes} cap={byteCap} />
    </form>
  );
}
