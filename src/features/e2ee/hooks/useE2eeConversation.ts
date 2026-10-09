/**
 * A conversation's encryption as the UI shows it: whether it is encrypted, this device's
 * group state, the names behind principals and devices, the upgrade of an existing DM or group
 * once every member is ready, and whether sending is stopped.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { detectPlatform } from "../../../core/runtime/runtime";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useConversation } from "../../conversations/api/useConversation";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { fetchPrincipalDevices } from "../api/e2eeApi";
import type { GroupView } from "../api/e2eeCommands";
import { refreshGroups } from "../runtime/groups";
import { syncMembership } from "../runtime/membership";
import { e2eeSession } from "../runtime/session";
import { upgradeIfReady } from "../runtime/upgrade";
import { useE2eeStore } from "../state/useE2eeStore";

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

/** Device names of principals, for "<name>'s <device>". */
export function useDeviceNames(principalIds: string[]) {
  const key = [...new Set(principalIds)].sort();
  const { data } = useQuery({
    queryKey: ["principalDevices", ...key],
    enabled: key.length > 0 && detectPlatform() === "desktop",
    staleTime: 5 * 60_000,
    queryFn: () => fetchPrincipalDevices(key),
  });
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const p of data ?? []) for (const d of p.devices) names.set(d.deviceId, d.name);
    return (deviceId: string | null | undefined) => (deviceId && names.get(deviceId)) || "device";
  }, [data]);
}

/** Whether the conversation is end-to-end encrypted and this is the desktop app. */
export function useEncryptedOnDesktop(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
): boolean {
  const { data: conversation } = useConversation(workspaceId, conversationId);
  return Boolean(conversation?.encryptedAt) && detectPlatform() === "desktop";
}

/** Why this device cannot send in an encrypted conversation, if it cannot. */
export type SendBlock = "web" | "unverified" | "awaitingReadd" | "removed" | null;

function sendBlockOf(
  encryptedAt: string | null,
  desktop: boolean,
  group: GroupView | undefined,
): SendBlock {
  if (!encryptedAt) return null;
  if (!desktop) return "web";
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
  const desktop = detectPlatform() === "desktop";
  const group = useE2eeStore((s) => (conversationId ? s.groups[conversationId] : undefined));
  const notReady = useE2eeStore((s) => (conversationId ? s.notReady[conversationId] : undefined));
  const encryptedAt = conversation?.encryptedAt ?? null;
  const conversationType = conversation?.conversationType;

  // An encrypted conversation this device holds no group for: its group may not exist yet (the
  // creator crashed), or wait for changes this device should commit.
  useEffect(() => {
    if (!desktop || !workspaceId || !conversationId || !userId) return;
    void e2eeSession().then(async (session) => {
      if (!session) return;
      const [local] = await refreshGroups(session, workspaceId, [conversationId]).catch(() => []);
      if (encryptedAt && !local?.hasGroup) {
        await syncMembership(session, workspaceId, conversationId).catch((err: unknown) =>
          logger.warn("[RIM:e2ee] membership sync failed:", err),
        );
      }
    });
  }, [desktop, workspaceId, conversationId, userId, encryptedAt]);

  // An existing DM or group is upgraded by an eligible member's desktop once every member is
  // ready; until then the conversation says who is not.
  const memberIds = conversation?.memberIds;
  const createdBy = conversation?.createdBy ?? null;
  useEffect(() => {
    if (!desktop || !workspaceId || !conversationId || !userId || !memberIds) return;
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
      await upgradeIfReady(session, workspaceId, candidate, (names) => {
        if (cancelled) return false;
        useE2eeStore.getState().setNotReady(conversationId, names);
        return true;
      });
    })().catch((err: unknown) => logger.warn("[RIM:e2ee] upgrade check failed:", err));
    return () => {
      cancelled = true;
    };
  }, [
    desktop,
    workspaceId,
    conversationId,
    userId,
    encryptedAt,
    conversationType,
    memberIds,
    createdBy,
  ]);

  return {
    encryptedAt,
    encrypted: Boolean(encryptedAt),
    conversationType,
    desktop,
    group,
    notReady: !encryptedAt && isEncryptable(conversationType) ? (notReady ?? []) : [],
    sendBlock: sendBlockOf(encryptedAt, desktop, group),
  };
}
