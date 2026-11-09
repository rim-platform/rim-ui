import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import {
  closeLeftConversation,
  finishLeaving,
  invalidateConversationQueries,
  refreshAfterMembershipChange,
  startLeaving,
} from "../../conversations/api/useChannelMembership";
import { findCachedConversation } from "../../conversations/api/useConversation";
import { refreshAfterMute } from "../../conversations/api/useMuteConversation";
import { invalidateTopicQueries } from "../../conversations/api/useUpdateTopic";
import { useMutedStore } from "../../conversations/state/useMutedStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import type { ConversationSummary } from "../../conversations/types";
import { invalidatePinQueries, setPinnedInCache } from "../../messages/api/usePinMessage";
import { invalidateAfterReaction } from "../../messages/api/useToggleReaction";
import { markMessageDeleted } from "../../messages/hooks/useDeleteMessage";
import { levelPatchOf, patchConversationLevel } from "../../notifications/api/conversationLevel";
import { invalidateNotificationSettings } from "../../notifications/api/useNotificationSettings";
import {
  invalidateNotificationInbox,
  invalidateUnreadNotificationCount,
  markAllReadInCache,
} from "../../notifications/api/useNotifications";
import {
  invalidateMemberMessageCounts,
  invalidateMembers,
  refreshAfterBan,
  refreshAfterUnban,
} from "../../workspaces/api/useModeration";
import type { CommandResult } from "../types";

/** One run of a backend command, as the dispatcher sends it. */
export interface CommandCall {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: Record<string, unknown>;
}

/**
 * What the app does around a backend command so every surface that runs it shows the same
 * thing: `before` runs before it is sent and may return a function that undoes it when the
 * command fails or is cancelled; `after` runs once it succeeded; `settled` runs when it ended,
 * whichever way.
 */
export interface CommandEffect {
  before?: (call: CommandCall) => void | (() => void) | Promise<void | (() => void)>;
  after?: (call: CommandCall, result: CommandResult) => void;
  settled?: (call: CommandCall) => void;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The first non-blank string among the call's arguments `names`, else its context's `key`. */
function idOf(call: CommandCall, names: readonly string[], key?: string): string | undefined {
  for (const name of names) {
    const value = stringOf(call.args?.[name]);
    if (value) return value;
  }
  return key ? stringOf(call.commandContext?.[key]) : undefined;
}

/** The workspace a call acts in: its `server_id` argument, else its context's workspace. */
function workspaceOf(call: CommandCall): string | undefined {
  return idOf(call, ["server_id", "serverId"], "workspaceId");
}

/** The conversation a call acts on: its `conversation_id` argument, else its context's. */
function conversationOf(call: CommandCall): string | undefined {
  return idOf(call, ["conversation_id", "conversationId"], "conversationId");
}

/** The message a call acts on: its `message_id` argument, else the context's selected one. */
function messageOf(call: CommandCall): string | undefined {
  return idOf(call, ["message_id", "messageId"], "selectedMessageId");
}

/** The member a call acts on: its `user_id` argument. */
function userOf(call: CommandCall): string | undefined {
  return idOf(call, ["user_id", "userId"]);
}

/** Runs `run` with the call's workspace and conversation, when both are known. */
function inConversation(
  run: (workspaceId: string, conversationId: string, call: CommandCall) => void,
): (call: CommandCall) => void {
  return (call) => {
    const workspaceId = workspaceOf(call);
    const conversationId = conversationOf(call);
    if (workspaceId && conversationId) run(workspaceId, conversationId, call);
  };
}

/** Runs `run` with the call's workspace, when it is known. */
function inWorkspace(
  run: (workspaceId: string, call: CommandCall) => void,
): (call: CommandCall) => void {
  return (call) => {
    const workspaceId = workspaceOf(call);
    if (workspaceId) run(workspaceId, call);
  };
}

/** Whether the cached conversation is end-to-end encrypted. */
function cachedEncrypted(workspaceId: string, conversationId: string): boolean {
  const conversation =
    findCachedConversation(queryClient, workspaceId, conversationId) ??
    queryClient.getQueryData<ConversationSummary>(
      queryKeys.conversation(workspaceId, conversationId),
    );
  return Boolean(conversation?.encryptedAt);
}

function pinEffect(pinned: boolean): CommandEffect {
  return {
    before: async (call) => {
      const workspaceId = workspaceOf(call);
      const conversationId = conversationOf(call);
      const messageId = messageOf(call);
      if (!workspaceId || !conversationId || !messageId) return;
      return setPinnedInCache(queryClient, workspaceId, conversationId, messageId, pinned);
    },
    settled: inConversation((workspaceId, conversationId) =>
      invalidatePinQueries(queryClient, workspaceId, conversationId),
    ),
  };
}

/** A change of membership or archive state, committed to an encrypted group when it has one. */
const MEMBERSHIP_CHANGE: CommandEffect = {
  after: inConversation((workspaceId, conversationId) =>
    refreshAfterMembershipChange(
      queryClient,
      workspaceId,
      conversationId,
      cachedEncrypted(workspaceId, conversationId),
    ),
  ),
};

/** A change of a channel's settings, which its conversation queries carry. */
const CHANNEL_SETTINGS_CHANGE: CommandEffect = {
  after: inConversation((workspaceId, conversationId) =>
    invalidateConversationQueries(queryClient, workspaceId, conversationId),
  ),
};

/** A change of the member directory: a role, a timeout or a membership. */
const MEMBER_CHANGE: CommandEffect = {
  after: inWorkspace((workspaceId) => void invalidateMembers(queryClient, workspaceId)),
};

function muteEffect(muted: boolean): CommandEffect {
  const set = (conversationId: string, on: boolean) => {
    if (on) useMutedStore.getState().mute(conversationId);
    else useMutedStore.getState().unmute(conversationId);
  };
  return {
    before: (call) => {
      const conversationId = conversationOf(call);
      if (!conversationId) return;
      set(conversationId, muted);
      return () => set(conversationId, !muted);
    },
    settled: inConversation((workspaceId, conversationId) =>
      refreshAfterMute(queryClient, workspaceId, conversationId),
    ),
  };
}

/** What each backend command with an effect does around its run, by command id. */
const COMMAND_EFFECTS: Readonly<Record<string, CommandEffect>> = {
  "chat.pin_message": pinEffect(true),
  "chat.unpin_message": pinEffect(false),
  "chat.toggle_reaction": {
    after: inConversation((workspaceId, conversationId) =>
      invalidateAfterReaction(queryClient, workspaceId, conversationId),
    ),
  },
  "chat.delete_message": {
    after: (call) => {
      const workspaceId = workspaceOf(call);
      const conversationId = conversationOf(call);
      const messageId = messageOf(call);
      if (workspaceId && conversationId && messageId) {
        markMessageDeleted(queryClient, workspaceId, conversationId, messageId);
      }
    },
  },
  "chat.archive_channel": MEMBERSHIP_CHANGE,
  "chat.unarchive_channel": MEMBERSHIP_CHANGE,
  "chat.join_channel": MEMBERSHIP_CHANGE,
  "chat.invite_to_conversation": MEMBERSHIP_CHANGE,
  "chat.remove_conversation_member": {
    after: inConversation((workspaceId, conversationId) =>
      refreshAfterMembershipChange(queryClient, workspaceId, conversationId, true),
    ),
  },
  "chat.leave_conversation": {
    before: inConversation((_workspaceId, conversationId) => startLeaving(conversationId)),
    after: inConversation((_workspaceId, conversationId) => closeLeftConversation(conversationId)),
    settled: inConversation((workspaceId, conversationId) =>
      finishLeaving(queryClient, workspaceId, conversationId),
    ),
  },
  "chat.set_topic": {
    after: inWorkspace((workspaceId) => invalidateTopicQueries(queryClient, workspaceId)),
  },
  "chat.set_slow_mode": CHANNEL_SETTINGS_CHANGE,
  "chat.set_channel_posting": CHANNEL_SETTINGS_CHANGE,
  "chat.mark_as_read": {
    before: (call) => {
      const conversationId = conversationOf(call);
      if (conversationId) useUnreadStore.getState().markRead(conversationId);
    },
    after: inWorkspace((workspaceId) =>
      invalidateUnreadNotificationCount(queryClient, workspaceId),
    ),
  },
  "admin.set_role": MEMBER_CHANGE,
  "admin.kick": MEMBER_CHANGE,
  "admin.timeout": MEMBER_CHANGE,
  "admin.clear_timeout": MEMBER_CHANGE,
  "admin.ban": {
    after: inWorkspace((workspaceId) => refreshAfterBan(queryClient, workspaceId)),
  },
  "admin.unban": {
    after: inWorkspace((workspaceId, call) => {
      const userId = userOf(call);
      if (userId) refreshAfterUnban(queryClient, workspaceId, userId);
    }),
  },
  "admin.delete_member_messages": {
    settled: inWorkspace((workspaceId, call) => {
      const userId = userOf(call);
      if (userId) invalidateMemberMessageCounts(queryClient, workspaceId, userId);
    }),
  },
  "notifications.set_level": {
    after: (call, result) => {
      const workspaceId = workspaceOf(call);
      const conversationId = conversationOf(call);
      if (!workspaceId || !conversationId) return;
      const patch = levelPatchOf(result.payload);
      if (patch) patchConversationLevel(queryClient, workspaceId, conversationId, patch);
      refreshAfterMute(queryClient, workspaceId, conversationId);
    },
  },
  "notifications.mute_conversation": muteEffect(true),
  "notifications.unmute_conversation": muteEffect(false),
  "notifications.dnd": {
    after: inWorkspace((workspaceId) => invalidateNotificationSettings(queryClient, workspaceId)),
  },
  "notifications.mark_all_read": {
    before: inWorkspace((workspaceId) => markAllReadInCache(queryClient, workspaceId)),
    settled: inWorkspace((workspaceId) => invalidateNotificationInbox(queryClient, workspaceId)),
  },
};

/** The effect of `commandId`, when it has one. */
export function commandEffect(commandId: string): CommandEffect | undefined {
  return Object.prototype.hasOwnProperty.call(COMMAND_EFFECTS, commandId)
    ? COMMAND_EFFECTS[commandId]
    : undefined;
}

/**
 * Runs part of an effect once its command ended. A failure there is logged, never reported as
 * the command's: the command ran either way.
 */
function afterRun(call: CommandCall, run: () => void): void {
  try {
    run();
  } catch (err) {
    logger.warn(`[RIM] The app's effect of ${call.commandId} failed`, err);
  }
}

/**
 * Runs a backend command with its effect around it: `before` first, then `run`; on a
 * `SUCCESS` result `after`, else the undo `before` returned; `settled` in every case. An error
 * from `run` undoes `before`, runs `settled` and propagates.
 *
 * @param call - The command run, which the effect reads its workspace, conversation and message
 *   from.
 * @param run - Sends the command and returns its result.
 * @returns What `run` returned.
 */
export async function withCommandEffect(
  call: CommandCall,
  run: () => Promise<CommandResult>,
): Promise<CommandResult> {
  const effect = commandEffect(call.commandId);
  if (!effect) return run();
  const before = effect.before ? await effect.before(call) : undefined;
  const undo = typeof before === "function" ? before : undefined;
  let result: CommandResult;
  try {
    result = await run();
  } catch (err) {
    afterRun(call, () => undo?.());
    afterRun(call, () => effect.settled?.(call));
    throw err;
  }
  afterRun(call, () => {
    if (result.status === "SUCCESS") effect.after?.(call, result);
    else undo?.();
  });
  afterRun(call, () => effect.settled?.(call));
  return result;
}
