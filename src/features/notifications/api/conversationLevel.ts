import type { QueryClient } from "@tanstack/react-query";

import { NotificationLevel } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import type { ConversationSummary, ConversationSummaryPage } from "../../conversations/types";

/** The viewer's own level for a conversation and the level in effect there. */
export type LevelPatch = Pick<
  ConversationSummary,
  "notificationLevel" | "effectiveNotificationLevel"
>;

/** Writes the viewer's level into every cache that holds the conversation (header, sidebar). */
export function patchConversationLevel(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
  patch: LevelPatch,
): void {
  qc.setQueryData<ConversationSummary>(queryKeys.conversation(serverId, conversationId), (old) =>
    old ? { ...old, ...patch } : old,
  );
  for (const key of [
    queryKeys.joinedChannels(serverId),
    queryKeys.channels(serverId),
    queryKeys.conversations(serverId),
  ]) {
    qc.setQueryData<ConversationSummaryPage>(key, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)),
          }
        : old,
    );
  }
}

const LEVELS: readonly string[] = Object.values(NotificationLevel);

/** A level as `notifications.set_level` answers it (`all`, `mentions`, `none`), if it is one. */
function levelOf(value: unknown): NotificationLevel | undefined {
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  return LEVELS.includes(upper) ? (upper as NotificationLevel) : undefined;
}

/**
 * The levels the payload of `notifications.set_level` names: `level` (null for the workspace
 * default) and `effective_level`.
 *
 * @returns The patch, or `undefined` when the payload lacks the level in effect.
 */
export function levelPatchOf(payload: unknown): LevelPatch | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const fields = payload as { level?: unknown; effective_level?: unknown };
  const effective = levelOf(fields.effective_level);
  if (!effective) return undefined;
  return {
    notificationLevel: levelOf(fields.level) ?? null,
    effectiveNotificationLevel: effective,
  };
}
