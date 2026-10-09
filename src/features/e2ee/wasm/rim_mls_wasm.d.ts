/* tslint:disable */
/* eslint-disable */

/**
 * One account's MLS engine and its state.
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The entries changed since the last [`Engine::keep`], to persist: `[{label, key, value}]`,
     * `value` null for a deleted entry.
     */
    changes(): string;
    /**
     * The server accepted the pending Commit: merge it. Returns the new epoch.
     */
    commitAccepted(conversation_id: string, incarnation: number): number;
    /**
     * The server refused the pending Commit: drop it.
     */
    commitRejected(conversation_id: string, incarnation: number): void;
    /**
     * Create `incarnation` of the conversation's group and stage its first Commit, adding the
     * claimed devices (`[{principalId, deviceId, keyPackage}]`).
     */
    createGroup(conversation_id: string, incarnation: number, claimed: string): string;
    /**
     * Decrypt an envelope once and check it against its row (`{messageId, threadRootId,
     * authorPrincipalId}`).
     */
    decrypt(conversation_id: string, incarnation: number, envelope: string, expected: string): string;
    /**
     * Delete the group's state on this device.
     */
    deleteGroup(conversation_id: string, incarnation: number): void;
    /**
     * Encrypt content (its exact JSON text) in the group's current epoch.
     */
    encrypt(conversation_id: string, incarnation: number, content: string): string;
    /**
     * Every kept entry, as [`Engine::new`] reads them.
     */
    export(): string;
    /**
     * Forget the MLS key; the next payload makes a new one.
     */
    forgetIdentity(): void;
    /**
     * `count` new key packages (`[{message, keyPackageRef, lastResort, notAfter}]`), valid
     * from an hour before `now` (Unix seconds) for 90 days.
     */
    generateKeyPackages(count: number, last_resort: boolean, now: number): string;
    /**
     * The group's epoch and whether it waits for a Commit answer or a re-add.
     */
    groupStatus(conversation_id: string, incarnation: number): string;
    /**
     * Keep the signed `mls-key` statement once it verifies under `device_key`.
     */
    installMlsKeyStatement(payload: string, signature: string, device_key: string): void;
    /**
     * Join `incarnation` of the conversation's group from a Welcome.
     */
    join(conversation_id: string, incarnation: number, welcome: string): string;
    /**
     * The changes were persisted: start a new journal.
     */
    keep(): void;
    /**
     * The `mls-key` payload for the device key to sign; makes the MLS key if there is none.
     */
    mlsKeyPayload(principal_id: string, device_id: string, issued_at: string): string;
    /**
     * This device's `mls-key` statement as `{payload, signature}` JSON, if it has one.
     */
    mlsKeyStatement(): string | undefined;
    /**
     * An engine over stored entries: the JSON array [`Engine::export`] (or the persisted
     * changes) gives, `[{label, key, value}]` with base64url key and value.
     */
    constructor(entries: string);
    /**
     * The re-add request payload for the device key to sign; the group's state goes.
     */
    prepareReadd(conversation_id: string, incarnation: number): string;
    /**
     * Process the Commit for the group's current epoch.
     */
    processCommit(conversation_id: string, incarnation: number, commit: string): string;
    /**
     * Delete the keys of expired and replaced key packages; returns how many went.
     */
    pruneKeyPackages(now: number): number;
    /**
     * Encrypt an earlier message again in the current epoch, with the same content, franking
     * key and commitment (the resend after `STALE_EPOCH`).
     */
    reencrypt(conversation_id: string, incarnation: number, content: string, franking_key: string, commitment: string): string;
    /**
     * The changes could not be persisted: undo them.
     */
    rollback(): void;
    /**
     * Stage one Commit of the claimed adds and the removes (`[{principalId, deviceId}]`).
     */
    stageCommit(conversation_id: string, incarnation: number, claimed: string, removes: string): string;
    /**
     * Check every leaf of the group against what the page found out about each device.
     */
    verifyLeaves(conversation_id: string, incarnation: number, directory: string): string;
}

/**
 * The content JSON text of a message: `{id, rev, threadRootId, body, replyTo, forwardedFrom,
 * attachments, linkPreviews}`, with the mentions read from the body. Refuses content that
 * breaks a rule.
 */
export function buildContent(draft: string): string;

/**
 * The cipher suite every group uses (0x004F), as `submitMlsCommit` names it.
 */
export function cipherSuite(): number;

/**
 * Whether a committer may act on a device's re-add request now (Unix seconds).
 */
export function mayHonorReadd(last_honored_at: number | null | undefined, now: number): boolean;

/**
 * What to upload given the server's key package status (`{available, lastResortNotAfter,
 * lastResortClaims}`, the time in Unix seconds): `{oneTime, lastResort}`.
 */
export function planKeyPackageUpload(status: string, now: number): string;

/**
 * Read a re-add request and check that `device_key` signed it: `{principalId, deviceId,
 * conversationId, incarnation, lastEpoch}`.
 */
export function verifyReadd(payload: string, signature: string, device_key: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly buildContent: (a: number, b: number) => [number, number, number, number];
    readonly cipherSuite: () => number;
    readonly engine_changes: (a: number) => [number, number];
    readonly engine_commitAccepted: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly engine_commitRejected: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_createGroup: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly engine_decrypt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly engine_deleteGroup: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly engine_export: (a: number) => [number, number];
    readonly engine_forgetIdentity: (a: number) => [number, number];
    readonly engine_generateKeyPackages: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly engine_groupStatus: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly engine_installMlsKeyStatement: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly engine_join: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly engine_keep: (a: number) => void;
    readonly engine_mlsKeyPayload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly engine_mlsKeyStatement: (a: number) => [number, number, number, number];
    readonly engine_new: (a: number, b: number) => [number, number, number];
    readonly engine_prepareReadd: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly engine_processCommit: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly engine_pruneKeyPackages: (a: number, b: number) => [number, number, number];
    readonly engine_reencrypt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly engine_rollback: (a: number) => void;
    readonly engine_stageCommit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly engine_verifyLeaves: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly mayHonorReadd: (a: number, b: number, c: number) => number;
    readonly planKeyPackageUpload: (a: number, b: number, c: number) => [number, number, number, number];
    readonly verifyReadd: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
