declare const principalIdBrand: unique symbol;

/**
 * Opaque, stable id of a person.
 *
 * Store it and compare it with `===`, but never parse it or build one: it is
 * not an account UUID and not a `name@domain`, and its format will change once
 * when key identity ships (ids starting `rimp0_` are provisional). Keep stored
 * ids somewhere you can rewrite, because the host will send an old-to-new
 * mapping then.
 */
export type PrincipalId = string & { readonly [principalIdBrand]: true };

/** How a plugin sees a person: an opaque id and a label, nothing else. */
export interface Principal {
  /** Opaque, stable id of the person. */
  readonly principalId: PrincipalId;
  /** Label to show for the person. Not unique and may change. */
  readonly displayName: string;
}

/** A principal field that is neither null nor `{ principalId, displayName }` with two strings. */
export class MalformedPrincipalError extends Error {
  constructor(value: unknown) {
    super(`malformed principal: ${JSON.stringify(value)}`);
    this.name = "MalformedPrincipalError";
  }
}

/**
 * Read a principal off the wire, keeping only `principalId` and `displayName`.
 * Other fields are ignored, as the protocol asks of receivers.
 *
 * @throws MalformedPrincipalError when `value` is neither null nor a principal.
 */
export function readPrincipal(value: unknown): Principal | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new MalformedPrincipalError(value);
  const { principalId, displayName } = value as Record<string, unknown>;
  if (typeof principalId !== "string" || principalId.length === 0) {
    throw new MalformedPrincipalError(value);
  }
  if (typeof displayName !== "string") throw new MalformedPrincipalError(value);
  return Object.freeze({ principalId: principalId as PrincipalId, displayName });
}

/** True when both are null or both name the same person with the same label. */
export function samePrincipal(a: Principal | null, b: Principal | null): boolean {
  if (a === null || b === null) return a === b;
  return a.principalId === b.principalId && a.displayName === b.displayName;
}
