import { useState, useEffect, useCallback, useRef } from "react";

import { Button } from "../../../shared/ui/Button";
import { Z } from "../../../shared/ui/zIndex";
import { useCreateConversationMutation } from "../api/useCreateConversation";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore, type DirectDraft } from "../../../shell/state/useShellStore";
import { detectOs } from "../../../core/runtime/runtime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useIsGuest } from "../../workspaces/api/useMyServerRole";
import { logger } from "../../../core/logger";
import { allMembersReady, createGroup } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { isWebAccount } from "../../e2ee/web/webAccount";
import { ContactPicker, type PickedContact } from "../../relay/components/ContactPicker";
import { startDirectConversation, type DirectMember } from "../../relay/conversations/startDirect";
import { useIsDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { rememberDirectOrigin } from "../state/directOrigin";
import { selectDirectConversation } from "../state/directSelection";
import { openDirectWith, principalsOf } from "../state/openDirect";
import { useProbationEnd } from "../../limits/api/useProbation";
import { probationText } from "../../limits/limits";
import { MemberPicker } from "./MemberPicker";

interface NewMessagePickerProps {
  open: boolean;
  onClose: () => void;
  /** A new group was created; one person opens their DM or a draft instead. */
  onCreated: (conversationId: string) => void;
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
  const probationEnd = useProbationEnd();
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

  /** One person: their direct message opens, or a draft whose first message creates it. */
  const openDirect = useCallback(
    async (target: DirectDraft) => {
      setStartError(null);
      // What is typed while it opens goes to its composer, not to the picker's search.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      try {
        await openDirectWith(target);
        onClose();
      } catch (err) {
        setStartError(graphqlErrorMessage(err, "Failed to open the conversation"));
      }
    },
    [onClose],
  );

  const startDirect = useCallback(
    async (members: DirectMember[]) => {
      const spaceId = useRelayStore.getState().info?.directSpaceId;
      if (members.length === 1 && spaceId) {
        const [{ principalId, relayUrls, name }] = members;
        await openDirect({ spaceId, member: { principalId, relayUrls, name } });
        return;
      }
      setStartError(null);
      try {
        const { spaceId, conversationId } = await startDirectConversation(members);
        rememberDirectOrigin(spaceId, conversationId);
        selectDirectConversation(spaceId, conversationId);
        onClose();
      } catch (err) {
        setStartError(graphqlErrorMessage(err, "Failed to create conversation"));
      }
    },
    [onClose, openDirect],
  );

  const handleConfirm = useCallback(async () => {
    if (inDirectSpace) {
      if (contacts.length > 0) await startDirect(contacts);
      return;
    }
    if (!workspaceId || selectedUserIds.length === 0) return;
    // When everyone has a principal id, new DMs and groups live in this relay's direct space.
    const principals = relayOn ? principalsOf(workspaceId, selectedUserIds) : null;
    if (principals) {
      await startDirect(principals);
      return;
    }
    if (selectedUserIds.length === 1) {
      await openDirect({ workspaceId, otherUserId: selectedUserIds[0] });
      return;
    }
    // New groups are encrypted whenever this device is ready; members who are not join once
    // they set up a device, and this device creates the group meanwhile. A conversation the
    // server hands back unencrypted is upgraded only by a desktop, with everyone ready.
    const session = await e2eeSession();
    const base = { serverId: workspaceId, memberIds: selectedUserIds };
    // A failure shows from `createMutation.error`.
    const data = await createMutation
      .mutateAsync(session ? { ...base, encrypted: true } : base)
      .catch(() => null);
    if (!data) return;
    const conversationId = data.createConversation.id;
    const upgrade = !data.createConversation.encryptedAt;
    if (session) {
      void (async () => {
        if (upgrade && isWebAccount(session.account)) return;
        if (upgrade && !(await allMembersReady(session, workspaceId, selectedUserIds))) return;
        await createGroup(session, workspaceId, conversationId);
      })().catch((err: unknown) => logger.warn("[RIM:e2ee] creating the group failed:", err));
    }
    onCreated(conversationId);
  }, [
    workspaceId,
    selectedUserIds,
    createMutation,
    onCreated,
    inDirectSpace,
    contacts,
    relayOn,
    startDirect,
    openDirect,
  ]);

  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  /** Runs `handleConfirm` once at a time, for the keys and the footer button alike. */
  const confirm = useCallback(async () => {
    if (confirmingRef.current || createMutation.isPending) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      await handleConfirm();
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }, [handleConfirm, createMutation.isPending]);

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
            onConfirm={() => void confirm()}
            onEscape={onClose}
          />
        ) : (
          <MemberPicker
            workspaceId={workspaceId ?? undefined}
            selectedUserIds={selectedUserIds}
            onChange={handleSelectionChange}
            onConfirm={() => void confirm()}
            onEscape={onClose}
            autoFocus
          />
        )}

        {/* Probation: a DM request to someone outside the contacts and workspaces waits */}
        {inDirectSpace && probationEnd && (
          <p
            data-testid="new-message-probation"
            className="border-t border-rim-line px-4 py-2 text-xs text-rim-warm"
          >
            {probationText("message strangers", probationEnd)} Until then, message your contacts and
            people in your workspaces.
          </p>
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
          onConfirm={() => void confirm()}
          busy={confirming || createMutation.isPending}
        />
      </div>
    </div>
  );
}

function NewMessagePickerFooter({
  selectedCount,
  onConfirm,
  busy,
}: {
  selectedCount: number;
  onConfirm: () => void;
  busy: boolean;
}) {
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
      <Button
        type="button"
        size="sm"
        disabled={selectedCount === 0}
        isLoading={busy}
        onClick={onConfirm}
      >
        {selectedCount >= 2 ? "Start group" : "Start conversation"}
      </Button>
    </div>
  );
}
