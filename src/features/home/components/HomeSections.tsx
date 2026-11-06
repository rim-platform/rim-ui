import { useId, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { formatRelativeTime } from "../../../shared/utils/formatTime";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { durationOf, runCounts, type AgentRun } from "../../agents/runtime/runs";
import { NotificationRow } from "../../notifications/components/NotificationsPanel";
import type { NotificationItem } from "../../notifications/api/useNotifications";
import { useMarkNotificationsRead } from "../../notifications/api/useNotifications";
import { jumpToNotification } from "../../notifications/runtime/jumpToNotification";
import { principalUserId } from "../../workspaces/api/memberName";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { openWorkspace } from "../openWorkspace";
import type { FailedWorkspace } from "../api/useHomeMentions";
import type { WaitingRow } from "../api/useHomeWaiting";
import type { WorkspaceUnread } from "../api/useHomeUnread";

const MENTIONS_PAGE = 20;

const ROW_CLASS =
  "flex w-full items-center gap-3 rounded-lg border border-rim-line bg-rim-panel px-3 py-2.5 text-left text-sm text-rim-text transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";

/** A titled section of the page; `aria-labelledby` names it by its heading. */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold text-rim-text">
        {title}
      </h2>
      {note && <p className="text-xs text-rim-text-muted">{note}</p>}
      {children}
    </section>
  );
}

/** What waits for a decision: message requests and join requests, each a way to its page. */
export function WaitingSection({ rows }: { rows: readonly WaitingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Waiting for you">
      <ul className="space-y-2">
        {rows.map((row) => {
          const key = `${row.kind}:${row.workspaceId ?? ""}`;
          const open = () => {
            if (row.kind === "dm-requests") {
              useShellStore
                .getState()
                .setMainSurface({ kind: "dm-requests", workspaceId: row.workspaceId });
              return;
            }
            const workspaces = useWorkspaceStore.getState();
            if (workspaces.workspaceId !== row.workspaceId) {
              workspaces.setWorkspaceId(row.workspaceId);
            }
            useShellStore
              .getState()
              .setMainSurface({ kind: "settings", tab: "workspace-moderation" });
          };
          return (
            <li key={key}>
              <button type="button" onClick={open} className={ROW_CLASS}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {row.kind === "dm-requests"
                      ? `${row.count} message ${row.count === 1 ? "request" : "requests"}`
                      : `${row.badge} join ${row.badge === "1" ? "request" : "requests"}`}
                  </span>
                  <span className="block truncate text-xs text-rim-text-muted">{row.label}</span>
                </span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-rim-text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** One mention or reply: the inbox row, opening its message and marking it read. */
function MentionRow({ item, workspaceName }: { item: NotificationItem; workspaceName?: string }) {
  const qc = useQueryClient();
  const markRead = useMarkNotificationsRead();
  const memberLookup = useMemberLookup(item.serverId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const resolveName = (userId: string) => memberLookup.resolve(userId).displayName;
  const mentionName = (id: string) =>
    resolveName(principalUserId(qc, item.serverId, id) ?? id) || undefined;

  function open() {
    if (!item.readAt) markRead.mutate({ serverId: item.serverId, ids: [item.id] });
    if (!item.conversation) return;
    void jumpToNotification(qc, {
      serverId: item.serverId,
      conversationId: item.conversationId,
      messageId: item.messageId,
      threadId: item.message?.threadId ?? null,
    });
  }

  return (
    <NotificationRow
      item={item}
      resolveName={resolveName}
      mentionName={mentionName}
      currentUserId={currentUserId}
      onOpen={open}
      workspaceName={workspaceName}
    />
  );
}

/**
 * Unread mentions and replies across the workspaces, newest first, twenty at a time. A workspace
 * that could not be read gets a line with Retry and does not hide the others.
 *
 * @param nameWorkspaces - Whether rows name their workspace, when more than one is shown.
 */
export function MentionsSection({
  items,
  failed,
  isPending,
  nameWorkspaces,
  labelOf,
  hasOthers,
}: {
  items: readonly NotificationItem[];
  failed: readonly FailedWorkspace[];
  isPending: boolean;
  nameWorkspaces: boolean;
  labelOf: (workspaceId: string) => string;
  hasOthers: boolean;
}) {
  const [shown, setShown] = useState(MENTIONS_PAGE);
  if (isPending) {
    return (
      <Section title="Mentions and replies">
        <p className="flex items-center gap-2 text-sm text-rim-text-muted" role="status">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      </Section>
    );
  }
  if (items.length === 0 && failed.length === 0) return null;
  return (
    <Section title="Mentions and replies">
      {items.length > 0 && (
        <ul aria-label="Mentions and replies" className="space-y-0.5">
          {items.slice(0, shown).map((item) => (
            <MentionRow
              key={item.id}
              item={item}
              workspaceName={nameWorkspaces ? labelOf(item.serverId) : undefined}
            />
          ))}
        </ul>
      )}
      {items.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + MENTIONS_PAGE)}
          className="w-full rounded-lg px-2 py-1.5 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
        >
          Show more
        </button>
      )}
      {failed.map(({ workspace, retry }) => (
        <p key={workspace.id} className="flex items-center gap-2 text-sm text-rim-text-muted">
          <span>Couldn&apos;t load {workspace.label}.</span>
          <button
            type="button"
            onClick={retry}
            className="rounded px-1.5 py-0.5 text-rim-accent hover:bg-white/5"
          >
            Retry
          </button>
        </p>
      ))}
      {hasOthers && (
        <p className="text-xs text-rim-text-faint">Other workspaces update every minute.</p>
      )}
    </Section>
  );
}

/** Per workspace, how many messages are unread in how many conversations. */
export function UnreadSection({ rows }: { rows: readonly WorkspaceUnread[] }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Unread">
      <ul className="space-y-2">
        <li>
          <button
            type="button"
            onClick={() => useShellStore.getState().setMainSurface({ kind: "unreads" })}
            className={ROW_CLASS}
          >
            <span className="min-w-0 flex-1 font-medium">See all unread</span>
            <span className="shrink-0 text-xs text-rim-text-muted">
              {rows.reduce((total, row) => total + row.messages, 0)}
            </span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-rim-text-faint" />
          </button>
        </li>
        {rows.map(({ workspace, messages, conversations }) => (
          <li key={workspace.id}>
            <button type="button" onClick={() => openWorkspace(workspace.id)} className={ROW_CLASS}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{workspace.label}</span>
                <span className="block text-xs text-rim-text-muted">
                  {messages} unread in {conversations}{" "}
                  {conversations === 1 ? "conversation" : "conversations"}
                </span>
              </span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-rim-text-faint" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The newest runs of the agents connected on this device. A run is a stretch of an agent's calls;
 * RIM does not know whether an outside agent is still working.
 */
export function AgentRunsSection({
  runs,
  onOpenRun,
  onAllRuns,
}: {
  runs: readonly AgentRun[];
  onOpenRun: (run: AgentRun) => void;
  onAllRuns: () => void;
}) {
  return (
    <Section title="Your agents' runs" note="On this device, only you see these.">
      {runs.length === 0 ? (
        <p className="text-sm text-rim-text-muted">No runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.id ?? `${run.agentId}:${run.startedAt}`}>
              <button
                type="button"
                onClick={() => onOpenRun(run)}
                className={cn(ROW_CLASS, "block")}
              >
                <span className="block break-words font-medium">
                  {showInvisibleCharacters(run.agentName)}
                  <span className="font-normal text-rim-text-muted">
                    {" · "}
                    {formatRelativeTime(run.lastAt)}
                    {" · "}
                    {durationOf(run)}
                  </span>
                </span>
                <span className="block text-xs text-rim-text-muted">{runCounts(run.entries)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onAllRuns}
        className="rounded px-1.5 py-0.5 text-xs text-rim-accent hover:bg-white/5"
      >
        All runs
      </button>
    </Section>
  );
}
