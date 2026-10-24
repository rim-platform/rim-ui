/**
 * IndexedDB records sealed under the account vault: the fields a store looks records up by (its
 * key and index fields) stay as they are, and every other field goes into one sealed `data`
 * field, bound to the record's place as `"<db>/<store>/<record key as JSON>"`, so a record moved
 * under another key or store does not open.
 */

import { isSealed, openValue, sealValue, type SealedValue } from "./accountVault";

/** A store's key path, as IndexedDB takes it. */
export type KeyPath = string | readonly string[];

/** The key of `record` under `keyPath`. */
export function keyOfRecord(keyPath: KeyPath, record: object): IDBValidKey {
  const fields = record as Record<string, unknown>;
  return typeof keyPath === "string"
    ? (fields[keyPath] as IDBValidKey)
    : keyPath.map((field) => fields[field] as IDBValidKey);
}

/** The associated data of the record under `key` in `db`'s `store`. */
export function recordAad(db: string, store: string, key: IDBValidKey): string {
  return `${db}/${store}/${JSON.stringify(key)}`;
}

/** Where a sealed record lives and which of its fields stay plain. */
export interface SealedStore {
  db: string;
  store: string;
  keyPath: KeyPath;
  /** The key and index fields; the key path's fields are always among them. */
  plain: readonly string[];
}

/**
 * The record as stored: its plain fields, and the rest sealed in `data`.
 *
 * @throws VaultLockedError while the vault is locked.
 */
export async function sealRecord(
  where: SealedStore,
  record: object,
): Promise<Record<string, unknown>> {
  const stored: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (where.plain.includes(field)) stored[field] = value;
    else secret[field] = value;
  }
  const key = keyOfRecord(where.keyPath, record);
  stored.data = await sealValue(secret, recordAad(where.db, where.store, key));
  return stored;
}

/**
 * The record a stored one holds, its sealed fields opened.
 *
 * @returns The record, or `null` when it is not sealed or does not open under this vault.
 * @throws VaultLockedError while the vault is locked.
 */
export async function openRecord<T>(where: SealedStore, stored: unknown): Promise<T | null> {
  if (typeof stored !== "object" || stored === null) return null;
  const { data, ...plain } = stored as { data?: SealedValue } & Record<string, unknown>;
  if (!isSealed(data)) return null;
  const key = keyOfRecord(where.keyPath, plain);
  const secret = await openValue<Record<string, unknown>>(
    data,
    recordAad(where.db, where.store, key),
  );
  if (secret === null || typeof secret !== "object") return null;
  return { ...secret, ...plain } as T;
}

/**
 * The records that open of those stored, in order; the others are left out.
 *
 * @throws VaultLockedError while the vault is locked.
 */
export async function openRecords<T>(where: SealedStore, stored: unknown[]): Promise<T[]> {
  const opened = await Promise.all(stored.map((s) => openRecord<T>(where, s)));
  return opened.filter((r): r is Awaited<T> => r !== null) as T[];
}
