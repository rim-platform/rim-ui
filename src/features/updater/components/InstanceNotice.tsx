import { useServerInfo } from "../hooks/useServerInfo";

/**
 * The operator's notice for this server as a short banner, in plain text with its line breaks
 * kept; nothing when the server has none or is too old to say.
 */
export function InstanceNotice() {
  const notice = useServerInfo().info?.instanceNotice?.trim();
  if (!notice) return null;
  return (
    <p
      role="note"
      aria-label="Notice from this server"
      className="whitespace-pre-line break-words rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-sm text-rim-text-muted"
    >
      {notice}
    </p>
  );
}
