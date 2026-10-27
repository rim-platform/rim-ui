import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fetchServerInfo, type KnownServerInfo } from "./serverInfoApi";

/** The capability of a server with `Message.editedAt`. */
export const MESSAGE_EDITED_AT = "message_edited_at";

/** Whether `info` lists `capability`; false while unknown or for an older server. */
export function hasCapability(info: KnownServerInfo | undefined, capability: string): boolean {
  return info?.capabilities?.includes(capability) ?? false;
}

/**
 * Whether the connected server lists `capability`, read from the cached server info (fetched
 * once when missing); false when it cannot be read.
 */
export async function serverHasCapability(capability: string): Promise<boolean> {
  try {
    const info = await queryClient.ensureQueryData({
      queryKey: queryKeys.serverInfo,
      queryFn: fetchServerInfo,
      staleTime: Infinity,
      retry: false,
    });
    return hasCapability(info, capability);
  } catch {
    return false;
  }
}
