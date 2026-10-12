import { useId } from "react";

import { detectPlatform } from "../../../core/runtime/runtime";
import { isHttpUrl } from "../../../shared/ui/markdown/safeUrl";
import type { SignupTerms } from "../api/useSignupTerms";

/**
 * "I accept the terms of use" with the server's terms URL as a link, which opens in the system
 * browser on the desktop and in a new tab on the web, and the server's refusal over the terms
 * when there was one. Nothing when the server has no terms.
 */
export function TermsAcceptance({ terms, disabled }: { terms: SignupTerms; disabled?: boolean }) {
  const errorId = useId();
  const { termsUrl } = terms;
  if (termsUrl === null) return null;

  function openOnDesktop(e: React.MouseEvent<HTMLAnchorElement>) {
    if (detectPlatform() !== "desktop" || termsUrl === null) return;
    e.preventDefault();
    const url = termsUrl;
    import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(url))
      .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  }

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-rim-text">
        <input
          type="checkbox"
          checked={terms.accepted}
          onChange={(e) => terms.setAccepted(e.currentTarget.checked)}
          disabled={disabled}
          aria-describedby={terms.error ? errorId : undefined}
        />
        I accept the terms of use
      </label>
      {isHttpUrl(termsUrl) && (
        <a
          href={termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openOnDesktop}
          className="ml-6 block break-all text-xs text-rim-accent hover:underline"
        >
          {termsUrl}
        </a>
      )}
      {terms.error && (
        <p id={errorId} role="alert" className="ml-6 text-xs text-rim-danger">
          {terms.error}
        </p>
      )}
    </div>
  );
}
