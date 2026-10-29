import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import {
  isContextMenuKey,
  useContextMenu,
  type ContextMenuBindings,
} from "../../../shared/ui/contextMenu/useContextMenu";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { ConversationSummary } from "../../conversations/types";
import { conversationLabel } from "../../conversations/utils";
import { openDirectWithMember } from "../../conversations/state/openDirect";
import { useContacts, useRemoveContact } from "../../relay/api/useContacts";
import { useAddMemberContact } from "../../relay/contacts/useAddMemberContact";
import { useIsDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { StatusDropdown } from "../../settings/components/StatusDropdown";
import { DELETE_MEMBER_MESSAGES, hasCapability } from "../../updater/api/serverCapabilities";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useMyServerRole } from "../api/useMyServerRole";
import { useClearTimeoutMutation } from "../api/useModeration";
import { useServerMembers } from "../api/useServerMembers";
import {
  MemberModerationDialog,
  CUSTOM_DURATION,
  type MemberModeration,
  type ModeratedMember,
} from "../components/MemberModerationDialogs";
import {
  ServerMemberRoleGql,
  assignableRoles,
  canDeleteMemberMessages,
  canTargetMember,
  roleLabel,
} from "../role";
import { TIMEOUT_PRESETS, isTimeoutActive } from "../timeout";
import { ProfileCard } from "../components/ProfileCard";
import { useMemberLookup } from "./useMemberLookup";

/** A person a context menu opens on, as the surface showing them knows them. */
export interface UserMenuTarget {
  userId: string;
  /** The name the surface shows; the workspace member list's name when absent. */
  displayName?: string;
}

interface UseUserContextMenuOptions {
  workspaceId: string | null;
  /** The conversation whose members the menu is opened among, as in its members panel. */
  conversation?: ConversationSummary | null;
  /**
   * Starts removing a member from `conversation` through the surface's own confirmation.
   * Absent when the viewer may not remove its members.
   */
  onRemoveFromConversation?: (userId: string) => void;
}

/** What {@link useUserContextMenu} returns; its functions keep their identity across renders. */
interface UserContextMenu {
  /** The menu's items for a person; `anchor` is where View profile and Set status open. */
  getItems: (target: UserMenuTarget, anchor: Element) => DropdownMenuItem[];
  /**
   * Handlers that open a person's menu on the element they are spread on: a right click, the
   * ContextMenu key or Shift+F10, or a held touch, which no enclosing row then also sees.
   */
  bind: (target: UserMenuTarget) => ContextMenuBindings;
  /**
   * Opens a person's menu from an event on `anchor`, which stands for them: a right click at
   * the pointer, or the ContextMenu key or Shift+F10 under `anchor`. A key that opens the menu
   * goes no further, so an enclosing list does not open its own.
   *
   * @returns Whether a menu opened.
   */
  openFrom: (
    event: React.MouseEvent | React.KeyboardEvent,
    target: UserMenuTarget,
    anchor: Element,
  ) => boolean;
  /** Opens a person's menu under `anchor`, as the keyboard and a menu button do. */
  openUnder: (anchor: Element, target: UserMenuTarget) => boolean;
  /** The open menu and the dialog or card one of its items opened: render beside the surface. */
  element: ReactNode;
}

/** The roles of the ladder a member can hold, in the order the role submenu lists them. */
const ROLE_ORDER = [
  ServerMemberRoleGql.MODERATOR,
  ServerMemberRoleGql.MEMBER,
  ServerMemberRoleGql.GUEST,
];

type Overlay =
  | { kind: "moderation"; moderation: MemberModeration }
  | { kind: "profile"; userId: string; rect: DOMRect }
  | { kind: "status"; position: { x: number; y: number } };

/**
 * The context menu of a person, the same wherever they appear: a message's author, a mention,
 * a row of a members panel or of the member directory.
 *
 * On someone else: View profile, Send message, Copy @username, Add to contacts or Remove from
 * contacts, Remove from the conversation (from its members panel), then for an Owner or
 * Moderator who may act on them a Moderation section with Change role, Time out or Clear
 * timeout, Delete messages (on a server that deletes a person's messages), Kick and Ban. On a
 * former member an Owner or Moderator gets only Delete messages there. On the viewer: View
 * profile, Set status, Copy @username and Settings. Items the viewer cannot use are left out;
 * the server re-checks every action.
 */
export function useUserContextMenu({
  workspaceId,
  conversation,
  onRemoveFromConversation,
}: UseUserContextMenuOptions): UserContextMenu {
  const controller = useContextMenu();
  const viewerId = useAuthStore((s) => s.session?.userId);
  const viewerRole = useMyServerRole(workspaceId ?? undefined);
  const { data: members } = useServerMembers(workspaceId ?? undefined);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const myPrincipalId = useRelayStore((s) => s.account?.principalId ?? null);
  const contacts = useContacts();
  const { addContact } = useAddMemberContact();
  const removeContact = useRemoveContact();
  const clearTimeoutMutation = useClearTimeoutMutation();
  const { info: serverInfo } = useServerInfo();
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  const getItems = (target: UserMenuTarget, anchor: Element): DropdownMenuItem[] => {
    if (!workspaceId) return [];
    const { userId } = target;
    const info = memberLookup.resolve(userId);
    const member = members?.find((m) => m.userId === userId);
    const name = target.displayName ?? info.displayName;
    const handle = info.handleView;
    const items: DropdownMenuItem[] = [
      {
        id: "view-profile",
        label: "View profile",
        onSelect: () =>
          setOverlay({ kind: "profile", userId, rect: anchor.getBoundingClientRect() }),
      },
    ];

    if (userId === viewerId) {
      items.push({
        id: "set-status",
        label: "Set status…",
        onSelect: () => {
          const rect = anchor.getBoundingClientRect();
          setOverlay({ kind: "status", position: { x: rect.left, y: rect.bottom } });
        },
      });
    } else {
      items.push({
        id: "send-message",
        label: "Send message",
        onSelect: () => void openDirectWithMember(userId),
      });
    }

    if (handle) {
      items.push({
        id: "copy-username",
        label: "Copy @username",
        onSelect: () => {
          void navigator.clipboard.writeText(handle.copied);
          toast.success(`Copied ${handle.copied}`);
        },
      });
    }

    if (userId === viewerId) {
      items.push({
        id: "settings",
        label: "Settings",
        onSelect: () => useShellStore.getState().setMainSurface({ kind: "settings" }),
      });
      return items;
    }

    const principalId = member?.principalId;
    if (principalId && myPrincipalId && principalId !== myPrincipalId && contacts.data) {
      if (contacts.data.some((c) => c.principalId === principalId)) {
        items.push({
          id: "remove-contact",
          label: "Remove from contacts",
          onSelect: () =>
            removeContact.mutate(principalId, {
              onSuccess: () => toast.success(`Removed ${name} from your contacts`),
              onError: (err) =>
                toast.error(graphqlErrorMessage(err, `Could not remove ${name} from contacts`)),
            }),
        });
      } else {
        items.push({
          id: "add-contact",
          label: "Add to contacts",
          onSelect: () => void addContact(principalId, name),
        });
      }
    }

    if (conversation && onRemoveFromConversation) {
      items.push({
        id: "remove-from-conversation",
        label: `Remove from ${conversationLabel(conversation)}…`,
        onSelect: () => onRemoveFromConversation(userId),
      });
    }

    const moderated: ModeratedMember = {
      userId,
      displayName: name,
      role: info.role,
      timeoutUntil: info.timeoutUntil,
      isFormerMember: info.isFormerMember,
    };
    const offersDeletion =
      hasCapability(serverInfo, DELETE_MEMBER_MESSAGES) &&
      !inDirectSpace &&
      canDeleteMemberMessages({ userId: viewerId, role: viewerRole }, moderated);
    const deleteItem: DropdownMenuItem = {
      id: "delete-messages",
      label: "Delete messages…",
      danger: true,
      onSelect: () =>
        setOverlay({
          kind: "moderation",
          moderation: { action: "delete-messages", member: moderated },
        }),
    };
    if (!canTargetMember({ userId: viewerId, role: viewerRole }, moderated)) {
      return offersDeletion
        ? [...items, { ...deleteItem, separatorBefore: true, sectionBefore: "Moderation" }]
        : items;
    }

    const moderate = (moderation: MemberModeration) =>
      setOverlay({ kind: "moderation", moderation });
    const moderation: DropdownMenuItem[] = [];
    const roles = assignableRoles(viewerRole, moderated.role);
    if (roles.length > 0) {
      moderation.push({
        id: "change-role",
        label: "Change role",
        submenu: ROLE_ORDER.filter((role) => role === moderated.role || roles.includes(role)).map(
          (role) => ({
            id: `role-${role}`,
            label: roleLabel(role),
            checked: role === moderated.role,
            onSelect: () => {
              if (role !== moderated.role) moderate({ action: "role", member: moderated, role });
            },
          }),
        ),
      });
    }
    if (isTimeoutActive(moderated.timeoutUntil)) {
      moderation.push({
        id: "clear-timeout",
        label: "Clear timeout",
        onSelect: () =>
          clearTimeoutMutation.mutate(
            { serverId: workspaceId, userId },
            {
              onSuccess: () => toast.success(`Cleared ${name}'s timeout`),
              onError: (err) =>
                toast.error(graphqlErrorMessage(err, "Could not clear the timeout")),
            },
          ),
      });
    } else {
      moderation.push({
        id: "timeout",
        label: "Time out",
        submenu: [
          ...TIMEOUT_PRESETS.map((preset) => ({
            id: `timeout-${preset.id}`,
            label: preset.label,
            onSelect: () => moderate({ action: "timeout", member: moderated, preset: preset.id }),
          })),
          {
            id: "timeout-custom",
            label: "Custom…",
            onSelect: () =>
              moderate({ action: "timeout", member: moderated, preset: CUSTOM_DURATION }),
          },
        ],
      });
    }
    if (offersDeletion) moderation.push(deleteItem);
    moderation.push(
      {
        id: "kick",
        label: "Kick…",
        danger: true,
        onSelect: () => moderate({ action: "kick", member: moderated }),
      },
      {
        id: "ban",
        label: "Ban…",
        danger: true,
        onSelect: () => moderate({ action: "ban", member: moderated }),
      },
    );
    moderation[0] = { ...moderation[0], separatorBefore: true, sectionBefore: "Moderation" };
    return [...items, ...moderation];
  };

  const labelFor = (target: UserMenuTarget) => ({
    label: `Actions for ${target.displayName ?? memberLookup.resolve(target.userId).displayName}`,
  });

  // The returned functions read the latest items through a ref, so they keep their identity
  // for the memoized rows they are handed to.
  const latest = useRef({ getItems, labelFor });
  useLayoutEffect(() => {
    latest.current = { getItems, labelFor };
  });

  const {
    bind: bindController,
    openFromEvent: openControllerAt,
    openUnder: openBelow,
  } = controller;

  const stableGetItems = useCallback(
    (target: UserMenuTarget, anchor: Element) => latest.current.getItems(target, anchor),
    [],
  );

  const openUnder = useCallback(
    (anchor: Element, target: UserMenuTarget) =>
      openBelow(
        anchor,
        () => latest.current.getItems(target, anchor),
        latest.current.labelFor(target),
      ),
    [openBelow],
  );

  const openFrom = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent, target: UserMenuTarget, anchor: Element) => {
      if (event.type === "contextmenu") {
        return openControllerAt(
          event as React.MouseEvent,
          () => latest.current.getItems(target, anchor),
          latest.current.labelFor(target),
        );
      }
      const key = event as React.KeyboardEvent;
      if (key.defaultPrevented || !isContextMenuKey(key) || !openUnder(anchor, target)) {
        return false;
      }
      key.preventDefault();
      key.stopPropagation();
      return true;
    },
    [openControllerAt, openUnder],
  );

  const bind = useCallback(
    (target: UserMenuTarget): ContextMenuBindings => {
      let pressed: Element | null = null;
      const touch = bindController(
        () => (pressed ? latest.current.getItems(target, pressed) : []),
        latest.current.labelFor(target),
      );
      return {
        ...touch,
        onContextMenu: (event) => {
          openFrom(event, target, event.currentTarget);
        },
        onKeyDown: (event) => {
          openFrom(event, target, event.currentTarget);
        },
        onTouchStart: (event) => {
          pressed = event.currentTarget;
          // The person under the finger wins over the row around them.
          event.stopPropagation();
          touch.onTouchStart(event);
        },
      };
    },
    [bindController, openFrom],
  );

  const closeOverlay = useCallback(() => setOverlay(null), []);

  const element = (
    <>
      {controller.menu}
      {overlay?.kind === "moderation" && workspaceId && (
        <MemberModerationDialog
          workspaceId={workspaceId}
          moderation={overlay.moderation}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "profile" && (
        <ProfileCard
          workspaceId={workspaceId}
          userId={overlay.userId}
          anchorRect={overlay.rect}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "status" && (
        <StatusDropdown position={overlay.position} onClose={closeOverlay} />
      )}
    </>
  );

  return { getItems: stableGetItems, bind, openFrom, openUnder, element };
}
