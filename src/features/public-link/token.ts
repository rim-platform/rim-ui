/** The prefix of a workspace's public link token; invite tokens start `rim_inv_` or `rim_iinv_`. */
export const PUBLIC_LINK_PREFIX = "rim_pjl_";

/** Whether `token` is a workspace's public link rather than an invite. */
export function isPublicLinkToken(token: string): boolean {
  return token.startsWith(PUBLIC_LINK_PREFIX);
}
