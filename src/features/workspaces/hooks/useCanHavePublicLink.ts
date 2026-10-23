import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useServerInfo } from "../../updater/hooks/useServerInfo";

/**
 * Whether `serverId` can have a public link, and so join requests: every workspace but the
 * direct space and the server's default workspace, which everyone joins anyway. `false` while
 * the server's info loads, so nothing shows that would then disappear.
 *
 * @param serverId The workspace, or null when none is open.
 * @param enabled Whether to fetch the server's info when it is not cached yet.
 */
export function useCanHavePublicLink(serverId: string | null | undefined, enabled = true): boolean {
  const { info } = useServerInfo(enabled);
  const inDirectSpace = useIsDirectSpace(serverId ?? null);
  if (!serverId || inDirectSpace || !info) return false;
  return info.defaultWorkspace !== serverId;
}
