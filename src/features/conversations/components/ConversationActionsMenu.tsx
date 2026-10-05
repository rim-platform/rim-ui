import { useState } from "react";
import { Archive, ArchiveRestore, LogOut, MoreHorizontal, Timer, Users } from "lucide-react";

import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useSetConversationArchivedMutation } from "../api/useChannelMembership";
import { useLeaveConversation } from "../hooks/useLeaveConversation";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import type { ConversationSummary } from "../types";
import { canLeaveConversation, conversationLabel, leaveNeedsConfirmation } from "../utils";
import { formatSlowModeInterval } from "../api/useSlowMode";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { SlowModeDialog } from "./SlowModeDialog";

interface ConversationActionsMenuProps {
  workspaceId: string;
  conversation: ConversationSummary;
}

type PendingConfirm = "archive" | "leave" | "slow-mode" | null;

/**
 * The conversation header's menu: Members, Leave (channels and groups), and for channels,
 * Owner/Moderator only, Slow mode and Archive/Unarchive (the server re-checks the role).
 */
export function ConversationActionsMenu({
  workspaceId,
  conversation,
}: ConversationActionsMenuProps) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const canModerate = useCanModerate(workspaceId);
  const toggleMembers = useMembersPanelStore((s) => s.toggle);
  const setArchived = useSetConversationArchivedMutation();
  const { leave, isPending: leavePending } = useLeaveConversation(workspaceId);

  const label = conversationLabel(conversation);
  const isChannel = conversation.conversationType === ConversationTypeEnum.CHANNEL;

  function runSetArchived(archived: boolean) {
    setArchived.mutate(
      { serverId: workspaceId, conversationId: conversation.id, archived },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(archived ? `Archived ${label}` : `Unarchived ${label}`);
        },
        onError: (err) => {
          setConfirm(null);
          toast.error(
            graphqlErrorMessage(
              err,
              archived ? "Could not archive the channel" : "Could not unarchive the channel",
            ),
          );
        },
      },
    );
  }

  const items: DropdownMenuItem[] = [
    {
      id: "members",
      label: "Members",
      icon: <Users className="h-4 w-4" />,
      onSelect: () => {
        setMenuPosition(null);
        toggleMembers();
      },
    },
  ];
  if (isChannel && canModerate && !conversation.isArchived) {
    items.push({
      id: "slow-mode",
      label:
        conversation.slowModeSeconds > 0
          ? `Slow mode (${formatSlowModeInterval(conversation.slowModeSeconds)})`
          : "Slow mode",
      icon: <Timer className="h-4 w-4" />,
      onSelect: () => {
        setMenuPosition(null);
        setConfirm("slow-mode");
      },
    });
  }
  if (isChannel && canModerate) {
    items.push(
      conversation.isArchived
        ? {
            id: "unarchive",
            label: "Unarchive channel",
            icon: <ArchiveRestore className="h-4 w-4" />,
            onSelect: () => {
              setMenuPosition(null);
              runSetArchived(false);
            },
          }
        : {
            id: "archive",
            label: "Archive channel",
            icon: <Archive className="h-4 w-4" />,
            onSelect: () => {
              setMenuPosition(null);
              setConfirm("archive");
            },
          },
    );
  }
  if (canLeaveConversation(conversation)) {
    items.push({
      id: "leave",
      label: isChannel ? "Leave channel" : "Leave conversation",
      icon: <LogOut className="h-4 w-4" />,
      danger: true,
      onSelect: () => {
        setMenuPosition(null);
        if (leaveNeedsConfirmation(conversation)) {
          setConfirm("leave");
        } else {
          leave(conversation);
        }
      },
    });
  }

  return (
    <>
      <HoverTooltip
        content={<span className="text-xs text-rim-text whitespace-nowrap">More actions</span>}
      >
        <button
          type="button"
          aria-label="Conversation menu"
          aria-haspopup="menu"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPosition({ x: rect.right - 180, y: rect.bottom + 4 });
          }}
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </HoverTooltip>

      {menuPosition && (
        <DropdownMenu items={items} position={menuPosition} onClose={() => setMenuPosition(null)} />
      )}

      {confirm === "archive" && (
        <ConfirmActionDialog
          title={`Archive ${label}?`}
          description="Archived channels are read-only for everyone: no new messages, reactions or pins. They stay readable and searchable, and an owner or moderator can unarchive them later."
          confirmLabel="Archive"
          danger
          isPending={setArchived.isPending}
          onConfirm={() => runSetArchived(true)}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === "slow-mode" && (
        <SlowModeDialog
          workspaceId={workspaceId}
          conversation={conversation}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === "leave" && (
        <ConfirmActionDialog
          title={`Leave ${label}?`}
          description="You will need an invite from a member to rejoin."
          confirmLabel="Leave"
          danger
          isPending={leavePending}
          onConfirm={() => {
            setConfirm(null);
            leave(conversation);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
