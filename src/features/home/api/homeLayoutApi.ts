import { onlineManager } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { isServerUnreachable } from "../../messages/api/messageCache";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useConnectionStore } from "../../system/state/useConnectionStore";
import { HOME_LAYOUT, serverHasCapability } from "../../updater/api/serverCapabilities";
import { parseLayout, removeBox, sameLayout, type HomeLayoutDoc } from "../layout/homeLayout";
import { useHomeLayoutStore, type DatedLayout } from "../state/useHomeLayoutStore";

const HOME_LAYOUT_QUERY = gql`
  query HomeLayout {
    homeLayout {
      layout
      editedAt
    }
  }
`;

const SAVE_HOME_LAYOUT = gql`
  mutation SaveHomeLayout($layout: JSON!, $editedAt: DateTime!) {
    saveHomeLayout(layout: $layout, editedAt: $editedAt) {
      kept
      layout {
        layout
        editedAt
      }
    }
  }
`;

const RESET_HOME_LAYOUT = gql`
  mutation ResetHomeLayout {
    resetHomeLayout
  }
`;

interface StoredLayout {
  layout: unknown;
  editedAt: string;
}

/** A stored layout as this app reads it; `null` for one it cannot read, which Home replaces with the default. */
function dated(stored: StoredLayout | null): DatedLayout | null {
  if (!stored) return null;
  const layout = parseLayout(stored.layout);
  return layout ? { layout, editedAt: stored.editedAt } : null;
}

/** Whether ISO time `a` is later than `b`. */
function later(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

/** The account's Home layout as the server holds it, or `null` when it holds none. */
export async function fetchHomeLayout(): Promise<DatedLayout | null> {
  const res = await graphqlClient.request<{ homeLayout: StoredLayout | null }>(HOME_LAYOUT_QUERY);
  return dated(res.homeLayout);
}

/**
 * Takes what the server answered as this device's copy. While an edit waits to be sent, that
 * edit's answer decides instead. An answer older than the copy is a read that started before
 * this device's last save and is left out. A layout that differs from the copy raises the
 * notice that it changed on another device.
 */
export function takeFetchedLayout(fetched: DatedLayout | null): void {
  const store = useHomeLayoutStore.getState();
  if (store.pending) return;
  const copy = store.copy;
  if (fetched && copy && !later(fetched.editedAt, copy.editedAt)) return;
  if (copy && (!fetched || !sameLayout(fetched.layout, copy.layout))) {
    store.setChangedElsewhere(true);
  }
  store.setCopy(fetched);
}

let flushing: Promise<void> | null = null;

async function sendPending(): Promise<void> {
  const pending = useHomeLayoutStore.getState().pending;
  if (!pending || !(await serverHasCapability(HOME_LAYOUT))) return;
  try {
    const res = await graphqlClient.request<{
      saveHomeLayout: { kept: boolean; layout: StoredLayout };
    }>(SAVE_HOME_LAYOUT, { layout: pending.layout, editedAt: pending.editedAt });
    const store = useHomeLayoutStore.getState();
    if (store.pending === pending) store.setPending(null);
    store.setCopy(dated(res.saveHomeLayout.layout));
    if (!res.saveHomeLayout.kept) store.setChangedElsewhere(true);
  } catch (err) {
    if (isServerUnreachable(err)) return;
    const store = useHomeLayoutStore.getState();
    if (store.pending === pending) store.setPending(null);
    // Only the server's message: the error itself carries the request, layout included.
    const message = graphqlErrorMessage(err, "Try again.");
    logger.warn("[RIM:home] the Home layout was not saved:", message);
    toast.error(`Your Home layout wasn't saved: ${message}`);
  }
}

/**
 * Sends the edit waiting on this device, if any, to a server that keeps Home layouts. An edit
 * the server cannot be reached for keeps waiting; one it refuses is dropped and said so. Calls
 * made while one is under way wait for it and then send whatever is still waiting.
 */
export async function flushPendingHomeLayout(): Promise<void> {
  while (flushing) await flushing;
  if (!useHomeLayoutStore.getState().pending) return;
  flushing = sendPending().finally(() => {
    flushing = null;
  });
  await flushing;
}

/**
 * Keeps `layout`, made now, as the edit to send, and sends it.
 *
 * @param editedAt - When the person finished the edit, an ISO time.
 */
export function saveHomeLayout(layout: HomeLayoutDoc, editedAt: string): Promise<void> {
  useHomeLayoutStore.getState().setPending({ layout, editedAt });
  return flushPendingHomeLayout();
}

/**
 * Removes the box `id` from the account's layout and saves it, as Remove in Edit Home would. A
 * box is only ever in a layout this device holds, so there is nothing to do without one.
 */
export function removeBoxEverywhere(id: string): Promise<void> {
  const { pending, copy } = useHomeLayoutStore.getState();
  const layout = (pending ?? copy)?.layout;
  if (!layout || !layout.boxes.some((box) => box.id === id)) return Promise.resolve();
  return saveHomeLayout(removeBox(layout, id), new Date().toISOString());
}

/**
 * Deletes the account's layout on the server, so every device shows the default, and drops this
 * device's copy and waiting edit.
 *
 * @throws The server's refusal, or the failure to reach it.
 */
export async function resetHomeLayout(): Promise<void> {
  await graphqlClient.request<{ resetHomeLayout: boolean }>(RESET_HOME_LAYOUT);
  const store = useHomeLayoutStore.getState();
  store.setPending(null);
  store.setCopy(null);
}

// An edit waiting for the server is sent as soon as the server answers again.
useConnectionStore.subscribe((state, prev) => {
  if (state.status === "connected" && prev.status !== "connected") {
    void flushPendingHomeLayout();
  }
});
useOfflineStore.subscribe((state, prev) => {
  if (prev.offline && !state.offline) void flushPendingHomeLayout();
});
onlineManager.subscribe((online) => {
  if (online) void flushPendingHomeLayout();
});
