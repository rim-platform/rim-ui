// Principals as web plugins see them, derived exactly as the desktop host's
// `protocol.rs` derives them.

import type { Principal } from "./rpc";

const DOMAIN = "rim.principal.provisional.v1\0";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The provisional principal id of an account: `rimp0_` and the unpadded
 * base64url SHA-256 of a domain separator and the lowercased account id. The
 * same on every device, and it cannot be turned back into the account id.
 */
export async function provisionalPrincipalId(userId: string): Promise<string> {
  const input = new TextEncoder().encode(DOMAIN + userId.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", input);
  return `rimp0_${base64Url(new Uint8Array(digest))}`;
}

/** Whether `id` is a key-based principal id a plugin may be given. */
export function isKeyPrincipalId(id: string): boolean {
  return id.length > "rimp1_".length && id.length <= 128 && /^rimp1_[A-Za-z0-9_.-]+$/.test(id);
}

/** The signed-in user as plugins see them: the key-based id once there is one. */
export async function principalOf(user: {
  userId: string;
  displayName: string;
  principalId: string | null;
}): Promise<Principal> {
  const principalId =
    user.principalId !== null && isKeyPrincipalId(user.principalId)
      ? user.principalId
      : await provisionalPrincipalId(user.userId);
  return { principalId, displayName: user.displayName };
}
