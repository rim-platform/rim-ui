/**
 * The relay's queue on the app's WebSocket (`relayStream`): host events for spaces on other
 * servers, and the relay's own notices.
 *
 * Every `RelayItem` is checked before it is applied: the envelope is signed by the host's
 * pinned key at its `keySeq` (a newer seq refetches the host once), names the item's host and
 * space, the space is one this account uses on that host (or this is the `DmInvite` that adds
 * it), and the stream fits the event. Events are then ordered per stream (`StreamSequencer`);
 * a gap held too long is reconciled through host-signed answers, and only when that fails does
 * the space show "Messages may be missing". Items are acknowledged once applied or dropped.
 */

import { logger } from "../../../core/logger";
import type { WorkspaceEvent } from "../../../core/events/types";
import type { Statement } from "../../key-identity/browser/statements";
import type { HostEvent } from "../crypto/serverStatements";
import type { RelayCrypto } from "../crypto/relayCrypto";
import type { RelayItemView } from "../api/relayApi";
import { StreamSequencer } from "./sequencer";
import { streamMatches } from "./streamRules";

/** What the processor needs from the rest of the app; injected so it can be tested alone. */
export interface RelayStreamDeps {
  crypto: RelayCrypto;
  principalId: string;
  /** The host a space is bound to, or `null`. */
  hostOf(spaceId: string): string | null;
  /** Bind a new direct space to its host; `false` when refused. */
  registerSpace(spaceId: string, host: string): Promise<boolean>;
  /** Pin `host` from one of `origins` unless pinned; throws when it cannot or forked. */
  ensurePinned(host: string, origins: string[]): Promise<void>;
  hostKeyAt(host: string, keySeq: number): Promise<string>;
  /** The last `seq` applied on a stream, from storage. */
  loadLast(key: string): Promise<number | null>;
  saveLast(key: string, seq: number): Promise<void>;
  /** The host's heads of `streams` of `spaceId`, through host-signed answers. */
  streamHeads(spaceId: string, streams: string[]): Promise<Map<string, number>>;
  /** Refetch what the space shows through host-signed answers after a gap. */
  refetchSpace(spaceId: string, conversationIds: string[]): Promise<void>;
  apply(event: WorkspaceEvent, spaceId: string, host: string): void;
  ack(upTo: string): Promise<void>;
  onMissing(spaceId: string, host: string): void;
  onReconciled(spaceId: string): void;
  onDmRequest(): void;
  onForked(host: string): void;
  now(): number;
}

interface Applicable {
  event: WorkspaceEvent;
  spaceId: string;
  host: string;
  itemId: string | null;
}

/** The relay URLs of a card in a `DmInvite`, read without trusting it: they only say where to look. */
export function cardRelays(card: unknown): string[] {
  try {
    const payload = (card as Statement | null)?.payload;
    const relays =
      typeof payload === "string" ? (JSON.parse(payload) as { relays?: unknown }).relays : null;
    return Array.isArray(relays) ? relays.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

function streamKey(host: string, spaceId: string, stream: string): string {
  return `${host}|${spaceId}|${stream}`;
}

function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export class RelayStreamProcessor {
  private readonly deps: RelayStreamDeps;
  private readonly sequencers = new Map<string, StreamSequencer<Applicable>>();
  /** Item ids received, oldest first, and those done (applied or dropped). */
  private readonly received: string[] = [];
  private readonly done = new Set<string>();
  private acked: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly reconciling = new Set<string>();

  constructor(deps: RelayStreamDeps) {
    this.deps = deps;
  }

  /** Handle one `relayStream` message, in order with the others. */
  push(message: string): Promise<void> {
    this.queue = this.queue
      .then(() => this.handle(message))
      .catch((err: unknown) => {
        logger.warn("[RIM:relay] a relay message failed:", err);
      });
    return this.queue;
  }

  /** Reconcile every stream whose held events waited too long. */
  checkHeld(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const due = new Map<string, { host: string; spaceId: string; streams: string[] }>();
      for (const [key, sequencer] of this.sequencers) {
        if (!sequencer.due(this.deps.now())) continue;
        const [host, spaceId, stream] = key.split("|");
        const entry = due.get(spaceId) ?? { host, spaceId, streams: [] };
        entry.streams.push(stream);
        due.set(spaceId, entry);
      }
      for (const { host, spaceId, streams } of due.values()) {
        await this.reconcile(host, spaceId, streams);
      }
    });
    return this.queue;
  }

  /** Reconcile a whole space: after a queue overflow, or when it opens. */
  reconcileSpace(spaceId: string): Promise<void> {
    const host = this.deps.hostOf(spaceId);
    if (!host) return Promise.resolve();
    this.queue = this.queue.then(async () => {
      const streams = [...this.sequencers.keys()]
        .filter((key) => key.startsWith(`${host}|${spaceId}|`))
        .map((key) => key.split("|")[2]);
      await this.reconcile(host, spaceId, streams.length > 0 ? streams : ["w"]);
    });
    return this.queue;
  }

  private async handle(message: string): Promise<void> {
    let parsed: { type?: unknown } & Record<string, unknown>;
    try {
      parsed = JSON.parse(message) as typeof parsed;
    } catch {
      logger.warn("[RIM:relay] a relay message is not JSON");
      return;
    }
    switch (parsed.type) {
      case "RelayItem":
        return this.handleItem(parsed as unknown as RelayItemView);
      case "DmRequestReceived":
        this.deps.onDmRequest();
        return;
      case "QueueOverflow":
        return this.handleOverflow(parsed);
      default:
        return;
    }
  }

  private async handleOverflow(notice: Record<string, unknown>): Promise<void> {
    const named = Array.isArray(notice.spaces)
      ? notice.spaces.flatMap((s) => {
          const space = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
          return typeof space.workspaceId === "string" && typeof space.hostServerId === "string"
            ? [{ spaceId: space.workspaceId, host: space.hostServerId }]
            : [];
        })
      : [];
    for (const { spaceId, host: namedHost } of named) {
      const host = this.deps.hostOf(spaceId);
      if (host !== namedHost) continue;
      const streams = [...this.sequencers.keys()]
        .filter((key) => key.startsWith(`${host}|${spaceId}|`))
        .map((key) => key.split("|")[2]);
      await this.reconcile(host, spaceId, streams.length > 0 ? streams : ["w"]);
    }
  }

  /** Read, check and order one item; `null` when it is dropped. */
  private async verifiedEvent(item: RelayItemView): Promise<HostEvent | null> {
    const { crypto } = this.deps;
    const host = item.hostServerId;
    let unverified: HostEvent;
    try {
      unverified = await crypto.readHostEvent(item.envelope);
    } catch (err) {
      logger.warn("[RIM:relay] dropping an unreadable relay item:", err);
      return null;
    }
    if (unverified.host !== host || unverified.workspaceId !== item.workspaceId) {
      logger.warn("[RIM:relay] dropping an item whose envelope names another host or space");
      return null;
    }
    const known = this.deps.hostOf(item.workspaceId);
    const invite =
      unverified.event.type === "DmInvite" && unverified.stream === `u:${this.deps.principalId}`;
    if (known !== host && !(known === null && invite)) {
      logger.warn("[RIM:relay] dropping an item for a space this account does not use there");
      return null;
    }
    try {
      await this.deps.ensurePinned(host, invite ? cardRelays(unverified.event.from_card) : []);
      const key = await this.deps.hostKeyAt(host, unverified.keySeq);
      const event = await crypto.readHostEvent(item.envelope, key);
      if (!streamMatches(event, this.deps.principalId)) {
        logger.warn("[RIM:relay] dropping an event on a stream it does not belong to");
        return null;
      }
      if (known === null && !(await this.deps.registerSpace(item.workspaceId, host))) {
        logger.warn("[RIM:relay] dropping an invite to a space id that is taken");
        return null;
      }
      return event;
    } catch (err) {
      if (err instanceof Error && err.name === "ServerForkedError") this.deps.onForked(host);
      logger.warn("[RIM:relay] dropping a relay item that does not verify:", err);
      return null;
    }
  }

  /**
   * Check a held item of a DM request without applying or acknowledging it: binds the space of
   * a verified `DmInvite` to its host, so its Welcome can be read before the person decides.
   */
  verifyHeld(item: RelayItemView): Promise<HostEvent | null> {
    const run = this.queue.then(() => this.verifiedEvent(item));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handleItem(item: RelayItemView): Promise<void> {
    this.received.push(item.id);
    const event = await this.verifiedEvent(item);
    if (!event) {
      this.finish([item.id]);
      return this.flushAck();
    }
    const applicable: Applicable = {
      event: event.event as unknown as WorkspaceEvent,
      spaceId: item.workspaceId,
      host: item.hostServerId,
      itemId: item.id,
    };
    if (event.seq === null) {
      this.applyAll([applicable]);
      return this.flushAck();
    }
    const key = streamKey(item.hostServerId, item.workspaceId, event.stream);
    const sequencer = await this.sequencer(key);
    const outcome = sequencer.offerAt(event.seq, applicable, this.deps.now());
    this.applyAll(outcome.apply);
    this.finish(outcome.dropped.flatMap((a) => (a.itemId ? [a.itemId] : [])));
    await this.persist(key, sequencer);
    if (sequencer.due(this.deps.now())) {
      await this.reconcile(item.hostServerId, item.workspaceId, [event.stream]);
    }
    return this.flushAck();
  }

  private async sequencer(key: string): Promise<StreamSequencer<Applicable>> {
    let sequencer = this.sequencers.get(key);
    if (!sequencer) {
      sequencer = new StreamSequencer<Applicable>(await this.deps.loadLast(key));
      this.sequencers.set(key, sequencer);
    }
    return sequencer;
  }

  private async persist(key: string, sequencer: StreamSequencer<Applicable>): Promise<void> {
    const last = sequencer.lastSeq;
    if (last !== null) await this.deps.saveLast(key, last).catch(() => undefined);
  }

  private applyAll(items: Applicable[]): void {
    for (const item of items) {
      try {
        this.deps.apply(item.event, item.spaceId, item.host);
      } catch (err) {
        logger.warn("[RIM:relay] applying a host event failed:", err);
      }
    }
    this.finish(items.flatMap((a) => (a.itemId ? [a.itemId] : [])));
  }

  private finish(ids: string[]): void {
    for (const id of ids) this.done.add(id);
  }

  /** Acknowledge every item up to the first one still held. */
  private async flushAck(): Promise<void> {
    let through: string | null = null;
    while (this.received.length > 0 && this.done.has(this.received[0])) {
      through = this.received.shift() ?? null;
      if (through) this.done.delete(through);
    }
    if (!through || (this.acked && compareIds(through, this.acked) <= 0)) return;
    this.acked = through;
    await this.deps
      .ack(through)
      .catch((err: unknown) => logger.warn("[RIM:relay] acknowledging relay items failed:", err));
  }

  /** The last item acknowledged in this run. */
  get ackedThrough(): string | null {
    return this.acked;
  }

  private async reconcile(host: string, spaceId: string, streams: string[]): Promise<void> {
    const marker = `${host}|${spaceId}`;
    if (this.reconciling.has(marker)) return;
    this.reconciling.add(marker);
    try {
      const heads = await this.deps.streamHeads(spaceId, streams);
      const conversations = streams.filter((s) => s.startsWith("c:")).map((s) => s.slice(2));
      await this.deps.refetchSpace(spaceId, conversations);
      for (const stream of streams) {
        const head = heads.get(stream);
        if (head === undefined) continue;
        const key = streamKey(host, spaceId, stream);
        const sequencer = await this.sequencer(key);
        const outcome = sequencer.reconciled(head);
        this.applyAll(outcome.apply);
        this.finish(outcome.dropped.flatMap((a) => (a.itemId ? [a.itemId] : [])));
        await this.persist(key, sequencer);
      }
      this.deps.onReconciled(spaceId);
    } catch (err) {
      logger.warn("[RIM:relay] reconciling a space failed:", err);
      this.deps.onMissing(spaceId, host);
    } finally {
      this.reconciling.delete(marker);
      await this.flushAck();
    }
  }
}
