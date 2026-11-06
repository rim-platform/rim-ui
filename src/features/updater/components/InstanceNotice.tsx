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
      className="whitespace-pre-line break-words rounded-[10px] border border-rim-accent/30 bg-rim-accent/10 px-3 py-2.5 text-[13px] leading-normal text-rim-text"
    >
      {notice}
    </p>
  );
}
