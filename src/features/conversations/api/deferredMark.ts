import { gql } from "graphql-request";
import { create } from "zustand";

import { graphqlClient } from "../../../core/graphql/client";
import { graphqlErrorCode, RATE_LIMITED, retryAfterSeconds } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { invalidateUnreadNotificationCount } from "../../notifications/api/useNotifications";
import { useUnreadStore, type CountSnapshot } from "../state/useUnreadStore";

export const MARK_AS_READ = gql`
  mutation MarkAsRead($input: MarkAsReadInput!) {
    markAsRead(input: $input)
  }
`;

export const MARK_ALL_AS_READ = gql`
  mutation MarkAllAsRead($input: MarkAllAsReadInput!) {
    markAllAsRead(input: $input)
  }
`;

/** How many of a mark's calls run at once when it covers several conversations. */
const SEND_AT_ONCE = 4;

/**
 * How many of a mark's calls go without a pause. A deployment may allow a session a limited
 * number of writes a minute, so a mark of many conversations leaves room for the person's own.
 */
const SENT_WITHOUT_PAUSE = 60;

/** The pause before each call past {@link SENT_WITHOUT_PAUSE}. */
const PAUSE_MS = 750;

/** How many times one call waits out a rate limit before it counts as refused. */
const RATE_LIMIT_WAITS = 3;

/** How long to wait out a rate limit when the server named no time. */
const RATE_LIMIT_WAIT_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What one deferred mark covers. */
export type DeferredTarget =
  | { kind: "workspace"; workspaceId: string }
  | {
      kind: "conversation";
      workspaceId: string;
      conversationId: string;
      /** Marked read up to this time; a newer message stays unread. */
      readAt: string;
      /** How many of its unread messages are newer than `readAt`. */
      remaining: number;
    };

interface DeferMarkOptions {
  targets: readonly DeferredTarget[];
  /** How long the mark can be undone before the server is told. */
  waitMs: number;
  /** A running mark with this key is taken over: both marks' targets wait again as one. */
  mergeKey?: string;
  /** Shown with Undo for as long as the wait lasts; left out where the caller shows its own. */
  toastTitle?: string;
}

interface DeferredMark {
  id: number;
  mergeKey: string | null;
  userId: string | undefined;
  targets: Map<string, { target: DeferredTarget; snapshot: CountSnapshot }>;
  timer: ReturnType<typeof setTimeout>;
  toastId: string | null;
}

/** What a page can show of a mark still waiting. */
export interface DeferredMarkView {
  id: number;
  /** The conversations it marks up to a time, with their spaces. */
  conversations: readonly { conversationId: string; workspaceId: string }[];
}

/** The marks still waiting, oldest first. */
export const useDeferredMarks = create<{ marks: readonly DeferredMarkView[] }>(() => ({
  marks: [],
}));

const running = new Map<number, DeferredMark>();
let nextId = 0;

function publish(): void {
  useDeferredMarks.setState({
    marks: [...running.values()].map((mark) => ({
      id: mark.id,
      conversations: [...mark.targets.values()].flatMap(({ target }) =>
        target.kind === "conversation"
          ? [{ conversationId: target.conversationId, workspaceId: target.workspaceId }]
          : [],
      ),
    })),
  });
}

function keyOf(target: DeferredTarget): string {
  return target.kind === "workspace" ? `w:${target.workspaceId}` : `c:${target.conversationId}`;
}

function begin(target: DeferredTarget): CountSnapshot {
  const unread = useUnreadStore.getState();
  return target.kind === "workspace"
    ? unread.beginMarkAll(target.workspaceId)
    : unread.beginConversationMark(
        target.conversationId,
        target.workspaceId,
        target.remaining,
        target.readAt,
      );
}

function end(target: DeferredTarget, restore?: CountSnapshot): void {
  const unread = useUnreadStore.getState();
  if (target.kind === "workspace") unread.endMarkAll(target.workspaceId, restore);
  else unread.endConversationMark(target.conversationId, target.workspaceId, restore);
}

/** `earlier` with what `later` adds: their counts summed, and the older marker of each. */
function unionOf(earlier: CountSnapshot | undefined, later: CountSnapshot): CountSnapshot {
  if (!earlier) return later;
  const counts = { ...earlier.counts };
  for (const [conversationId, count] of Object.entries(later.counts)) {
    counts[conversationId] = (counts[conversationId] ?? 0) + count;
  }
  return { counts, markers: { ...later.markers, ...earlier.markers } };
}

function refetchCounts(workspaceIds: Iterable<string>): void {
  for (const workspaceId of new Set(workspaceIds)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCounts(workspaceId) });
  }
}

function take(id: number): DeferredMark | null {
  const mark = running.get(id);
  if (!mark) return null;
  running.delete(id);
  clearTimeout(mark.timer);
  if (mark.toastId) toast.dismiss(mark.toastId);
  publish();
  return mark;
}

/** {@link request}, waiting out a rate limit as long as the server says, a few times. */
async function requestPatiently(target: DeferredTarget): Promise<void> {
  for (let waits = 0; ; waits++) {
    try {
      await request(target);
      return;
    } catch (err) {
      if (graphqlErrorCode(err) !== RATE_LIMITED || waits === RATE_LIMIT_WAITS) throw err;
      const seconds = retryAfterSeconds(err);
      await delay(seconds === undefined ? RATE_LIMIT_WAIT_MS : seconds * 1000);
    }
  }
}

function request(target: DeferredTarget): Promise<unknown> {
  if (target.kind === "workspace") {
    return graphqlClient.request(MARK_ALL_AS_READ, { input: { workspaceId: target.workspaceId } });
  }
  return graphqlClient
    .request(MARK_AS_READ, {
      input: {
        conversationId: target.conversationId,
        workspaceId: target.workspaceId,
        readAt: target.readAt,
      },
    })
    .then(() => invalidateUnreadNotificationCount(queryClient, target.workspaceId));
}

/** Says which of a mark's calls were refused; what they covered stays unread on the server. */
function reportRefused(refused: readonly DeferredTarget[], total: number): void {
  if (refused.length === 0) return;
  if (refused.some((target) => target.kind === "workspace")) {
    toast.error("Failed to mark all as read");
  } else if (total === 1) {
    toast.error("Could not mark this as read. It stays unread.");
  } else {
    toast.error(
      `${refused.length} of ${total} conversations could not be marked read and stay unread`,
    );
  }
}

/**
 * Tells the server what a mark covers, at most {@link SEND_AT_ONCE} calls at a time and more slowly
 * past {@link SENT_WITHOUT_PAUSE}, and reads the counts again once it has answered, whichever way.
 * What is not sent yet stays marked here. Nothing is sent when the account changed during the wait.
 */
export function sendDeferredMark(id: number): void {
  const mark = take(id);
  if (!mark) return;
  const sameAccount = mark.userId === useAuthStore.getState().session?.userId;
  const queue = [...mark.targets.values()].map(({ target }) => target);
  const total = queue.length;
  const refused: DeferredTarget[] = [];
  let sent = 0;
  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      try {
        if (sameAccount) {
          if (++sent > SENT_WITHOUT_PAUSE) await delay(PAUSE_MS * SEND_AT_ONCE);
          await requestPatiently(target);
        }
      } catch {
        refused.push(target);
      } finally {
        end(target);
      }
    }
  };
  const workspaces = queue.map((target) => target.workspaceId);
  void Promise.all(Array.from({ length: Math.min(SEND_AT_ONCE, total) }, worker)).then(() => {
    reportRefused(refused, total);
    refetchCounts(workspaces);
  });
}

/** Sends the running mark with `mergeKey`, if there is one. */
export function sendDeferredMarkOf(mergeKey: string): void {
  for (const mark of running.values()) {
    if (mark.mergeKey === mergeKey) sendDeferredMark(mark.id);
  }
}

/** Puts back what a mark cleared, and sends nothing. */
export function undoDeferredMark(id: number): void {
  const mark = take(id);
  if (!mark) return;
  const entries = [...mark.targets.values()];
  for (const { target, snapshot } of entries) end(target, snapshot);
  refetchCounts(entries.map(({ target }) => target.workspaceId));
}

/** Undoes the newest mark still waiting. Returns whether there was one. */
export function undoLatestDeferredMark(): boolean {
  const latest = [...running.keys()].pop();
  if (latest === undefined) return false;
  undoDeferredMark(latest);
  return true;
}

/**
 * Clears what `targets` cover here at once and tells the server only when the wait is over, so
 * Undo sends nothing and closing the app before then marks nothing. A later read of the counts
 * does not bring them back meanwhile. Leaving the page that asked for it changes nothing.
 *
 * @returns The mark's id, for {@link undoDeferredMark}.
 */
export function deferMark({ targets, waitMs, mergeKey, toastTitle }: DeferMarkOptions): number {
  const taken = new Map<string, { target: DeferredTarget; snapshot: CountSnapshot }>();
  for (const target of targets) {
    taken.set(keyOf(target), { target, snapshot: begin(target) });
  }
  const previous = mergeKey
    ? [...running.values()].find((mark) => mark.mergeKey === mergeKey)
    : undefined;
  const merged = new Map(previous?.targets);
  for (const [key, entry] of taken) {
    merged.set(key, {
      target: entry.target,
      snapshot: unionOf(merged.get(key)?.snapshot, entry.snapshot),
    });
  }
  if (previous) take(previous.id);

  const id = ++nextId;
  const toastId = toastTitle ? `deferred-mark-${id}` : null;
  running.set(id, {
    id,
    mergeKey: mergeKey ?? null,
    userId: useAuthStore.getState().session?.userId,
    targets: merged,
    timer: setTimeout(() => sendDeferredMark(id), waitMs),
    toastId,
  });
  publish();
  if (toastTitle && toastId) {
    toast.success(toastTitle, {
      id: toastId,
      duration: waitMs,
      action: { label: "Undo", onClick: () => undoDeferredMark(id) },
    });
  }
  return id;
}
