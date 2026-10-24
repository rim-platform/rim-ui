/* tslint:disable */
/* eslint-disable */

/**
 * A sign-in with the password.
 */
export class OpaqueLogin {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Finishes with the server's `CredentialResponse`. Returns the `CredentialFinalization` to
     * send, the export key and the session key. Throws `OPAQUE_WRONG_PASSWORD` when the
     * password is wrong or the account has none. A flow finishes once.
     */
    finish(response: Uint8Array): { finalization: Uint8Array; exportKey: Uint8Array; sessionKey: Uint8Array };
    /**
     * Starts a sign-in with `password`.
     */
    constructor(password: string);
    /**
     * The `CredentialRequest` to send.
     */
    request(): Uint8Array;
}

/**
 * A password registration: signup, a password change or a reset.
 */
export class OpaqueRegistration {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Finishes with the server's `RegistrationResponse`. Returns the `RegistrationUpload` to
     * send and the export key. A flow finishes once.
     */
    finish(response: Uint8Array): { upload: Uint8Array; exportKey: Uint8Array };
    /**
     * Starts registering `password`.
     */
    constructor(password: string);
    /**
     * The `RegistrationRequest` to send.
     */
    request(): Uint8Array;
}

/**
 * The 32-byte key the server sealed `label` under (`"server share"`, `"keep key"` or
 * `"session secret"`), from the login's session key (64 bytes).
 */
export function transportKey(session_key: Uint8Array, label: string): Uint8Array;

/**
 * The unlock key of `principalId`: 32 bytes from the login's export key (64 bytes) and the
 * server share (32 bytes).
 */
export function unlockKey(export_key: Uint8Array, share: Uint8Array, principal_id: string): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_opaquelogin_free: (a: number, b: number) => void;
    readonly __wbg_opaqueregistration_free: (a: number, b: number) => void;
    readonly opaquelogin_finish: (a: number, b: number, c: number) => [number, number, number];
    readonly opaquelogin_new: (a: number, b: number) => [number, number, number];
    readonly opaquelogin_request: (a: number) => [number, number];
    readonly opaqueregistration_finish: (a: number, b: number, c: number) => [number, number, number];
    readonly opaqueregistration_new: (a: number, b: number) => [number, number, number];
    readonly opaqueregistration_request: (a: number) => [number, number];
    readonly transportKey: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly unlockKey: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
