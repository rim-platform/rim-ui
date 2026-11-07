import { queryKeys } from "../../core/query/keys";
import { queryClient } from "../../core/query/queryClient";
import { toast } from "../../shared/toast";
import { useShellStore } from "../../shell/state/useShellStore";
import { HOME_LAYOUT, hasCapability } from "../updater/api/serverCapabilities";
import type { KnownServerInfo } from "../updater/api/serverInfoApi";
import { useHomeEditStore } from "./state/useHomeEditStore";

/** The local command that opens Home in edit mode. */
export const EDIT_HOME_COMMAND_ID = "workspace.edit_home";

/** Whether the connected server keeps Home layouts, as its cached server info says. */
export function homeEditable(): boolean {
  return hasCapability(
    queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo),
    HOME_LAYOUT,
  );
}

/** Opens Home and starts editing it, or says why a server that keeps no layout cannot. */
export function editHome(): void {
  if (!homeEditable()) {
    toast.info("This server can't keep a Home layout, so Home can't be edited here.");
    return;
  }
  useHomeEditStore.getState().request();
  useShellStore.getState().setMainSurface({ kind: "home" });
}
