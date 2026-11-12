import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { abuseContactHref } from "../api/abuseContact";
import { ExternalLink } from "./ExternalLink";

/** "Report abuse: …" with the server's abuse contact; nothing when the server names none. */
export function AbuseContact() {
  const contact = useServerInfo().info?.abuseContact?.trim();
  if (!contact) return null;
  return (
    <p className="ml-auto text-xs text-rim-text-muted">
      Report abuse on this server:{" "}
      <ExternalLink
        href={abuseContactHref(contact)}
        className="break-all text-rim-text underline underline-offset-2 hover:text-rim-accent"
      >
        {contact}
      </ExternalLink>
    </p>
  );
}
