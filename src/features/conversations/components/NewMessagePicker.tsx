import { useState, useEffect, useCallback } from "react";

import { Z } from "../../../shared/ui/zIndex";
import { useCreateConversationMutation } from "../api/useCreateConversation";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { detectOs } from "../../../core/runtime/runtime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { MemberPicker } from "./MemberPicker";

interface NewMessagePickerProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

export function NewMessagePicker({ open, onClose, onCreated }: NewMessagePickerProps) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setFocusedSurface = useShellStore((s) => s.setFocusedSurface);
  const createMutation = useCreateConversationMutation();

  useEffect(() => {
    setFocusedSurface(open ? "newMessagePicker" : null);
  }, [open, setFocusedSurface]);

  // Reset state when picker closes
  useEffect(() => {
    if (!open) setSelectedUserIds([]);
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (!workspaceId || selectedUserIds.length === 0) return;
    const input =
      selectedUserIds.length === 1
        ? { serverId: workspaceId, otherUserId: selectedUserIds[0] }
        : { serverId: workspaceId, memberIds: selectedUserIds };
    createMutation.mutate(input, {
      onSuccess: (data) => onCreated(data.createConversation.id),
    });
  }, [workspaceId, selectedUserIds, createMutation, onCreated]);

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
        <MemberPicker
          workspaceId={workspaceId ?? undefined}
          selectedUserIds={selectedUserIds}
          onChange={setSelectedUserIds}
          onConfirm={handleConfirm}
          onEscape={onClose}
          autoFocus
        />

        {/* Error */}
        {createMutation.error && (
          <div className="border-t border-rim-line px-4 py-2">
            <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
              {graphqlErrorMessage(createMutation.error, "Failed to create conversation")}
            </p>
          </div>
        )}

        {/* Footer */}
        <NewMessagePickerFooter selectedCount={selectedUserIds.length} />
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
