/**
 * The desktop notifications of agent sessions: when one starts waiting for the person, or a turn
 * ends, while the person is not at the RIM window. They name the agent and the session's title,
 * never anything from the transcript, and follow the device's notification settings and the open
 * workspace's pause and quiet hours.
 */

import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { detectPlatform } from "../../../core/runtime/runtime";
import { windowHasFocus } from "../../../shared/utils/windowFocus";
import type { NotificationSettingsData } from "../../notifications/api/useNotificationSettings";
import { isPauseActive, toTimeInput } from "../../notifications/rules";
import { showDesktopNotification } from "../../notifications/runtime/desktopNotification";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** What a session notification is about. */
export interface AgentSessionNotice {
  kind: "waiting" | "finished";
  /** The session's key, which a click on the notification opens. */
  key: string;
  agentName: string;
  /** The session's title, or `null` when it has none yet. */
  title: string | null;
}

/** The notification's title and body. */
export function formatAgentSessionNotice(notice: AgentSessionNotice): {
  title: string;
  body: string;
} {
  return {
    title:
      notice.kind === "waiting"
        ? `${notice.agentName} is waiting for you`
        : `${notice.agentName} finished`,
    body: notice.title ?? "Agent session",
  };
}

/** The minutes since midnight of `now` in `timeZone`, or `null` when the zone is unknown. */
function minutesIn(timeZone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

/** `"HH:MM"` as minutes since midnight, or `null`. */
function minutesOf(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(toTimeInput(value));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Whether `now` is inside the daily quiet hours, which may run past midnight.
 *
 * @param dnd - The quiet hours, or `null` when there are none.
 */
export function inQuietHours(
  dnd: NotificationSettingsData["dnd"],
  now: Date = new Date(),
): boolean {
  if (!dnd) return false;
  const start = minutesOf(dnd.start);
  const end = minutesOf(dnd.end);
  const at = minutesIn(dnd.timezone, now);
  if (start === null || end === null || at === null || start === end) return false;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/**
 * Whether session notifications are held back now: notifications are off on this device, or the
 * open workspace is paused or in its quiet hours.
 */
export function agentNoticesQuiet(now: Date = new Date()): boolean {
  if (!useNotificationSettingsStore.getState().enabled) return true;
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return false;
  const settings = queryClient.getQueryData<NotificationSettingsData>(
    queryKeys.notificationSettings(workspaceId),
  );
  if (!settings) return false;
  return isPauseActive(settings, now.getTime()) || inQuietHours(settings.dnd, now);
}

/** Raises the notification, unless the person is at the window or notifications are held back. */
export function notifyAgentSession(notice: AgentSessionNotice): void {
  if (detectPlatform() !== "desktop" || typeof document === "undefined") return;
  if (windowHasFocus() || agentNoticesQuiet()) return;
  const { title, body } = formatAgentSessionNotice(notice);
  showDesktopNotification({
    title,
    body,
    sound: useNotificationSettingsStore.getState().soundEnabled,
    extra: { rimAgentSession: { key: notice.key } },
  }).catch((error: unknown) => {
    logger.debug("[RIM:agents] session notification unavailable", error);
  });
}
