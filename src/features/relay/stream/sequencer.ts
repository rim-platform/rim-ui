/**
 * Ordering of one host stream's events by `seq`: an event at or below the last applied is a
 * duplicate and dropped, the next one is applied, a later one is held until the missing ones
 * arrive. Held events wait at most 30 seconds or 256 events; then the stream asks to be
 * reconciled, which moves it to the host's head and applies what is held above it.
 */

export const HOLD_MS = 30_000;
export const HOLD_MAX = 256;

/** What an offered or reconciled event does to the stream. */
export interface StreamOutcome<T> {
  /** Events to apply now, in order. */
  apply: T[];
  /** Events dropped as duplicates or covered by reconciling. */
  dropped: T[];
}

interface Held<T> {
  item: T;
  at: number;
}

export class StreamSequencer<T> {
  private last: number | null;
  private readonly held = new Map<number, Held<T>>();

  /** `last`: the last `seq` applied, or `null` to take the first event seen as the baseline. */
  constructor(last: number | null) {
    this.last = last;
  }

  get lastSeq(): number | null {
    return this.last;
  }

  get heldCount(): number {
    return this.held.size;
  }

  /** Offer the event `seq` received at `now`. */
  offer(seq: number, item: T): StreamOutcome<T> {
    return this.offerAt(seq, item, Date.now());
  }

  offerAt(seq: number, item: T, now: number): StreamOutcome<T> {
    if (this.last === null) {
      this.last = seq;
      return { apply: [item, ...this.drain().apply], dropped: [] };
    }
    if (seq <= this.last || this.held.has(seq)) return { apply: [], dropped: [item] };
    if (seq === this.last + 1) {
      this.last = seq;
      const drained = this.drain();
      return { apply: [item, ...drained.apply], dropped: drained.dropped };
    }
    this.held.set(seq, { item, at: now });
    return { apply: [], dropped: [] };
  }

  /** Whether the held events waited too long or are too many: time to reconcile. */
  due(now: number = Date.now()): boolean {
    if (this.held.size === 0) return false;
    if (this.held.size >= HOLD_MAX) return true;
    const oldest = Math.min(...[...this.held.values()].map((h) => h.at));
    return now - oldest >= HOLD_MS;
  }

  /**
   * The stream was reconciled up to the host's `head`: held events at or below it are covered,
   * those right above it apply.
   */
  reconciled(head: number): StreamOutcome<T> {
    const dropped: T[] = [];
    if (this.last === null || head > this.last) this.last = head;
    for (const [seq, held] of this.held) {
      if (seq <= this.last) {
        dropped.push(held.item);
        this.held.delete(seq);
      }
    }
    const drained = this.drain();
    return { apply: drained.apply, dropped: [...dropped, ...drained.dropped] };
  }

  private drain(): StreamOutcome<T> {
    const apply: T[] = [];
    for (;;) {
      const next = this.last === null ? undefined : this.held.get(this.last + 1);
      if (!next || this.last === null) break;
      this.held.delete(this.last + 1);
      this.last += 1;
      apply.push(next.item);
    }
    return { apply, dropped: [] };
  }
}
