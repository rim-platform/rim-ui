/**
 * The encryption runtime of the desktop app and of a web app set up as a linked device: what
 * follows a feed page of an encrypted conversation (a stop resolved, leaves checked, keyword
 * notifications), the real-time encryption events, and the work on start and every 12 hours
 * while the app (or the browser tab) is open (key packages, Welcomes).
 */

import { useEffect } from "react";

import type { WorkspaceEvent } from "../../../core/events/types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { CacheAccount, MlsSyncNote } from "../../messages/api/messageCache";
import { requestCacheSync, setE2eeNoteHandler } from "../../messages/runtime/messageCacheSync";
import { fetchNotificationSettings } from "../../notifications/api/useNotificationSettings";
import { showBrowserNotification } from "../../notifications/runtime/browserNotification";
import { showMessageNotification } from "../../notifications/runtime/desktopNotification";
import { isWatching } from "../../notifications/runtime/useNotificationEventHandler";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import { fetchCommits, fetchConversationGroup } from "../api/e2eeApi";
import { useE2eeStore } from "../state/useE2eeStore";
import { matchingKeyword, mentionedPrincipals } from "../utils/content";
import { isWebAccount } from "../web/webAccount";
import { noteAbsentFromGroup } from "./feedInputs";
import {
  askToBeReadded,
  invalidateTimeline,
  processWelcomes,
  refreshGroups,
  refreshKeyPackages,
  verifyLeaves,
} from "./groups";
import { workspaceMembers } from "./members";
import { cancelMembershipSyncs, syncMembership } from "./membership";
import { e2eeSession, resetE2eeSession, type E2eeSession } from "./session";
import { returnAfterAbsence } from "./webReturn";

/** Key packages are checked on start and this often while the app runs. */
const KEY_PACKAGE_INTERVAL_MS = 12 * 60 * 60_000;
/** Only messages this recent get a keyword notification (not a backlog after a sync). */
const KEYWORD_WINDOW_MS = 2 * 60_000;
/** How often a tab that found another tab running encryption looks again. */
const OTHER_TAB_RETRY_MS = 30_000;

function warn(what: string) {
  return (err: unknown) => logger.warn(`[RIM:e2ee] ${what}:`, err);
}

// ─── After a feed page ──────────────────────────────────────────────────────

/** Resolve what stopped a conversation's sync, then sync it again where that helps. */
async function resolveStop(
  session: E2eeSession,
  workspaceId: string,
  note: MlsSyncNote,
): Promise<void> {
  const stop = note.stopped;
  if (!stop) return;
  const { conversationId } = note;
  switch (stop.kind) {
    case "needCommits": {
      // Fetched before the page and arrived since, or gone past the server's retention: then
      // only a re-add brings this device back.
      const commits = await fetchCommits(workspaceId, conversationId, stop.incarnation, stop.epoch);
      if (commits.some((c) => c.epoch === stop.epoch)) {
        requestCacheSync(workspaceId, [conversationId]);
      } else {
        await askToBeReadded(session, workspaceId, conversationId, stop.incarnation);
      }
      return;
    }
    case "needThreadRoot":
      // Fetched before the page; the next sync fetches again.
      requestCacheSync(workspaceId, [conversationId]);
      return;
    case "noGroupState": {
      const joined = await processWelcomes(session);
      if (joined.includes(conversationId)) return;
      const info = await fetchConversationGroup(workspaceId, conversationId);
      const group = info.mlsGroup;
      const inGroup = group?.devices.some(
        (d) => d.deviceId.toLowerCase() === session.deviceId.toLowerCase(),
      );
      if (group && inGroup && group.incarnation === stop.incarnation) {
        // The server counts this device in, but it holds no state: lost state.
        await askToBeReadded(session, workspaceId, conversationId, stop.incarnation);
        return;
      }
      noteAbsentFromGroup(conversationId, group?.incarnation ?? stop.incarnation);
      requestCacheSync(workspaceId, [conversationId]);
      return;
    }
    case "awaitingReadd": {
      const [group] = await refreshGroups(session, workspaceId, [conversationId]);
      if (!group?.readdRequestedAt) {
        await askToBeReadded(session, workspaceId, conversationId, stop.incarnation);
      }
      return;
    }
  }
}

/** A local notification for a decrypted message that matches a keyword (no inbox entry). */
async function notifyKeywords(session: E2eeSession, workspaceId: string, note: MlsSyncNote) {
  const fresh = note.decrypted.filter(
    (m) => m.authorId !== session.userId && Date.now() - Date.parse(m.sentAt) < KEYWORD_WINDOW_MS,
  );
  if (fresh.length === 0) return;
  const device = useNotificationSettingsStore.getState();
  if (!device.enabled || isWatching(note.conversationId)) return;
  const conversation = queryClient.getQueryData<{
    conversationType?: string;
    effectiveNotificationLevel?: string | null;
    title?: string | null;
  }>(queryKeys.conversation(workspaceId, note.conversationId));
  // Direct messages, mentions and `ALL` are notified by the server already.
  if (conversation?.conversationType !== "GROUP") return;
  if (conversation.effectiveNotificationLevel !== "MENTIONS") return;
  const settings = await queryClient.fetchQuery({
    queryKey: queryKeys.notificationSettings(workspaceId),
    queryFn: () => fetchNotificationSettings(workspaceId),
    staleTime: 60_000,
  });
  const members = await workspaceMembers(workspaceId);
  for (const message of fresh) {
    if (mentionedPrincipals(message.body).includes(session.principalId)) continue;
    if (!matchingKeyword(message.body, settings.keywords)) continue;
    const author = members.find((m) => m.userId === message.authorId);
    const content = {
      channelName: conversation.title ?? "Group",
      authorName: author?.displayName || author?.username || "Someone",
      messageText: message.body,
      showPreview: device.showPreview,
    };
    if (isWebAccount(session.account)) {
      showBrowserNotification(content);
      continue;
    }
    await showMessageNotification({ ...content, sound: device.soundEnabled }).catch(
      warn("keyword notification"),
    );
  }
}

export async function handleSyncNotes(
  account: CacheAccount,
  workspaceId: string,
  notes: MlsSyncNote[],
) {
  const session = await e2eeSession();
  if (!session || session.account.userId !== account.userId) return;
  for (const note of notes) {
    invalidateTimeline(workspaceId, note.conversationId);
    await resolveStop(session, workspaceId, note).catch(warn("resolving a stopped sync"));
    if (note.verify || note.misbehaved) {
      await verifyLeaves(session, workspaceId, note.conversationId, note.misbehaved).catch(
        warn("leaf check"),
      );
    }
    if (note.decrypted.length > 0) {
      await notifyKeywords(session, workspaceId, note).catch(warn("keyword match"));
    }
  }
  await refreshGroups(
    session,
    workspaceId,
    notes.map((n) => n.conversationId),
  ).catch(warn("group status"));
}

// ─── Real-time events ───────────────────────────────────────────────────────

/** The encryption events (and the membership events that move a group's devices). */
export function handleE2eeEvent(event: WorkspaceEvent, workspaceId: string) {
  void e2eeSession().then((session) => {
    if (!session) return;
    switch (event.type) {
      case "MlsWelcomeAvailable":
        if (event.device_id.toLowerCase() !== session.deviceId.toLowerCase()) return;
        void processWelcomes(session).catch(warn("joining"));
        return;
      case "MlsCommitAccepted":
        // Commits from events only start the loop; the feed and `mlsCommits` are the truth.
        requestCacheSync(workspaceId, [event.conversation_id]);
        return;
      case "MlsMembershipChanged":
        void verifyLeaves(session, workspaceId, event.conversation_id, true)
          .then(() => syncMembership(session, workspaceId, event.conversation_id))
          .catch(warn("membership change"));
        return;
      case "ConversationUpdated":
        void refreshGroups(session, workspaceId, [event.conversation_id]).catch(
          warn("group status"),
        );
        return;
      default:
        return;
    }
  });
}

// ─── Start and timers ───────────────────────────────────────────────────────

/**
 * Key packages, Welcomes and the note handler, for the signed-in account on this device. A
 * browser that comes back after a long absence leaves or re-joins its groups first.
 */
export function useE2eeRuntime(workspaceId: string | null) {
  const userId = useAuthStore((s) => s.session?.userId);

  useEffect(() => {
    if (!userId) return;
    resetE2eeSession();
    setE2eeNoteHandler((account, ws, notes) => {
      void handleSyncNotes(account, ws, notes);
    });
    let stopped = false;
    const tick = async () => {
      const session = await e2eeSession();
      if (!session || stopped) return;
      await returnAfterAbsence(session).catch(warn("returning after an absence"));
      await refreshKeyPackages(session).catch(warn("key packages"));
      await processWelcomes(session).catch(warn("joining"));
    };
    void tick();
    const timer = setInterval(() => void tick(), KEY_PACKAGE_INTERVAL_MS);
    // Another tab of this browser may close and leave encryption to this one.
    const retry = setInterval(() => {
      if (useE2eeStore.getState().webEncryption !== "otherTab") return;
      resetE2eeSession();
      void tick();
    }, OTHER_TAB_RETRY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(retry);
      setE2eeNoteHandler(null);
      cancelMembershipSyncs();
    };
  }, [userId]);

  // The workspace's encrypted conversations this device follows: pending changes, a group
  // nobody created, the weekly self-update. A browser's store opens after the app's first sync,
  // so it syncs then.
  const webEncryption = useE2eeStore((s) => s.webEncryption);
  useEffect(() => {
    if (!userId || !workspaceId) return;
    void e2eeSession().then(async (session) => {
      if (!session) return;
      if (isWebAccount(session.account)) requestCacheSync(workspaceId);
      const groups = await refreshGroups(session, workspaceId, []).catch(() => []);
      for (const group of groups) {
        void syncMembership(session, workspaceId, group.conversationId).catch(
          warn("membership sync"),
        );
      }
    });
  }, [userId, workspaceId, webEncryption]);
}
