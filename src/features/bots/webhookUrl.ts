import { getApiOrigin } from "../../core/graphql/config";
import { serverOrigin } from "../relay/state/serverOrigin";

/**
 * The URL that posts to a channel with `token`, on the address of the server the app is signed
 * in to: the origin its discovery document declares, else the API origin of the configured
 * endpoint. Never the page's own address, which in the desktop app is `tauri://localhost`.
 *
 * @param token - The `rimhook_…` token the server returned.
 * @returns An absolute `https://…/api/hooks/<token>` URL.
 */
export async function webhookUrl(token: string): Promise<string> {
  let origin: string;
  try {
    origin = await serverOrigin();
  } catch {
    origin = getApiOrigin();
  }
  return `${origin.replace(/\/+$/, "")}/api/hooks/${encodeURIComponent(token)}`;
}
