declare const principalIdBrand: unique symbol;

/**
 * Opaque, stable id of a person.
 *
 * Store it and compare it with `===`, but never parse it or build one: it is
 * not an account UUID and not a `name@domain`, and its format changes once,
 * when the person enrolls a key identity (ids starting `rimp0_` are
 * provisional). Keep stored ids somewhere you can rewrite: the host sends the
 * old-to-new mapping in `rim.principals.remapped` (`onPrincipalsRemapped`).
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

/** One switched id: a provisional id and the key-based id that replaced it. */
export interface PrincipalMapping {
  readonly from: PrincipalId;
  readonly to: PrincipalId;
}

/** `rim.principals.remapped` params that are not `{ mappings: [{ from, to }, ...] }` with strings. */
export class MalformedMappingError extends Error {
  constructor(value: unknown) {
    super(`malformed principal mapping: ${JSON.stringify(value)}`);
    this.name = "MalformedMappingError";
  }
}

/**
 * Read the mappings of `rim.principals.remapped`, keeping only `from` and `to`.
 *
 * @throws MalformedMappingError when `value` is not a list of `{ from, to }` strings.
 */
export function readPrincipalMappings(value: unknown): readonly PrincipalMapping[] {
  if (!Array.isArray(value)) throw new MalformedMappingError(value);
  return Object.freeze(
    value.map((item: unknown) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new MalformedMappingError(item);
      }
      const { from, to } = item as Record<string, unknown>;
      if (
        typeof from !== "string" ||
        from.length === 0 ||
        typeof to !== "string" ||
        to.length === 0
      ) {
        throw new MalformedMappingError(item);
      }
      return Object.freeze({ from: from as PrincipalId, to: to as PrincipalId });
    }),
  );
}

/** True when both are null or both name the same person with the same label. */
export function samePrincipal(a: Principal | null, b: Principal | null): boolean {
  if (a === null || b === null) return a === b;
  return a.principalId === b.principalId && a.displayName === b.displayName;
}
