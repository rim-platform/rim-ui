/**
 * One account's encrypted store in this browser: its MLS engine, whose state lives in memory and
 * in IndexedDB, and the unit of work every operation runs in.
 *
 * An operation reads what it needs, runs the engine (which journals what it changes), and
 * stages its own records; then everything it changed, MLS entries and records alike, is written
 * in one IndexedDB transaction. Only when that transaction completes is the engine's journal
 * kept and the operation's result used; if it fails, or the operation throws, the journal is
 * rolled back and nothing is written. So a message is decrypted once and its plaintext stored
 * together, and nothing is sent before the state that produced it is stored.
 */

import { serialize } from "../runtime/serialize";
import { BY_ACCOUNT, committed, database, done, keyOf, keyText, type StoreName } from "./db";
import { isTrap, noteTrap, type MlsEngine, type MlsModule } from "./mlsModule";
import type { WebAccount } from "./webAccount";

interface StoredEntry {
  endpoint: string;
  principalId: string;
  label: string;
  key: string;
  value: string;
}

interface EntryChange {
  label: string;
  key: string;
  value: string | null;
}

/** Records staged by a unit of work: the value to write, or `undefined` to delete. */
type Staged = Map<StoreName, Map<string, { key: IDBValidKey; value: unknown }>>;

/** The reads and staged writes of one operation. */
export class Work {
  private readonly staged: Staged = new Map();

  constructor(
    private readonly db: IDBDatabase,
    readonly account: WebAccount,
  ) {}

  /** The record of `store` under `key`, as this unit of work sees it. */
  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const staged = this.staged.get(store)?.get(keyText(key));
    if (staged) return staged.value as T | undefined;
    const tx = this.db.transaction(store, "readonly");
    return (await done(tx.objectStore(store).get(key))) as T | undefined;
  }

  /**
   * Records of `store` from `index` within `range` (every record of the account without an
   * index), with this unit of work's staged writes laid over them; `filter` picks the staged
   * records that belong to the query.
   */
  async list<T extends object>(
    store: StoreName,
    index: string,
    range: IDBKeyRange,
    filter: (record: T) => boolean,
  ): Promise<T[]> {
    const tx = this.db.transaction(store, "readonly");
    const found = (await done(tx.objectStore(store).index(index).getAll(range))) as T[];
    const byKey = new Map<string, T>();
    for (const record of found) {
      byKey.set(keyText(keyOf(store, record as Record<string, unknown>)), record);
    }
    for (const [text, { value }] of this.staged.get(store) ?? []) {
      if (value === undefined) byKey.delete(text);
      else if (filter(value as T)) byKey.set(text, value as T);
      else byKey.delete(text);
    }
    return [...byKey.values()];
  }

  /** Every record of `store` that belongs to this account. */
  all<T extends object>(store: StoreName, filter: (record: T) => boolean = () => true) {
    const { endpoint, principalId } = this.account;
    return this.list<T>(store, BY_ACCOUNT, IDBKeyRange.only([endpoint, principalId]), (r) => {
      const owner = r as unknown as { endpoint: string; principalId: string };
      return owner.endpoint === endpoint && owner.principalId === principalId && filter(r);
    });
  }

  /** Stage a record of `store` (its key fields included). */
  put(store: StoreName, record: object) {
    const key = keyOf(store, record as Record<string, unknown>);
    this.table(store).set(keyText(key), { key, value: record });
  }

  /** Stage deleting the record of `store` under `key`. */
  delete(store: StoreName, key: IDBValidKey) {
    this.table(store).set(keyText(key), { key, value: undefined });
  }

  private table(store: StoreName) {
    let table = this.staged.get(store);
    if (!table) {
      table = new Map();
      this.staged.set(store, table);
    }
    return table;
  }

  /** Write the staged records and the engine's changed entries in one transaction. */
  async flush(changes: EntryChange[]): Promise<void> {
    const stores = new Set<StoreName>(this.staged.keys());
    if (changes.length > 0) stores.add("mls");
    if (stores.size === 0) return;
    const tx = this.db.transaction([...stores], "readwrite");
    const finished = committed(tx);
    try {
      for (const [store, table] of this.staged) {
        const os = tx.objectStore(store);
        for (const { key, value } of table.values()) {
          if (value === undefined) os.delete(key);
          else os.put(value);
        }
      }
      const { endpoint, principalId } = this.account;
      const mls = changes.length > 0 ? tx.objectStore("mls") : null;
      for (const change of changes) {
        if (change.value === null) {
          mls?.delete([endpoint, principalId, change.label, change.key]);
        } else {
          const { label, key, value } = change;
          mls?.put({ endpoint, principalId, label, key, value } satisfies StoredEntry);
        }
      }
    } catch (err) {
      tx.abort();
      await finished.catch(() => undefined);
      throw err;
    }
    await finished;
  }
}

/** One account's engine and the unit-of-work runner around it. */
export class WebStore {
  private broken = false;

  private constructor(
    readonly account: WebAccount,
    private readonly db: IDBDatabase,
    readonly mls: MlsModule,
    readonly engine: MlsEngine,
  ) {}

  /** Open the account's store: its MLS entries are read into a fresh engine. */
  static async open(account: WebAccount, mls: MlsModule): Promise<WebStore> {
    const db = await database();
    const tx = db.transaction("mls", "readonly");
    const entries = (await done(
      tx
        .objectStore("mls")
        .index(BY_ACCOUNT)
        .getAll(IDBKeyRange.only([account.endpoint, account.principalId])),
    )) as StoredEntry[];
    const engine = new mls.Engine(
      JSON.stringify(entries.map(({ label, key, value }) => ({ label, key, value }))),
    );
    return new WebStore(account, db, mls, engine);
  }

  /**
   * Run `task` as one unit of work, after every earlier one of this account finished. Its
   * result is returned once everything it changed is stored; if it throws or the write fails,
   * nothing it changed is kept.
   */
  run<T>(task: (work: Work) => Promise<T>): Promise<T> {
    return serialize(`e2ee-store:${this.account.endpoint}\n${this.account.principalId}`, () =>
      this.runNow(task),
    );
  }

  private async runNow<T>(task: (work: Work) => Promise<T>): Promise<T> {
    if (this.broken) throw new Error("the encrypted store stopped after an internal error");
    const work = new Work(this.db, this.account);
    try {
      const result = await task(work);
      await work.flush(JSON.parse(this.engine.changes()) as EntryChange[]);
      this.engine.keep();
      return result;
    } catch (err) {
      if (isTrap(err)) {
        this.broken = true;
        noteTrap();
      } else {
        this.engine.rollback();
      }
      throw err;
    }
  }

  /** Read without writing: no journal, no transaction of its own. */
  async read<T>(task: (db: IDBDatabase) => Promise<T>): Promise<T> {
    return task(this.db);
  }
}
