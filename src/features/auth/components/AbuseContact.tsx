import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { abuseContactHref } from "../api/abuseContact";
import { ExternalLink } from "./ExternalLink";

/** "Report abuse: …" with the server's abuse contact; nothing when the server names none. */
export function AbuseContact() {
  const contact = useServerInfo().info?.abuseContact?.trim();
  if (!contact) return null;
  return (
    <p className="text-center text-xs text-rim-text-faint">
      Report abuse on this server:{" "}
      <ExternalLink
        href={abuseContactHref(contact)}
        className="break-all text-rim-text-muted underline underline-offset-2 hover:text-rim-text"
      >
        {contact}
      </ExternalLink>
    </p>
  );
}
