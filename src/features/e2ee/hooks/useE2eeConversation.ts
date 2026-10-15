/**
 * A conversation's encryption as the UI shows it: whether it is encrypted (the server says so,
 * or this device pinned it), this device's group state, the names behind principals and
 * devices, the upgrade of an existing DM or group once every member is ready (by a desktop; a
 * browser never upgrades), and whether sending is stopped.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { detectPlatform } from "../../../core/runtime/runtime";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useConversation } from "../../conversations/api/useConversation";
import { useOfferKeySetup } from "../../key-identity";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { fetchPrincipalDevices } from "../api/e2eeApi";
import type { GroupView } from "../api/e2eeCommands";
import { refreshGroups } from "../runtime/groups";
import { syncMembership } from "../runtime/membership";
import { foreignPrincipals, pinConversation } from "../runtime/pins";
import { e2eeSession } from "../runtime/session";
import { upgradeIfReady } from "../runtime/upgrade";
import { useE2eeStore, type WebEncryption } from "../state/useE2eeStore";

export function isEncryptable(conversationType: string | undefined): boolean {
  return (
    conversationType === ConversationTypeEnum.DIRECT ||
    conversationType === ConversationTypeEnum.GROUP
  );
}

/** Principal id to user id and display name, from the workspace's members. */
export function usePrincipalNames(workspaceId: string | null | undefined) {
  const { data: members } = useServerMembers(workspaceId ?? undefined);
  return useMemo(() => {
    const users = new Map<string, string>();
    const names = new Map<string, string>();
    for (const m of members ?? []) {
      if (!m.principalId) continue;
      users.set(m.principalId, m.userId);
      names.set(m.principalId, m.displayName || m.username);
    }
    return {
      userOf: (principalId: string) => users.get(principalId),
      nameOf: (principalId: string | null | undefined) =>
        (principalId && names.get(principalId)) || "Someone",
      principalOf: (userId: string) =>
        members?.find((m) => m.userId === userId)?.principalId ?? null,
    };
  }, [members]);
}

/**
 * Whether this device runs encrypted conversations: the desktop app, or the web app in a browser
 * set up as a linked device (`desktop` for the former, else the browser's state).
 */
export function useEncryptionSupport(): "desktop" | WebEncryption {
  const web = useE2eeStore((s) => s.webEncryption);
  return detectPlatform() === "desktop" ? "desktop" : web;
}

/**
 * Whether this device can take part in encrypted conversations: the desktop app holding its key,
 * or a browser set up as a linked device.
 */
export function useDeviceReadyForEncryption(): boolean {
  const support = useEncryptionSupport();
  const needsKeySetup = useOfferKeySetup().available;
  return support === "ready" || (support === "desktop" && !needsKeySetup);
}

/** Device names of principals, for "<name>'s <device>". */
export function useDeviceNames(principalIds: string[]) {
  const key = [...new Set(principalIds)].sort();
  const support = useEncryptionSupport();
  const { data } = useQuery({
    queryKey: ["principalDevices", ...key],
    enabled: key.length > 0 && (support === "desktop" || support === "ready"),
    staleTime: 5 * 60_000,
    queryFn: () => fetchPrincipalDevices(key),
  });
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const p of data ?? []) for (const d of p.devices) names.set(d.deviceId, d.name);
    return (deviceId: string | null | undefined) => (deviceId && names.get(deviceId)) || "device";
  }, [data]);
}

/** The marker time of a conversation pinned as encrypted before its `encryptedAt` was seen. */
const PINNED_WITHOUT_TIME = "1970-01-01T00:00:00Z";

/**
 * When the conversation became encrypted: the server's `encryptedAt`, or, for a conversation
 * this device pinned as encrypted, the time it pinned, whatever the server answers now.
 */
function effectiveEncryptedAt(
  serverEncryptedAt: string | null | undefined,
  group: GroupView | undefined,
): string | null {
  if (serverEncryptedAt) return serverEncryptedAt;
  if (!group?.pinned) return null;
  return group.pinnedEncryptedAt ?? PINNED_WITHOUT_TIME;
}

/** Whether the conversation is end-to-end encrypted and this device can read it. */
export function useEncryptedHere(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
): boolean {
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const group = useE2eeStore((s) => (conversationId ? s.groups[conversationId] : undefined));
  const support = useEncryptionSupport();
  return (
    Boolean(effectiveEncryptedAt(conversation?.encryptedAt, group)) &&
    (support === "desktop" || support === "ready")
  );
}

/** Why a DM or group is not end-to-end encrypted, as far as this device knows. */
export interface PlaintextStatus {
  /** Display names of members without a device set up for encryption. */
  notReady: string[];
  /** Everyone is ready, and a member's desktop app turns encryption on; a browser does not. */
  upgradeOnDesktop: boolean;
  /** This device has no key of its own for the account. */
  noDeviceKey: boolean;
}

/**
 * Whether a DM or group is not end-to-end encrypted, and why, from what this device has already
 * loaded. `null` for a channel, an encrypted conversation, a desktop app with every member
 * ready (it turns encryption on itself), and while the conversation, this device's support or
 * the readiness of the members is still unknown. Only reads: `useE2eeConversation` checks the
 * readiness.
 */
export function usePlaintextStatus(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
): PlaintextStatus | null {
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const group = useE2eeStore((s) => (conversationId ? s.groups[conversationId] : undefined));
  const notReady = useE2eeStore((s) => (conversationId ? s.notReady[conversationId] : undefined));
  const support = useEncryptionSupport();
  // A desktop without a key never checks the readiness: its key setup step is what it lacks.
  const desktopKeySetup = useOfferKeySetup().available && support === "desktop";
  const conversationType = conversation?.conversationType;
  const serverEncryptedAt = conversation?.encryptedAt;
  return useMemo(() => {
    if (!conversationType || !isEncryptable(conversationType)) return null;
    if (effectiveEncryptedAt(serverEncryptedAt, group) || support === "checking") return null;
    if (desktopKeySetup) {
      return { notReady: notReady ?? [], upgradeOnDesktop: false, noDeviceKey: true };
    }
    if (support === "desktop" || support === "ready") {
      // Unknown until the readiness check answers; with everyone ready a desktop upgrades.
      if (!notReady || (notReady.length === 0 && support === "desktop")) return null;
      return { notReady, upgradeOnDesktop: notReady.length === 0, noDeviceKey: false };
    }
    return {
      notReady: notReady ?? [],
      upgradeOnDesktop: false,
      noDeviceKey: support === "noDeviceKey",
    };
  }, [conversationType, serverEncryptedAt, group, notReady, support, desktopKeySetup]);
}

/**
 * Why this device cannot send in an encrypted conversation, if it cannot: a browser that is not
 * set up for it (`noDeviceKey`, `otherTab`, `unsupported`, or still `checking`), a server that
 * stopped saying the conversation is encrypted (`encryptionReset`), a principal the server put
 * in a direct message besides its two (`foreignMember`), a device that does not verify, a wait
 * for a re-add, a removal.
 */
export type SendBlock =
  | Exclude<WebEncryption, "ready">
  | "encryptionReset"
  | "foreignMember"
  | "unverified"
  | "awaitingReadd"
  | "removed"
  | null;

function sendBlockOf(
  serverEncryptedAt: string | null,
  support: "desktop" | WebEncryption,
  group: GroupView | undefined,
  foreign: string[],
): SendBlock {
  if (!serverEncryptedAt && !group?.pinned) return null;
  if (support !== "desktop" && support !== "ready") return support;
  if (!serverEncryptedAt) return "encryptionReset";
  if (foreign.length > 0) return "foreignMember";
  if (!group) return null;
  if (group.unverified.length > 0) return "unverified";
  if (group.readdRequestedAt !== null || group.awaitingReadd !== null) return "awaitingReadd";
  if (group.removed) return "removed";
  return null;
}

export function useE2eeConversation(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
) {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const support = useEncryptionSupport();
  const desktop = support === "desktop";
  const ready = desktop || support === "ready";
  const group = useE2eeStore((s) => (conversationId ? s.groups[conversationId] : undefined));
  const notReady = useE2eeStore((s) => (conversationId ? s.notReady[conversationId] : undefined));
  const refusedAdds = useE2eeStore((s) =>
    conversationId ? s.refusedAdds[conversationId] : undefined,
  );
  const { data: serverMembers } = useServerMembers(workspaceId ?? undefined);
  const serverEncryptedAt = conversation?.encryptedAt ?? null;
  const encryptedAt = effectiveEncryptedAt(serverEncryptedAt, group);
  const conversationType = conversation?.conversationType;
  const memberIds = conversation?.memberIds;
  const createdBy = conversation?.createdBy ?? null;

  // An encrypted conversation is pinned as such, with a direct message's two principals; one
  // this device holds no group for may have no group yet (the creator crashed), or wait for
  // changes this device should commit.
  useEffect(() => {
    if (!ready || !workspaceId || !conversationId || !userId) return;
    void e2eeSession().then(async (session) => {
      if (!session) return;
      const [local] = await refreshGroups(session, workspaceId, [conversationId]).catch(() => []);
      if ((serverEncryptedAt || local?.pinned) && conversationType && memberIds) {
        await pinConversation(session, workspaceId, {
          id: conversationId,
          conversationType: conversationType as ConversationTypeEnum,
          memberIds,
          encryptedAt: serverEncryptedAt,
        }).catch((err: unknown) => logger.warn("[RIM:e2ee] pinning failed:", err));
      }
      if (serverEncryptedAt && !local?.hasGroup) {
        await syncMembership(session, workspaceId, conversationId).catch((err: unknown) =>
          logger.warn("[RIM:e2ee] membership sync failed:", err),
        );
      }
    });
  }, [ready, workspaceId, conversationId, userId, serverEncryptedAt, conversationType, memberIds]);

  // An existing DM or group is upgraded by an eligible member's desktop once every member is
  // ready; until then the conversation says who is not. A browser only says so.
  useEffect(() => {
    if (!ready || !workspaceId || !conversationId || !userId || !memberIds) return;
    if (encryptedAt || !isEncryptable(conversationType)) return;
    let cancelled = false;
    void (async () => {
      const session = await e2eeSession();
      if (!session || cancelled) return;
      const candidate = {
        id: conversationId,
        conversationType: conversationType ?? "",
        memberIds,
        createdBy,
        encryptedAt,
      };
      // A browser records who is not ready but leaves the upgrade to a desktop.
      await upgradeIfReady(session, workspaceId, candidate, (names) => {
        if (cancelled) return false;
        useE2eeStore.getState().setNotReady(conversationId, names);
        return desktop;
      });
    })().catch((err: unknown) => logger.warn("[RIM:e2ee] upgrade check failed:", err));
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    desktop,
    workspaceId,
    conversationId,
    userId,
    encryptedAt,
    conversationType,
    memberIds,
    createdBy,
  ]);

  // In a pinned direct message: whoever the server lists besides its two principals, as members
  // or as pending adds the membership sync refused.
  const foreign = useMemo(() => {
    const dm = conversationType === ConversationTypeEnum.DIRECT ? group?.dmPrincipals : null;
    if (!dm) return [];
    const members = serverMembers ?? [];
    const names = new Map<string, string>();
    for (const userId of memberIds ?? []) {
      const member = members.find((m) => m.userId === userId);
      if (member?.principalId && dm.includes(member.principalId)) continue;
      names.set(userId, member?.displayName || member?.username || "someone");
    }
    for (const principalId of foreignPrincipals(dm, refusedAdds ?? [])) {
      const member = members.find((m) => m.principalId === principalId);
      names.set(
        member?.userId ?? principalId,
        member?.displayName || member?.username || "someone",
      );
    }
    return [...names.values()];
  }, [conversationType, group?.dmPrincipals, serverMembers, memberIds, refusedAdds]);

  const upgradable = !encryptedAt && isEncryptable(conversationType);
  return {
    encryptedAt,
    encrypted: Boolean(encryptedAt),
    conversationType,
    desktop,
    group,
    notReady: upgradable ? (notReady ?? []) : [],
    /** Everyone is ready, but this browser does not upgrade conversations: a desktop does. */
    upgradeOnDesktop: upgradable && !desktop && notReady?.length === 0,
    /** Display names of whoever the server put in this direct message besides its two members. */
    foreignMembers: foreign,
    sendBlock: sendBlockOf(serverEncryptedAt, support, group, foreign),
  };
}
