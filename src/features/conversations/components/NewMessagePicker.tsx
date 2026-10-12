import { useState, useEffect, useCallback } from "react";

import { Z } from "../../../shared/ui/zIndex";
import { useCreateConversationMutation } from "../api/useCreateConversation";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { detectOs } from "../../../core/runtime/runtime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useIsGuest } from "../../workspaces/api/useMyServerRole";
import { logger } from "../../../core/logger";
import { createGroup, shouldEncryptNewConversation } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { isWebAccount } from "../../e2ee/web/webAccount";
import { ContactPicker, type PickedContact } from "../../relay/components/ContactPicker";
import { startDirectConversation, type DirectMember } from "../../relay/conversations/startDirect";
import { useIsDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import { selectDirectConversation } from "../state/directSelection";
import { MemberPicker } from "./MemberPicker";

interface NewMessagePickerProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

/**
 * The members of a workspace selection as principals, when every one of them has a principal
 * id: then the conversation starts in this relay's direct space instead of the workspace.
 */
function asPrincipals(workspaceId: string, userIds: string[]): DirectMember[] | null {
  const members =
    queryClient.getQueryData<ServerMember[]>(queryKeys.serverMembers(workspaceId)) ?? [];
  const picked = userIds.map((id) => members.find((m) => m.userId === id));
  if (picked.some((m) => !m?.principalId)) return null;
  return (picked as ServerMember[]).map((m) => ({
    principalId: m.principalId!,
    relayUrls: [],
    name: m.displayName || m.username,
  }));
}

export function NewMessagePicker({ open, onClose, onCreated }: NewMessagePickerProps) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [startError, setStartError] = useState<string | null>(null);

  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const relayOn = useRelayStore((s) => s.info !== null);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const setFocusedSurface = useShellStore((s) => s.setFocusedSurface);
  const createMutation = useCreateConversationMutation();
  // Guests may open DMs but not create groups (the server refuses with FORBIDDEN), so their
  // picker keeps a single selection.
  const isGuest = useIsGuest(workspaceId ?? undefined);
  const handleSelectionChange = useCallback(
    (ids: string[]) => setSelectedUserIds(isGuest ? ids.slice(-1) : ids),
    [isGuest],
  );

  useEffect(() => {
    setFocusedSurface(open ? "newMessagePicker" : null);
  }, [open, setFocusedSurface]);

  // Reset state when picker closes
  useEffect(() => {
    if (!open) {
      setSelectedUserIds([]);
      setContacts([]);
      setStartError(null);
    }
  }, [open]);

  const startDirect = useCallback(
    async (members: DirectMember[]) => {
      setStartError(null);
      try {
        const { spaceId, conversationId } = await startDirectConversation(members);
        selectDirectConversation(spaceId, conversationId);
        onClose();
      } catch (err) {
        setStartError(graphqlErrorMessage(err, "Failed to create conversation"));
      }
    },
    [onClose],
  );

  const handleConfirm = useCallback(async () => {
    if (inDirectSpace) {
      if (contacts.length > 0) await startDirect(contacts);
      return;
    }
    if (!workspaceId || selectedUserIds.length === 0) return;
    // When everyone has a principal id, new DMs and groups live in this relay's direct space.
    const principals = relayOn ? asPrincipals(workspaceId, selectedUserIds) : null;
    if (principals) {
      await startDirect(principals);
      return;
    }
    // New DMs and groups are encrypted when every member is ready; this device then creates
    // the group. An existing plaintext DM the server hands back is upgraded only by a desktop.
    const session = await e2eeSession();
    const encrypted = await shouldEncryptNewConversation(
      session,
      workspaceId,
      selectedUserIds,
    ).catch(() => false);
    const base =
      selectedUserIds.length === 1
        ? { serverId: workspaceId, otherUserId: selectedUserIds[0] }
        : { serverId: workspaceId, memberIds: selectedUserIds };
    createMutation.mutate(encrypted ? { ...base, encrypted: true } : base, {
      onSuccess: (data) => {
        const conversationId = data.createConversation.id;
        const upgrade = !data.createConversation.encryptedAt;
        if (session && encrypted && (!upgrade || !isWebAccount(session.account))) {
          void createGroup(session, workspaceId, conversationId).catch((err: unknown) =>
            logger.warn("[RIM:e2ee] creating the group failed:", err),
          );
        }
        onCreated(conversationId);
      },
    });
  }, [
    workspaceId,
    selectedUserIds,
    createMutation,
    onCreated,
    inDirectSpace,
    contacts,
    relayOn,
    startDirect,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[12vh]"
      style={{ zIndex: Z.OVERLAY_CONTENT }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg rounded-xl border border-rim-line bg-rim-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {inDirectSpace ? (
          <ContactPicker
            selected={contacts}
            onChange={setContacts}
            onConfirm={() => void handleConfirm()}
            onEscape={onClose}
          />
        ) : (
          <MemberPicker
            workspaceId={workspaceId ?? undefined}
            selectedUserIds={selectedUserIds}
            onChange={handleSelectionChange}
            onConfirm={() => void handleConfirm()}
            onEscape={onClose}
            autoFocus
          />
        )}

        {/* Error */}
        {(createMutation.error || startError) && (
          <div className="border-t border-rim-line px-4 py-2">
            <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
              {startError ??
                graphqlErrorMessage(createMutation.error, "Failed to create conversation")}
            </p>
          </div>
        )}

        {/* Footer */}
        <NewMessagePickerFooter
          selectedCount={inDirectSpace ? contacts.length : selectedUserIds.length}
        />
      </div>
    </div>
  );
}

function NewMessagePickerFooter({ selectedCount }: { selectedCount: number }) {
  const isMac = detectOs() === "macos";
  const confirmHint = isMac ? "\u2318\u21A9" : "Ctrl+\u21A9";

  return (
    <div className="border-t border-rim-line px-4 py-2 flex items-center gap-4 text-[11px] text-rim-text-muted">
      <span>
        <kbd className="font-mono">&#8593;&#8595;</kbd> navigate
      </span>
      <span>
        <kbd className="font-mono">Enter</kbd> select
      </span>
      {selectedCount > 0 && (
        <span>
          <kbd className="font-mono">{confirmHint}</kbd>{" "}
          {selectedCount === 1 ? "open DM" : "create group"}
        </span>
      )}
      <span className="ml-auto">
        <kbd className="font-mono">Esc</kbd> close
      </span>
    </div>
  );
}
