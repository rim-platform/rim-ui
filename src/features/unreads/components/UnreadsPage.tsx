import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { isTextEntry } from "../../../shared/ui/focusNavigation";
import { isAfter } from "../../../shared/utils/timestamps";
import { runDesktopLocalCommand } from "../../commands/runtime/commandDispatcher";
import {
  deferMark,
  undoLatestDeferredMark,
  type DeferredTarget,
} from "../../conversations/api/deferredMark";
import { useLoadQueue } from "../api/loadQueue";
import { useUnreadGroups, type UnreadGroup } from "../api/useUnreadGroups";
import { useUnreadsPageStore, type UnreadsPageControls } from "../state/useUnreadsPageStore";
import { FailureCard, UnreadGroupSection, type GroupActions } from "./UnreadGroupSection";

/** How long a mark made on this page can be undone before the server is told. */
export const UNREADS_UNDO_MS = 10_000;

/** Overlays that keep the keyboard for themselves while they are open. */
const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"]';

const KEY_COMMANDS: Readonly<Record<string, string>> = {
  j: "workspace.unreads_next",
  arrowdown: "workspace.unreads_next",
  k: "workspace.unreads_previous",
  arrowup: "workspace.unreads_previous",
  e: "workspace.unreads_mark_group",
  u: "workspace.unreads_undo",
};

/**
 * Groups by their newest message once known, newest first, ahead of those not known yet, which
 * go by how much is unread.
 */
function sortGroups(
  groups: readonly UnreadGroup[],
  newest: ReadonlyMap<string, string>,
): UnreadGroup[] {
  return [...groups].sort((a, b) => {
    const aAt = newest.get(a.conversationId);
    const bAt = newest.get(b.conversationId);
    if (aAt && bAt) return isAfter(aAt, bAt) ? -1 : isAfter(bAt, aAt) ? 1 : 0;
    if (aAt) return -1;
    if (bAt) return 1;
    return b.count - a.count;
  });
}

/**
 * Unreads: every unread message across the account's spaces, a group per conversation, staying
 * until it is marked read. Looking at the page marks nothing. Marking waits {@link UNREADS_UNDO_MS}
 * before the server is told, whether or not the page stays open.
 */
export function UnreadsPage() {
  const { spaces, groups, failed, isPending } = useUnreadGroups();
  const [filter, setFilter] = useState<string | null>(null);
  const [showMuted, setShowMuted] = useState(false);
  const [newest, setNewest] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const queue = useLoadQueue();
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef(new Map<string, GroupActions>());

  const chips = spaces.filter(
    (space) => !space.direct || groups.some((group) => group.space.id === space.id),
  );
  const only = chips.some((space) => space.id === filter) ? filter : null;
  const inFilter = groups.filter((group) => only === null || group.space.id === only);
  const mutedCount = inFilter.filter((group) => group.muted).length;
  const shown = useMemo(
    () =>
      sortGroups(
        inFilter.filter((group) => showMuted || !group.muted),
        newest,
      ),
    [inFilter, showMuted, newest],
  );
  const shownGroupsRef = useRef(shown);
  useEffect(() => {
    shownGroupsRef.current = shown;
  });

  const onNewest = useCallback((conversationId: string, sentAt: string) => {
    setNewest((previous) => {
      if (previous.get(conversationId) === sentAt) return previous;
      return new Map(previous).set(conversationId, sentAt);
    });
  }, []);

  const register = useCallback((conversationId: string, actions: GroupActions | null) => {
    if (actions) actionsRef.current.set(conversationId, actions);
    else actionsRef.current.delete(conversationId);
  }, []);

  const options = () => [
    ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
  ];

  const selectedRowIdRef = useRef(selectedRowId);
  useEffect(() => {
    selectedRowIdRef.current = selectedRowId;
  });

  const select = useCallback((row: HTMLElement | undefined) => {
    if (!row) return;
    selectedRowIdRef.current = row.id;
    setSelectedRowId(row.id);
    row.scrollIntoView({ block: "nearest" });
  }, []);

  const selectedRow = () =>
    selectedRowIdRef.current ? document.getElementById(selectedRowIdRef.current) : null;

  /** The group of the selected row, or the first one shown when nothing is selected. */
  const selectedGroupId = () =>
    selectedRow()?.closest("[data-unread-group]")?.getAttribute("data-unread-group") ??
    shownGroupsRef.current[0]?.conversationId ??
    null;

  const markOne = useCallback((target: DeferredTarget) => {
    deferMark({ targets: [target], waitMs: UNREADS_UNDO_MS });
  }, []);

  const markAllShown = () => {
    const targets = shown.flatMap((group) => {
      if (group.markId !== null) return [];
      const target = actionsRef.current.get(group.conversationId)?.markTarget();
      return target ? [target] : [];
    });
    if (targets.length === 0) {
      toast.info("Nothing is loaded to mark yet");
      return;
    }
    const open = shown.filter((group) => group.markId === null).length;
    const noun = open === 1 ? "conversation" : "conversations";
    deferMark({
      targets,
      waitMs: UNREADS_UNDO_MS,
      toastTitle:
        targets.length === open
          ? `${targets.length} ${noun} marked as read`
          : `${targets.length} of ${open} ${noun} marked as read. The others haven't loaded yet.`,
    });
  };

  const markAllShownRef = useRef(markAllShown);
  useEffect(() => {
    markAllShownRef.current = markAllShown;
  });

  // The page's commands, which the palette, keybinds and the keys below all run.
  useEffect(() => {
    const controls: UnreadsPageControls = {
      next: () => {
        const rows = options();
        const at = rows.findIndex((row) => row.id === selectedRowIdRef.current);
        select(rows[Math.min(at + 1, rows.length - 1)]);
      },
      previous: () => {
        const rows = options();
        const at = rows.findIndex((row) => row.id === selectedRowIdRef.current);
        select(rows[Math.max(at - 1, 0)]);
      },
      markGroup: () => {
        const id = selectedGroupId();
        if (id) actionsRef.current.get(id)?.mark();
      },
      open: () => {
        const id = selectedGroupId();
        if (!id) return;
        const messageId = selectedRow()?.getAttribute("data-message-id") ?? undefined;
        actionsRef.current.get(id)?.open(messageId);
      },
      undo: () => void undoLatestDeferredMark(),
      markAllShown: () => markAllShownRef.current(),
      toggleMuted: () => setShowMuted((value) => !value),
    };
    useUnreadsPageStore.getState().setControls(controls);
    return () => useUnreadsPageStore.getState().setControls(null);
    // `select` is stable and the rest read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  // Keys start on the list, not wherever focus was before the page opened.
  useEffect(() => {
    if (!rootRef.current?.contains(document.activeElement)) listRef.current?.focus();
  }, []);

  // The page's keys, while focus is on the page or nowhere, as after the palette closes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element) || isTextEntry(target)) return;
      if (target !== document.body && !rootRef.current?.contains(target)) return;
      if (document.querySelector(OVERLAY_SELECTOR)) return;
      const key = event.key.toLowerCase();
      // A focused button answers Enter itself; elsewhere it opens the selected message.
      const commandId =
        key === "enter"
          ? target.closest("button, a")
            ? undefined
            : "workspace.unreads_open"
          : KEY_COMMANDS[key];
      if (!commandId) return;
      event.preventDefault();
      runDesktopLocalCommand(commandId);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const settledEmpty = !isPending && shown.length === 0 && failed.length === 0;
  const onlyMuted = settledEmpty && mutedCount > 0;
  const nothingAnywhere = settledEmpty && groups.length === 0;
  const nothingInFilter = settledEmpty && mutedCount === 0 && !nothingAnywhere;

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rim-line px-4">
        <h1 className="text-sm font-medium text-rim-text">Unreads</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-3.5 px-4 py-5 sm:px-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 flex-[1_1_16rem] text-sm text-rim-text-muted">
                Everything you haven&apos;t read. Looking at this page marks nothing read.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={shown.length === 0}
                onClick={markAllShown}
              >
                Mark all shown as read
              </Button>
            </div>
            {chips.length > 1 && (
              <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="Workspace">
                <Chip pressed={only === null} onClick={() => setFilter(null)}>
                  All workspaces
                </Chip>
                {chips.map((space) => (
                  <Chip
                    key={space.id}
                    pressed={only === space.id}
                    onClick={() => setFilter(space.id)}
                  >
                    {space.label}
                  </Chip>
                ))}
              </div>
            )}
          </header>

          {failed.map(({ space, retry }) => (
            <FailureCard key={space.id} text={`Couldn't load ${space.label}.`} onRetry={retry} />
          ))}

          <div
            ref={listRef}
            role="listbox"
            aria-label="Unread messages"
            aria-activedescendant={selectedRowId ?? undefined}
            tabIndex={0}
            className="space-y-3.5 focus-visible:outline-none"
          >
            {isPending && <p className="text-sm text-rim-text-muted">Loading…</p>}
            {nothingAnywhere && (
              <div className="rounded-xl border border-rim-line bg-rim-panel p-6 text-center">
                <p className="text-sm font-semibold text-rim-text">You&apos;ve read everything</p>
                <p className="mt-1 text-xs text-rim-text-muted">
                  New messages appear here until you mark them.
                </p>
              </div>
            )}
            {nothingInFilter && (
              <div className="rounded-xl border border-rim-line bg-rim-panel p-6 text-center">
                <p className="text-sm font-semibold text-rim-text">Nothing unread here</p>
                <p className="mt-1 text-xs text-rim-text-muted">
                  The other workspaces still have unread messages.
                </p>
              </div>
            )}
            {onlyMuted && (
              <div className="space-y-3 rounded-xl border border-rim-line bg-rim-panel p-6 text-center">
                <p className="text-sm font-semibold text-rim-text">
                  Nothing unread outside muted conversations.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowMuted(true)}
                >
                  {`Show muted (${mutedCount})`}
                </Button>
              </div>
            )}
            {shown.map((group) => (
              <UnreadGroupSection
                key={group.conversationId}
                group={group}
                selectedRowId={selectedRowId}
                onSelectRow={setSelectedRowId}
                started={queue.isStarted(group.conversationId)}
                onVisible={queue.request}
                onSettled={queue.settle}
                onNewest={onNewest}
                register={register}
                onMark={markOne}
              />
            ))}
          </div>

          {!isPending && !nothingAnywhere && (
            <div className="flex flex-wrap items-center gap-3">
              {mutedCount > 0 && !onlyMuted && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-pressed={showMuted}
                  onClick={() => setShowMuted((value) => !value)}
                >
                  {showMuted ? `Hide muted (${mutedCount})` : `Show muted (${mutedCount})`}
                </Button>
              )}
              <p className="min-w-0 flex-1 text-xs text-rim-text-muted">
                Replies in threads aren&apos;t here: they don&apos;t count as unread. Other
                workspaces update every minute.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-lg px-2.5 py-1 transition",
        pressed
          ? "bg-rim-panel-soft text-rim-text"
          : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
      )}
    >
      {children}
    </button>
  );
}
