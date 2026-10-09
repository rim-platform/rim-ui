/**
 * One encryption operation at a time per conversation: a Commit, a send and a welcome join
 * each read the group's epoch and must not interleave with another that moves it.
 */

const tails = new Map<string, Promise<unknown>>();

/** Run `task` after every earlier task of `key` settled. */
export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
