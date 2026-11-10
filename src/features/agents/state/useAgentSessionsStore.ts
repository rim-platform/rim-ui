import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { onVaultLock } from "../../../core/accountVault/accountVault";
import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";
import { logger } from "../../../core/logger";
import { resolveStoredPrograms } from "../acp/agentPrograms";
import {
  AgentSession,
  MODEL_CATEGORY,
  type AgentSessionDeps,
  type AgentSessionSnapshot,
  type AgentSessionStatus,
} from "../acp/agentSession";
import {
  dismissAgentSessionToast,
  isViewingAgentSession,
  notifyAgentSession,
} from "../runtime/agentSessionNotifications";
import { useAgentProgramsStore, type AgentProgramProfile } from "./useAgentProgramsStore";

/**
 * A session the person had with an agent program: what RIM keeps of it once it stops, so it can
 * be listed and opened again. Never any of its transcript.
 */
export interface RecentAgentSession {
  /** RIM's own key for the session. */
  key: string;
  profileId: string;
  /** What the person called the agent when the session ran. */
  agentName: string;
  /** The session's folder, a full path. */
  cwd: string;
  /** The agent's id for the session, which `session/load` takes. */
  acpSessionId: string;
  /** The agent's title for it, else the person's first prompt shortened, or `null` before either. */
  title: string | null;
  /** When it started, ISO 8601. */
  startedAt: string;
  /** When it last started or ended a turn, waited, or ended, ISO 8601. */
  lastActivityAt: string;
  /** Whether the agent offered to open earlier sessions again when this one ran. */
  canReopen: boolean;
}

/** The most sessions the recent list keeps. */
export const RECENT_SESSIONS_LIMIT = 20;

/** The longest title taken from the person's first prompt. */
export const PROMPT_TITLE_LENGTH = 80;

/** The longest title taken from the agent. */
const AGENT_TITLE_LENGTH = 120;

/** The statuses of a session whose program is still running. */
const LIVE_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "starting",
  "ready",
  "working",
  "waiting",
]);

/** Whether a session's program is still running. */
export function isLiveStatus(status: AgentSessionStatus): boolean {
  return LIVE_STATUSES.has(status);
}

/** `text` on one line, cut to `length` characters with an ellipsis when longer. */
export function shortenTitle(text: string, length: number = PROMPT_TITLE_LENGTH): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Brings a stored recent list up to the current shape, leaving out entries that lack what one
 * needs, and keeping at most {@link RECENT_SESSIONS_LIMIT}.
 *
 * @param persisted - What the storage held, of any version.
 * @returns The state with every entry in the current shape.
 */
export function migrateRecentSessions(persisted: unknown): { recent: RecentAgentSession[] } {
  const stored = (persisted as { recent?: unknown } | null | undefined)?.recent;
  if (!Array.isArray(stored)) return { recent: [] };
  const recent: RecentAgentSession[] = [];
  for (const item of stored as Partial<Record<keyof RecentAgentSession, unknown>>[]) {
    if (typeof item !== "object" || item === null) continue;
    const { key, profileId, agentName, cwd, acpSessionId, title, startedAt, lastActivityAt } = item;
    if (![key, profileId, agentName, cwd, acpSessionId, startedAt].every(isString)) continue;
    recent.push({
      key: key as string,
      profileId: profileId as string,
      agentName: agentName as string,
      cwd: cwd as string,
      acpSessionId: acpSessionId as string,
      title: isString(title) && title !== "" ? title : null,
      startedAt: startedAt as string,
      lastActivityAt: isString(lastActivityAt) ? lastActivityAt : (startedAt as string),
      canReopen: item.canReopen === true,
    });
  }
  return { recent: recent.slice(0, RECENT_SESSIONS_LIMIT) };
}

interface RecentSessionsState {
  /** The recent sessions, the latest activity first. */
  recent: RecentAgentSession[];
  /** Adds the entry, or changes the one with its key, and keeps the list within the limit. */
  upsert: (entry: RecentAgentSession) => void;
  /** Drops the entry with `key`. */
  remove: (key: string) => void;
}

/** The newest first, without the oldest past the limit that are not running now. */
function trimmed(recent: RecentAgentSession[]): RecentAgentSession[] {
  const sorted = [...recent].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  if (sorted.length <= RECENT_SESSIONS_LIMIT) return sorted;
  const running = useRunningAgentSessionsStore.getState().sessions;
  const kept: RecentAgentSession[] = [];
  let spare = sorted.length - RECENT_SESSIONS_LIMIT;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const entry = sorted[i];
    const live = running[entry.key];
    if (spare > 0 && !(live && isLiveStatus(live.status))) {
      spare--;
      continue;
    }
    kept.unshift(entry);
  }
  return kept;
}

/** The recent agent sessions for this account on this device, sealed under the account vault. */
export const useAgentSessionsStore = create<RecentSessionsState>()(
  persist(
    (set) => ({
      recent: [],
      upsert: (entry) =>
        set((state) => ({
          recent: trimmed([...state.recent.filter((item) => item.key !== entry.key), entry]),
        })),
      remove: (key) =>
        set((state) => ({ recent: state.recent.filter((item) => item.key !== key) })),
    }),
    {
      name: "rim-agent-sessions",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
      version: 0,
      partialize: (state) => ({ recent: state.recent }),
      migrate: (persisted) => migrateRecentSessions(persisted) as RecentSessionsState,
      merge: (persisted, current) => ({ ...current, ...migrateRecentSessions(persisted) }),
    },
  ),
);
registerSealedStore(useAgentSessionsStore);
// Hydrates at once as well, for when this module loads after the vault was unlocked.
void useAgentSessionsStore.persist.rehydrate();

interface RunningSessionsState {
  /** The sessions started since the app opened, by key, ended ones too; never stored. */
  sessions: Record<string, AgentSession>;
  /** The session whose Stop waits for the person to confirm it, or `null`. */
  stopConfirmKey: string | null;
  /** The session whose composer takes focus once it is ready, or `null`. */
  focusComposerKey: string | null;
  /**
   * The sessions that finished a turn or started waiting since the person last had their page
   * open, by key; never stored.
   */
  unseen: Record<string, true>;
}

/** The agent sessions in memory while the app runs, with their transcripts. */
export const useRunningAgentSessionsStore = create<RunningSessionsState>(() => ({
  sessions: {},
  stopConfirmKey: null,
  focusComposerKey: null,
  unseen: {},
}));

/** Marks the session with `key` as having something the person has not seen. */
function markUnseen(key: string): void {
  if (isViewingAgentSession(key)) return;
  if (useRunningAgentSessionsStore.getState().unseen[key]) return;
  useRunningAgentSessionsStore.setState((state) => ({ unseen: { ...state.unseen, [key]: true } }));
}

/**
 * Notes that the person has the page of the session with `key` open: it is no longer unseen, and
 * its toast goes away.
 */
export function markAgentSessionSeen(key: string): void {
  dismissAgentSessionToast(key);
  if (!useRunningAgentSessionsStore.getState().unseen[key]) return;
  useRunningAgentSessionsStore.setState((state) => {
    const { [key]: _seen, ...unseen } = state.unseen;
    return { unseen };
  });
}

/** What a session reaches outside itself; tests replace these. */
let sessionDeps: Partial<AgentSessionDeps> = {};

/** Replaces what new sessions reach outside themselves, for tests. */
export function setAgentSessionDepsForTests(deps: Partial<AgentSessionDeps>): void {
  sessionDeps = deps;
}

/** The title a session has now: the agent's, else the person's first prompt shortened. */
function titleOf(snapshot: AgentSessionSnapshot, before: string | null): string | null {
  if (snapshot.title !== null) return shortenTitle(snapshot.title, AGENT_TITLE_LENGTH);
  if (before !== null) return before;
  const first = snapshot.transcript.find((item) => item.kind === "user");
  return first?.kind === "user" && first.text.trim() !== "" ? shortenTitle(first.text) : null;
}

/** Whether the change from `before` to `after` is activity the recent list records. */
function isActivity(before: AgentSessionSnapshot, after: AgentSessionSnapshot): boolean {
  return before.status !== after.status;
}

/**
 * Follows a session: keeps its recent entry up to date once the agent opened it, and raises a
 * notification when it starts waiting for the person or a turn ends.
 */
function follow(key: string, session: AgentSession, startedAt: string): void {
  let before = session.getSnapshot();
  session.subscribe(() => {
    const after = session.getSnapshot();
    const previous = before;
    before = after;
    if (after.sessionId !== null && after.profileId !== null && after.cwd !== null) {
      const store = useAgentSessionsStore.getState();
      const entry = store.recent.find((item) => item.key === key);
      const title = titleOf(after, entry?.title ?? null);
      const changed =
        !entry ||
        entry.acpSessionId !== after.sessionId ||
        entry.title !== title ||
        isActivity(previous, after) ||
        (after.agent !== null && previous.agent === null);
      if (changed) {
        store.upsert({
          key,
          profileId: after.profileId,
          agentName: after.name,
          cwd: after.cwd,
          acpSessionId: after.sessionId,
          title,
          startedAt: entry?.startedAt ?? startedAt,
          lastActivityAt:
            entry && !isActivity(previous, after) ? entry.lastActivityAt : new Date().toISOString(),
          canReopen: after.agent?.agentCapabilities.loadSession ?? entry?.canReopen ?? false,
        });
      }
    }
    const title = useAgentSessionsStore.getState().recent.find((item) => item.key === key)?.title;
    if (previous.status !== "waiting" && after.status === "waiting") {
      markUnseen(key);
      notifyAgentSession({ kind: "waiting", key, agentName: after.name, title: title ?? null });
    } else if (
      (previous.status === "working" || previous.status === "waiting") &&
      after.status === "ready"
    ) {
      markUnseen(key);
      notifyAgentSession({ kind: "finished", key, agentName: after.name, title: title ?? null });
    }
  });
}

/** Puts `session` in memory under `key`, replacing an ended one there, and follows it. */
function hold(key: string, session: AgentSession, startedAt: string): void {
  useRunningAgentSessionsStore.setState((state) => ({
    sessions: { ...state.sessions, [key]: session },
  }));
  follow(key, session, startedAt);
}

/**
 * Starts `session`, first finding the full path of a stored profile that has none, so a session
 * started before Settings > Agents looked it up still starts the program that was allowed.
 */
async function begin(
  session: AgentSession,
  profile: AgentProgramProfile,
  cwd: string,
  reopen?: string,
): Promise<void> {
  let current = profile;
  if (current.resolvedProgram === null) {
    await resolveStoredPrograms().catch((error: unknown) => {
      logger.warn("[RIM:agents] could not look up the allowed agent programs", error);
    });
    current =
      useAgentProgramsStore.getState().profiles.find((item) => item.id === profile.id) ?? profile;
  }
  await session.start({ profile: current, cwd, reopen });
}

/**
 * Starts a session with `profile` in `cwd`.
 *
 * @returns The session's key, at once; the session reports its start in its own snapshot.
 */
export function startAgentSession(profile: AgentProgramProfile, cwd: string): string {
  const key = crypto.randomUUID();
  const session = new AgentSession(sessionDeps);
  hold(key, session, new Date().toISOString());
  useRunningAgentSessionsStore.setState({ focusComposerKey: key });
  void begin(session, profile, cwd);
  return key;
}

/** Why a recent session was not opened again. */
export type ReopenRefusal = "profile_gone" | "cannot_reopen" | "running" | "unknown";

/**
 * Opens a recent session again in a new run of its agent program, which replays it.
 *
 * @returns `null` once the new run is starting, or why it was not started.
 */
export function reopenAgentSession(key: string): ReopenRefusal | null {
  const entry = useAgentSessionsStore.getState().recent.find((item) => item.key === key);
  if (!entry) return "unknown";
  const current = useRunningAgentSessionsStore.getState().sessions[key];
  if (current && isLiveStatus(current.status)) return "running";
  if (!entry.canReopen) return "cannot_reopen";
  const profile = useAgentProgramsStore
    .getState()
    .profiles.find((candidate) => candidate.id === entry.profileId);
  if (!profile) return "profile_gone";
  const session = new AgentSession(sessionDeps);
  hold(key, session, entry.startedAt);
  useRunningAgentSessionsStore.setState({ focusComposerKey: key });
  void begin(session, profile, entry.cwd, entry.acpSessionId);
  return null;
}

/** Why a session was not started again after signing in. */
export type RetryRefusal = "profile_gone" | "unknown";

/**
 * Starts a session again in a new run of its agent program, in the same folder, after the
 * person signed in: the old run is stopped first, and the prompt the agent refused for want of
 * signing in is sent again once the new session is ready. It keeps its key, so its page stays
 * open.
 *
 * @returns `null` once the new run is starting, or why it was not started.
 */
export async function retryAgentSession(key: string): Promise<RetryRefusal | null> {
  const current = agentSessionOf(key);
  if (!current) return "unknown";
  const { profileId, cwd, retryPrompt } = current.getSnapshot();
  if (cwd === null) return "unknown";
  const profile = useAgentProgramsStore
    .getState()
    .profiles.find((candidate) => candidate.id === profileId);
  if (!profile) return "profile_gone";
  await current.stop().catch((error: unknown) => {
    logger.warn("[RIM:agents] could not stop an agent session", error);
  });
  const entry = useAgentSessionsStore.getState().recent.find((item) => item.key === key);
  const session = new AgentSession(sessionDeps);
  hold(key, session, entry?.startedAt ?? new Date().toISOString());
  useRunningAgentSessionsStore.setState({ focusComposerKey: key });
  void begin(session, profile, cwd).then(() => {
    if (retryPrompt === null || session.status !== "ready") return;
    session.prompt(retryPrompt.text, retryPrompt.context).catch((error: unknown) => {
      logger.warn("[RIM:agents] could not send the prompt again", error);
    });
  });
  return null;
}

/** The session in memory under `key`, if any. */
export function agentSessionOf(key: string): AgentSession | undefined {
  return useRunningAgentSessionsStore.getState().sessions[key];
}

/** Keeps `profileId`'s remembered model, which its next sessions switch to. */
function rememberModel(profileId: string | null, configId: string | null, value: string): void {
  if (profileId === null) return;
  const programs = useAgentProgramsStore.getState();
  if (!programs.profiles.some((profile) => profile.id === profileId)) return;
  programs.update(profileId, { preferredModel: { configId, value } });
}

/**
 * Sets one of the agent's config options in the session with `key`, as the person chose it in
 * the session's header. A model option is remembered for the agent program's next sessions.
 *
 * @returns Whether the agent took it; when it did not, the session says why.
 */
export async function chooseAgentSessionOption(
  key: string,
  configId: string,
  value: string,
): Promise<boolean> {
  const session = agentSessionOf(key);
  if (!session) return false;
  const { configOptions, profileId } = session.getSnapshot();
  const option = configOptions.find((item) => item.id === configId);
  const changed = await session.setConfigOption(configId, value);
  if (changed && option?.category === MODEL_CATEGORY) rememberModel(profileId, configId, value);
  return changed;
}

/**
 * Switches the session with `key` to a model of the agent's older model list, as the person
 * chose it, and remembers it for the agent program's next sessions.
 *
 * @returns Whether the agent took it; when it did not, the session says why.
 */
export async function chooseAgentSessionModel(key: string, modelId: string): Promise<boolean> {
  const session = agentSessionOf(key);
  if (!session) return false;
  const changed = await session.setModel(modelId);
  if (changed) rememberModel(session.getSnapshot().profileId, null, modelId);
  return changed;
}

/** Stops the session's program; nothing when it is not running. */
export async function stopAgentSession(key: string): Promise<void> {
  const { stopConfirmKey } = useRunningAgentSessionsStore.getState();
  if (stopConfirmKey === key) useRunningAgentSessionsStore.setState({ stopConfirmKey: null });
  await agentSessionOf(key)?.stop();
}

/**
 * Stops the session, or asks the person first while a turn is running.
 *
 * @returns Whether the session was running.
 */
export function requestStopAgentSession(key: string): boolean {
  const session = agentSessionOf(key);
  if (!session || !isLiveStatus(session.status)) return false;
  if (session.status === "working" || session.status === "waiting") {
    useRunningAgentSessionsStore.setState({ stopConfirmKey: key });
  } else {
    void stopAgentSession(key);
  }
  return true;
}

/** Forgets a session that is no longer running, with its transcript; its recent entry stays. */
export function dismissAgentSession(key: string): void {
  const session = agentSessionOf(key);
  if (!session || isLiveStatus(session.status)) return;
  useRunningAgentSessionsStore.setState((state) => {
    const { [key]: _gone, ...sessions } = state.sessions;
    const { [key]: _seen, ...unseen } = state.unseen;
    return { sessions, unseen };
  });
}

/** Drops a recent session from the list, and its transcript when it is not running. */
export function removeRecentAgentSession(key: string): void {
  dismissAgentSession(key);
  useAgentSessionsStore.getState().remove(key);
}

/** Stops every running session and forgets them all. */
export async function stopAllAgentSessions(): Promise<void> {
  const sessions = Object.values(useRunningAgentSessionsStore.getState().sessions);
  useRunningAgentSessionsStore.setState({
    sessions: {},
    stopConfirmKey: null,
    focusComposerKey: null,
    unseen: {},
  });
  await Promise.all(
    sessions.map((session) =>
      session.stop().catch((error: unknown) => {
        logger.warn("[RIM:agents] could not stop an agent session", error);
      }),
    ),
  );
}

// The sessions belong to the account signed in: they stop when it signs out or another signs in.
onVaultLock(() => {
  void stopAllAgentSessions();
});
