import { useRuntime } from "../../../core/runtime/RuntimeProvider";

/** Where the web app keeps encrypted history and where a lasting copy lives. */
const BROWSER_HISTORY_NOTICE =
  "Encrypted messages are kept only in this browser: your other devices cannot load them from here, and clearing this site's data deletes them. For a copy that lasts, use the desktop app with its history archive set up.";

/**
 * The web app's notice that encrypted history stays in this browser, shared by key setup and
 * Settings > Security; renders nothing outside the web app.
 *
 * @param className - Extra classes for the paragraph, such as spacing.
 */
export function BrowserHistoryNotice({ className = "" }: { className?: string }) {
  const { platform } = useRuntime();
  if (platform !== "web") return null;
  return (
    <p className={`text-xs text-rim-text-faint ${className}`.trim()}>{BROWSER_HISTORY_NOTICE}</p>
  );
}
