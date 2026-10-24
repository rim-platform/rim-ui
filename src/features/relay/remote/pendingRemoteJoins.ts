/**
 * Join requests this account filed at other servers through a workspace's public link, kept in
 * this browser per account until the decision arrives or the request expires. The relay item
 * that carries the decision is let through, and handled, only while its request is kept here.
 */

import { useSyncExternalStore } from "react";

import { accountKey } from "../state/spaces";
import { useRelayStore } from "../state/useRelayStore";

/** A join request filed at `hostServerId` for `workspaceId`, waiting for its moderators. */
export interface PendingRemoteJoin {
  hostServerId: string;
  hostOrigin: string;
  workspaceId: string;
  /** The workspace's name, as its link named it; null when the host did not say. */
  workspaceName: string | null;
  joinRequestId: string;
  /** When the request expires unless it is decided first, in milliseconds. */
  expiresAt: number;
}

const listeners = new Set<() => void>();
/** Counts the changes made in this run, so a component re-reads the list after each. */
let version = 0;

function storageKey(account: string): string {
  return `rim:remote-join-requests:${account}`;
}

function isEntry(value: unknown): value is PendingRemoteJoin {
  const entry = value as Partial<PendingRemoteJoin> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.hostServerId === "string" &&
    typeof entry.hostOrigin === "string" &&
    typeof entry.workspaceId === "string" &&
    (typeof entry.workspaceName === "string" || entry.workspaceName === null) &&
    typeof entry.joinRequestId === "string" &&
    typeof entry.expiresAt === "number"
  );
}

function read(account: string): PendingRemoteJoin[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(account)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function write(account: string, entries: PendingRemoteJoin[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(storageKey(account));
    else localStorage.setItem(storageKey(account), JSON.stringify(entries));
  } catch {
    // Without storage the request is not kept, and its decision is not taken here.
  }
}

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function sameJoin(entry: PendingRemoteJoin, host: string, workspaceId: string): boolean {
  return entry.hostServerId === host && entry.workspaceId === workspaceId;
}

/**
 * The signed-in account's pending requests at other servers, without those that expired, which
 * are dropped from storage.
 *
 * @param now - The time to compare expiries with, in milliseconds.
 * @returns The requests, oldest first; none without a signed-in account.
 */
export function listPendingRemoteJoins(now: number = Date.now()): PendingRemoteJoin[] {
  const account = accountKey();
  if (!account) return [];
  const entries = read(account);
  const live = entries.filter((entry) => entry.expiresAt > now);
  if (live.length !== entries.length) write(account, live);
  return live;
}

/**
 * Keep a request just filed, replacing an earlier one for the same workspace on the same server.
 *
 * @param entry - The request, as the host answered it.
 */
export function addPendingRemoteJoin(entry: PendingRemoteJoin): void {
  const account = accountKey();
  if (!account) return;
  const others = listPendingRemoteJoins().filter(
    (e) => !sameJoin(e, entry.hostServerId, entry.workspaceId),
  );
  write(account, [...others, entry]);
  changed();
}

/**
 * The pending request for `workspaceId` on `host`.
 *
 * @returns The request, or null when none is kept or it expired.
 */
export function pendingRemoteJoinAt(host: string, workspaceId: string): PendingRemoteJoin | null {
  return listPendingRemoteJoins().find((entry) => sameJoin(entry, host, workspaceId)) ?? null;
}

/** Forget the request for `workspaceId` on `host`, once decided. */
export function removePendingRemoteJoin(host: string, workspaceId: string): void {
  const account = accountKey();
  if (!account) return;
  const entries = listPendingRemoteJoins();
  const rest = entries.filter((entry) => !sameJoin(entry, host, workspaceId));
  if (rest.length === entries.length) return;
  write(account, rest);
  changed();
}

/**
 * Forget every pending request of `account`, an account removed from this device.
 *
 * @param account - The account's key, `endpoint|principalId`.
 */
export function forgetPendingRemoteJoins(account: string): void {
  write(account, []);
  changed();
}

/**
 * Be told when a request is kept or forgotten.
 *
 * @returns A function that stops telling `listener`.
 */
export function subscribePendingRemoteJoins(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The signed-in account's pending requests at other servers, read again whenever one is kept or
 * forgotten, or the account changes.
 */
export function usePendingRemoteJoins(): PendingRemoteJoin[] {
  useRelayStore((s) => s.account);
  useSyncExternalStore(subscribePendingRemoteJoins, () => version);
  return listPendingRemoteJoins();
}
