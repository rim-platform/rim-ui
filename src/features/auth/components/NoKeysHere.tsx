/** What an app that cannot create identity keys says in place of signing in or signing up. */
export const NO_KEYS_HERE_MESSAGE =
  "This browser can't create the keys an account needs. Use the desktop app or another browser.";

/** {@link NO_KEYS_HERE_MESSAGE} as a paragraph, shown in place of the key forms. */
export function NoKeysHere() {
  return <p className="text-sm text-rim-text-muted">{NO_KEYS_HERE_MESSAGE}</p>;
}
