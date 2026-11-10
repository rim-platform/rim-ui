/**
 * "Ask agent…": choosing the session, offering the read grant the session's agent lacks, and the
 * channel or message attached to the next prompt there. Also the channels RIM's tools refused a
 * session's agent for want of a grant, which the session offers to grant. Everything here is the
 * person's own act; nothing an agent sends reaches it but the ids of a refusal.
 */

import { create } from "zustand";

import { onVaultLock } from "../../../core/accountVault/accountVault";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { AgentSession } from "../acp/agentSession";
import type { AskSubject } from "../runtime/askContext";
import { listenForMissingGrants, type MissingGrant } from "../runtime/grantRefusals";
import { grantMayCover, withChannelGrant } from "../runtime/grants";
import { useAgentProgramsStore } from "./useAgentProgramsStore";
import {
  agentSessionOf,
  isLiveStatus,
  useRunningAgentSessionsStore,
} from "./useAgentSessionsStore";
import { useConnectedAgentsStore } from "./useConnectedAgentsStore";
import { useStartAgentSessionStore } from "./useStartAgentSessionStore";

/** A read grant for one channel, offered to the person for one agent. */
export interface GrantOffer {
  agentId: string;
  /** What the person calls the agent. */
  agentName: string;
  workspaceId: string;
  conversationId: string;
  /** The channel's name as RIM knows it, without the "#". */
  channelName: string;
}

/** A channel RIM's tools refused a session's agent for want of a grant. */
export interface RefusedChannel {
  workspaceId: string;
  conversationId: string;
}

interface AskAgentState {
  /** What the person is choosing a session for, or `null`. */
  choosing: AskSubject | null;
  /** The grant offered now, or `null`. */
  offer: GrantOffer | null;
  /** What each session's next prompt is about, by session key. */
  about: Record<string, AskSubject>;
  /** The refused channels each session offers to grant, by session key. */
  refused: Record<string, RefusedChannel[]>;
  /** The channels each session no longer offers, granted or dismissed, by session key. */
  settled: Record<string, string[]>;
}

const INITIAL: AskAgentState = {
  choosing: null,
  offer: null,
  about: {},
  refused: {},
  settled: {},
};

/** The ask flow and the refused channels, in memory only. */
export const useAskAgentStore = create<AskAgentState>(() => INITIAL);

/** Answers the grant offer open now. */
let answerOffer: ((granted: boolean) => void) | null = null;

function channelKey(channel: RefusedChannel): string {
  return `${channel.workspaceId}/${channel.conversationId}`;
}

/** Opens the session chooser for `subject`. */
export function askAgent(subject: AskSubject): void {
  useAskAgentStore.setState({ choosing: subject });
}

/** Closes the session chooser without asking. */
export function cancelAsk(): void {
  useAskAgentStore.setState({ choosing: null });
}

/** Asks in the running session `key`: the grant step, then the chip in its composer. */
export function askInSession(key: string): void {
  const subject = useAskAgentStore.getState().choosing;
  if (!subject) return;
  useAskAgentStore.setState({ choosing: null });
  void continueAsk(key, subject);
}

/** Opens the start dialog, and asks in the session it starts once that session is ready. */
export function askInNewSession(): void {
  const subject = useAskAgentStore.getState().choosing;
  if (!subject) return;
  useAskAgentStore.setState({ choosing: null });
  useStartAgentSessionStore.getState().showThen((key) => void continueAsk(key, subject));
}

/** Says what the next prompt of session `key` is about. */
export function setAbout(key: string, subject: AskSubject): void {
  useAskAgentStore.setState((state) => ({ about: { ...state.about, [key]: subject } }));
}

/** Drops what the next prompt of session `key` is about. */
export function removeAbout(key: string): void {
  useAskAgentStore.setState((state) => {
    const { [key]: _gone, ...about } = state.about;
    return { about };
  });
}

/**
 * Waits until the session takes prompts.
 *
 * @returns `false` when it ended or failed first.
 */
function untilOpen(session: AgentSession): Promise<boolean> {
  return new Promise((resolve) => {
    let stop: () => void = () => {};
    const check = () => {
      const { status } = session;
      if (status === "starting") return;
      stop();
      resolve(isLiveStatus(status));
    };
    stop = session.subscribe(check);
    check();
  });
}

async function continueAsk(key: string, subject: AskSubject): Promise<void> {
  const session = agentSessionOf(key);
  if (!session || !(await untilOpen(session))) return;
  const agent = sessionAgent(key);
  if (agent && !covers(agent.agentId, subject)) {
    await offerGrant({
      ...agent,
      workspaceId: subject.workspaceId,
      conversationId: subject.conversationId,
      channelName: subject.channelName,
    });
  }
  if (agentSessionOf(key) !== session) return;
  setAbout(key, subject);
  useRunningAgentSessionsStore.setState({ focusComposerKey: key });
  useShellStore.getState().setMainSurface({ kind: "agent-session", key });
}

/** The connected agent RIM made for the program of session `key`, with what the person calls it. */
function sessionAgent(key: string): { agentId: string; agentName: string } | null {
  const snapshot = agentSessionOf(key)?.getSnapshot();
  if (!snapshot) return null;
  const profile = useAgentProgramsStore
    .getState()
    .profiles.find((item) => item.id === snapshot.profileId);
  const connected = useConnectedAgentsStore
    .getState()
    .agents.some((agent) => agent.id === profile?.agentId);
  return profile && connected ? { agentId: profile.agentId, agentName: snapshot.name } : null;
}

/** Whether the agent's grants cover the channel now; it is known to be a plain channel. */
function covers(agentId: string, channel: RefusedChannel): boolean {
  const agent = useConnectedAgentsStore.getState().agents.find((item) => item.id === agentId);
  return grantMayCover(agent?.grants ?? {}, channel.workspaceId, channel.conversationId);
}

/**
 * Offers the grant and waits for the answer; an offer open before is answered Not now.
 *
 * @returns Whether the channel was granted.
 */
function offerGrant(offer: GrantOffer): Promise<boolean> {
  answerOffer?.(false);
  return new Promise((resolve) => {
    answerOffer = resolve;
    useAskAgentStore.setState({ offer });
  });
}

/**
 * Adds a read grant for exactly one channel to the agent's grants, through the same store
 * action as Settings > Agents.
 *
 * @returns Whether the agent is still connected, so the grant was added or already there.
 */
export function grantOneChannel(agentId: string, workspaceId: string, channelId: string): boolean {
  const store = useConnectedAgentsStore.getState();
  const agent = store.agents.find((item) => item.id === agentId);
  if (!agent) return false;
  const grants = agent.grants ?? {};
  const next = withChannelGrant(grants, workspaceId, channelId);
  if (next !== grants) store.setGrants(agentId, next);
  return true;
}

/**
 * Answers the grant offer open now: with `grant`, the offered channel and nothing else is
 * granted; without, nothing is.
 */
export function answerGrantOffer(grant: boolean): void {
  const { offer } = useAskAgentStore.getState();
  const resolve = answerOffer;
  answerOffer = null;
  useAskAgentStore.setState({ offer: null });
  if (!offer) return;
  const granted = grant && grantOneChannel(offer.agentId, offer.workspaceId, offer.conversationId);
  resolve?.(granted);
}

/** Stops offering the refused channel in session `key`. */
export function dismissRefusal(key: string, channel: RefusedChannel): void {
  const id = channelKey(channel);
  useAskAgentStore.setState((state) => ({
    refused: {
      ...state.refused,
      [key]: (state.refused[key] ?? []).filter((item) => channelKey(item) !== id),
    },
    settled: { ...state.settled, [key]: [...(state.settled[key] ?? []), id] },
  }));
}

/**
 * Offers the grant for a channel session `key`'s agent was refused, and stops offering it there
 * once granted.
 *
 * @param channelName - The channel's name as RIM knows it, without the "#".
 */
export function grantRefusedChannel(
  key: string,
  channel: RefusedChannel,
  channelName: string,
): void {
  const agent = sessionAgent(key);
  if (!agent) return;
  void offerGrant({ ...agent, ...channel, channelName }).then((granted) => {
    if (granted) dismissRefusal(key, channel);
  });
}

/** The live sessions whose program runs as `agentId`. */
function sessionsOf(agentId: string): string[] {
  const { profiles } = useAgentProgramsStore.getState();
  return Object.entries(useRunningAgentSessionsStore.getState().sessions)
    .filter(([, session]) => {
      if (!isLiveStatus(session.status)) return false;
      const { profileId } = session.getSnapshot();
      return profiles.find((profile) => profile.id === profileId)?.agentId === agentId;
    })
    .map(([key]) => key);
}

/** Whether session `key` has not offered the channel yet. */
function unoffered(key: string, channel: RefusedChannel): boolean {
  const id = channelKey(channel);
  const { refused, settled } = useAskAgentStore.getState();
  return (
    !(settled[key] ?? []).includes(id) &&
    !(refused[key] ?? []).some((item) => channelKey(item) === id)
  );
}

function refusedChannel({ workspaceId, conversationId }: MissingGrant): RefusedChannel {
  return { workspaceId, conversationId };
}

listenForMissingGrants({
  wants: (refusal) =>
    sessionsOf(refusal.agentId).some((key) => unoffered(key, refusedChannel(refusal))),
  hear: (refusal) => {
    const channel = refusedChannel(refusal);
    const keys = sessionsOf(refusal.agentId).filter((key) => unoffered(key, channel));
    if (keys.length === 0) return;
    useAskAgentStore.setState((state) => {
      const refused = { ...state.refused };
      for (const key of keys) refused[key] = [...(refused[key] ?? []), channel];
      return { refused };
    });
  },
});

/** Forgets everything here, answering an open offer Not now. */
export function resetAskAgent(): void {
  const resolve = answerOffer;
  answerOffer = null;
  useAskAgentStore.setState(INITIAL);
  resolve?.(false);
}

// What is asked belongs to the account signed in.
onVaultLock(resetAskAgent);
