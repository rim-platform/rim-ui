import { useEffect } from "react";

/**
 * Injects `<meta name="referrer" content="no-referrer">` into `document.head`
 * on mount and removes it on unmount. Used on routes that carry sensitive tokens
 * in their URL path to prevent token leakage via the Referer header.
 */
export function useNoReferrerMeta(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}
