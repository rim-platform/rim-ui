/**
 * The relay as the UI sees it: whether this server runs as a relay (`relayInfo`), the account
 * that uses it, the spaces this account uses on other servers, servers whose identity forked,
 * spaces whose events may be missing, and why a host refused a space's last renewal.
 */

import { create } from "zustand";

import type { SpaceRecord } from "./relayDb";

/** `relayInfo`: this server's id, its roles and its direct space. */
export interface RelayInfo {
  serverId: string;
  roles: string[];
  directSpaceId: string;
}

/** Who uses the relay from this app. */
export interface RelayAccount {
  /** The relay's GraphQL endpoint. */
  endpoint: string;
  userId: string;
  principalId: string;
  /** This device, when it holds a key for the account. */
  deviceId: string | null;
}

/** One answer of `renewDelegations`. */
export interface RenewalAnswer {
  workspaceId: string;
  status: string;
  reason?: string | null;
}

/** A space whose events may be missing after reconciling failed. */
export interface MissingNotice {
  spaceId: string;
  hostServerId: string;
  since: number;
}

interface RelayState {
  status: "pending" | "ready" | "off";
  setStatus: (status: "pending" | "ready" | "off") => void;
  info: RelayInfo | null;
  account: RelayAccount | null;
  /** Spaces on other servers, by space id. */
  spaces: Record<string, SpaceRecord>;
  /** Server ids whose key log forked: the app no longer uses them. */
  forked: string[];
  missing: Record<string, MissingNotice>;
  /** Where each pinned server was fetched from, by server id. */
  origins: Record<string, string>;
  /** Why the host refused each space's last renewal, by space id; absent once one succeeds. */
  refusals: Record<string, string | null>;
  setStarted: (info: RelayInfo, account: RelayAccount, spaces: SpaceRecord[]) => void;
  addSpace: (space: SpaceRecord) => void;
  markForked: (serverId: string) => void;
  setMissing: (notice: MissingNotice) => void;
  clearMissing: (spaceId: string) => void;
  /** Drops a space, with its missing notice and renewal refusal. */
  removeSpace: (spaceId: string) => void;
  setOrigin: (serverId: string, origin: string) => void;
  noteRenewals: (answers: RenewalAnswer[]) => void;
  reset: () => void;
}

export const useRelayStore = create<RelayState>((set) => ({
  status: "pending",
  setStatus: (status) => set({ status }),
  info: null,
  account: null,
  spaces: {},
  forked: [],
  missing: {},
  origins: {},
  refusals: {},
  setStarted: (info, account, spaces) =>
    set({
      status: "ready",
      info,
      account,
      spaces: Object.fromEntries(spaces.map((s) => [s.spaceId, s])),
    }),
  addSpace: (space) => set((s) => ({ spaces: { ...s.spaces, [space.spaceId]: space } })),
  markForked: (serverId) =>
    set((s) => (s.forked.includes(serverId) ? s : { forked: [...s.forked, serverId] })),
  setMissing: (notice) =>
    set((s) =>
      s.missing[notice.spaceId] ? s : { missing: { ...s.missing, [notice.spaceId]: notice } },
    ),
  clearMissing: (spaceId) =>
    set((s) => {
      if (!s.missing[spaceId]) return s;
      const missing = { ...s.missing };
      delete missing[spaceId];
      return { missing };
    }),
  removeSpace: (spaceId) =>
    set((s) => {
      const spaces = { ...s.spaces };
      const missing = { ...s.missing };
      const refusals = { ...s.refusals };
      delete spaces[spaceId];
      delete missing[spaceId];
      delete refusals[spaceId];
      return { spaces, missing, refusals };
    }),
  setOrigin: (serverId, origin) =>
    set((s) =>
      s.origins[serverId] === origin ? s : { origins: { ...s.origins, [serverId]: origin } },
    ),
  noteRenewals: (answers) =>
    set((s) => {
      const refusals = { ...s.refusals };
      for (const answer of answers) {
        if (answer.status === "active") delete refusals[answer.workspaceId];
        else refusals[answer.workspaceId] = answer.reason ?? null;
      }
      return { refusals };
    }),
  reset: () =>
    set({
      status: "pending",
      info: null,
      account: null,
      spaces: {},
      forked: [],
      missing: {},
      origins: {},
      refusals: {},
    }),
}));

/** Whether `spaceId` is a direct space: this relay's or one on another relay. */
export function isDirectSpace(spaceId: string | null | undefined): boolean {
  if (!spaceId) return false;
  const { info, spaces } = useRelayStore.getState();
  return info?.directSpaceId === spaceId || spaces[spaceId]?.kind === "direct";
}

/** Whether `spaceId` is a direct space, kept current as `relayInfo` and the spaces load. */
export function useIsDirectSpace(spaceId: string | null | undefined): boolean {
  return useRelayStore(
    (s) =>
      Boolean(spaceId) &&
      (s.info?.directSpaceId === spaceId || s.spaces[spaceId ?? ""]?.kind === "direct"),
  );
}

/** The host of a space on another server, or `null` for a space this relay hosts. */
export function hostOf(spaceId: string | null | undefined): string | null {
  if (!spaceId) return null;
  return useRelayStore.getState().spaces[spaceId]?.hostServerId ?? null;
}
