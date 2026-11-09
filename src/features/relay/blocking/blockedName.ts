import { shortPrincipal } from "../../plugins/registry/model";
import type { BlockedPrincipalView } from "../api/relayApi";

/**
 * How the list names a blocked person: the name given to them as a contact, their display name,
 * username, or a short principal id.
 */
export function blockedName(entry: BlockedPrincipalView, aliases: Record<string, string>): string {
  return (
    aliases[entry.principalId] ||
    entry.displayName ||
    entry.username ||
    shortPrincipal(entry.principalId)
  );
}
