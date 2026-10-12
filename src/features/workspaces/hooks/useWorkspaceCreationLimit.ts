import { useAuthStore } from "../../auth/state/useAuthStore";
import { useProbationEnd } from "../../limits/api/useProbation";
import { limitView, probationText, type LimitView } from "../../limits/limits";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useMyServers } from "../api/useMyServers";

/** Whether this account may create a workspace now, as far as the client can tell. */
export interface WorkspaceCreationLimit {
  /** The owned workspaces against the instance's cap; `null` without a cap. */
  limit: LimitView | null;
  /** Why creating one is refused right now (probation or the cap), else `null`. */
  blocked: string | null;
}

/**
 * The instance's workspace cap over the workspaces this account owns, and its probation: what
 * the create-workspace dialogs show before the server would refuse.
 */
export function useWorkspaceCreationLimit(): WorkspaceCreationLimit {
  const { limits } = useServerInfo();
  const cap = limits?.workspacesPerUser;
  const userId = useAuthStore((s) => s.session?.userId);
  const { data: servers } = useMyServers(cap != null);
  const probationEnd = useProbationEnd();
  const owned =
    servers && userId ? servers.filter((s) => s.owner?.id === userId).length : undefined;
  const limit = limitView(cap, owned, ["workspace", "workspaces"], "workspaces per user");
  const blocked = probationEnd
    ? probationText("create workspaces", probationEnd)
    : limit?.full
      ? limit.reason
      : null;
  return { limit, blocked };
}
