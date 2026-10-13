/**
 * The CSRF token every mutation and upload sends in `X-CSRF-Token`, from one place: the web app
 * reads the `rim_csrf` cookie; the desktop app, which cannot read a cookie set by a server on
 * another host, sends the token the sign-in returned, and the cookie while it has none.
 */

import { isTauri } from "@tauri-apps/api/core";

import { useAuthStore } from "../../features/auth/state/useAuthStore";

const CSRF_COOKIE = "rim_csrf";
/** The request header the CSRF token travels in. */
export const CSRF_HEADER = "x-csrf-token";

function getCookie(name: string): string | undefined {
  const row = document.cookie.split("; ").find((r) => r.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.split("=")[1]) : undefined;
}

/** The CSRF token for this session, or `undefined` when there is none. */
export function csrfToken(): string | undefined {
  if (isTauri()) {
    const stored = useAuthStore.getState().csrfToken;
    if (stored) return stored;
  }
  return getCookie(CSRF_COOKIE);
}

/** The `X-CSRF-Token` header to add to a request, or no header when there is no token. */
export function csrfHeader(): Record<string, string> {
  const token = csrfToken();
  return token ? { [CSRF_HEADER]: token } : {};
}
