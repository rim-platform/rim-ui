import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { takePendingPublicLink } from "../pendingPublicLink";

/**
 * Sends a just signed-in account back to the public link it left to sign in or sign up, once:
 * when a session is there and a link is kept for this tab, the link is cleared and its
 * `/join/<token>` page opens in place of where the app landed.
 *
 * @param signedIn - Whether a session is restored and known.
 */
export function usePendingPublicLinkReturn(signedIn: boolean): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!signedIn) return;
    const token = takePendingPublicLink();
    if (token) navigate(`/join/${encodeURIComponent(token)}`, { replace: true });
  }, [signedIn, navigate]);
}
