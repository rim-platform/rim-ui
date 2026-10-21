/**
 * Where to report abuse on a server: its https URL as a link, any other value as an email
 * address.
 *
 * @param contact - `serverInfo.abuseContact`.
 * @returns The link's target.
 */
export function abuseContactHref(contact: string): string {
  return /^https:\/\//i.test(contact) ? contact : `mailto:${contact}`;
}
