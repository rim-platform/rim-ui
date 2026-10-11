/** The wait before the first timed retry. */
export const RETRY_FIRST_MS = 15_000;
/** The longest wait the doubling reaches. */
export const RETRY_MAX_MS = 120_000;

export interface Retry {
  /** Attempt right away, unless an attempt is running, and start the waits over. */
  now(): void;
  /** No further attempts; the outcome of a running one is ignored. */
  stop(): void;
}

/**
 * Runs `attempt` on a timer until it reports success (`true`). The first try comes after
 * `RETRY_FIRST_MS`; each failed try doubles the wait, up to `RETRY_MAX_MS`. A timed try while
 * `ready()` is false is skipped and waits again. A rejected attempt counts as failed, and
 * attempts never overlap. `attempt` gets a check for whether `stop()` was called meanwhile.
 */
export function retryWithBackoff(
  attempt: (stopped: () => boolean) => Promise<boolean>,
  ready: () => boolean = () => true,
): Retry {
  let stopped = false;
  let running = false;
  let delay = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void tick(), delay);
  }

  /** One attempt: its outcome, or `null` when it did not run or was stopped meanwhile. */
  async function run(): Promise<boolean | null> {
    if (stopped || running) return null;
    running = true;
    try {
      const done = await attempt(() => stopped).catch(() => false);
      return stopped ? null : done;
    } finally {
      running = false;
    }
  }

  async function tick() {
    if (!ready()) {
      schedule();
      return;
    }
    if ((await run()) === false) {
      delay = Math.min(delay * 2, RETRY_MAX_MS);
      schedule();
    }
  }

  schedule();
  return {
    now() {
      if (stopped || running) return;
      delay = RETRY_FIRST_MS;
      clearTimeout(timer);
      void run().then((done) => {
        if (done === false) schedule();
      });
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
