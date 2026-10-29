import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fetchServerInfo, type KnownServerInfo } from "./serverInfoApi";

/** The capability of a server with `Message.editedAt`. */
export const MESSAGE_EDITED_AT = "message_edited_at";

/**
 * The capability of a server with `Message.flagged`, `MessageReport.automatic` and
 * `clearMessageFlag`; such a server also lists {@link MESSAGE_EDITED_AT}.
 */
export const MESSAGE_FLAG = "message_flag";

/** The capability of a server with `leaveWorkspace`. */
export const WORKSPACE_LEAVE = "workspace_leave";

/** The capability of a server with `renameWorkspace`. */
export const WORKSPACE_RENAME = "workspace_rename";

/** Whether `info` lists `capability`; false while unknown or for an older server. */
export function hasCapability(info: KnownServerInfo | undefined, capability: string): boolean {
  return info?.capabilities?.includes(capability) ?? false;
}

/** The documents of one message read, by the newest message fields they ask for. */
export interface MessageReadDocuments<T> {
  plain: T;
  /** With `Message.editedAt`. */
  withEdits: T;
  /** With `Message.editedAt` and `Message.flagged`. */
  withFlags: T;
}

/**
 * The document of a message read that the connected server answers: `withFlags` when it lists
 * {@link MESSAGE_FLAG}, `withEdits` when it lists {@link MESSAGE_EDITED_AT}, else `plain`.
 */
export async function messageReadDocument<T>(documents: MessageReadDocuments<T>): Promise<T> {
  if (await serverHasCapability(MESSAGE_FLAG)) return documents.withFlags;
  if (await serverHasCapability(MESSAGE_EDITED_AT)) return documents.withEdits;
  return documents.plain;
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
