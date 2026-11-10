/**
 * Where RIM's tools tell the app that an agent was refused a channel for want of a grant, so an
 * agent session the person has open can offer that grant. A refusal carries ids only, never
 * anything read from the channel.
 */

/** An agent asked for a channel its grants do not cover. */
export interface MissingGrant {
  agentId: string;
  workspaceId: string;
  conversationId: string;
}

/** What hears of such refusals. */
export interface MissingGrantListener {
  /** Whether it wants to hear of this one; asked before the channel is looked up. */
  wants: (refusal: MissingGrant) => boolean;
  hear: (refusal: MissingGrant) => void;
}

const listeners = new Set<MissingGrantListener>();

/**
 * Hears refusals for a missing grant.
 *
 * @returns A function that stops listening.
 */
export function listenForMissingGrants(listener: MissingGrantListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether anything listening wants to hear of this refusal. */
export function missingGrantWanted(refusal: MissingGrant): boolean {
  return [...listeners].some((listener) => listener.wants(refusal));
}

/** Tells the listeners that want it of the refusal. */
export function reportMissingGrant(refusal: MissingGrant): void {
  for (const listener of [...listeners]) {
    if (listener.wants(refusal)) listener.hear(refusal);
  }
}
