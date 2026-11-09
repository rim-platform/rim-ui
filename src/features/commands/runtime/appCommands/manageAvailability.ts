import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { detectPlatform, getRuntimeCapabilities } from "../../../../core/runtime/runtime";
import { toast } from "../../../../shared/toast";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import { botsOfferedFor, webhooksAvailable } from "../../../bots/availability";
import { useRelayStore } from "../../../relay/state/useRelayStore";
import type { KnownServerInfo } from "../../../updater/api/serverInfoApi";
import type { ServerDetail } from "../../../workspaces/api/useWorkspace";
import { canModerate, isOwner } from "../../../workspaces/role";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";

const MODERATORS = "Only owners and moderators can do this.";
const OWNERS = "Only the owner can do this.";
const OPERATORS = "Only instance operators can do this.";
const BOTS = "Bots are managed by this workspace's owners and moderators.";
const WEBHOOKS = "Webhooks are managed by this workspace's owners and moderators.";
const RELAY = "This needs your relay account.";
const PLUGINS_DESKTOP = "This works in the desktop app.";
const PLUGINS_NONE = "Plugins are not available here.";

/** Commands for the owners and moderators of the open workspace. */
const MODERATOR_COMMANDS: ReadonlySet<string> = new Set([
  "moderation.open_reports",
  "moderation.resolve_report",
  "moderation.dismiss_report",
  "moderation.clear_flag",
  "workspace.accept_join_request",
  "workspace.decline_join_request",
]);

/** Commands for instance operators. */
const OPERATOR_COMMANDS: ReadonlySet<string> = new Set([
  "moderation.block_principal",
  "moderation.unblock_principal",
  "moderation.unblock_ip",
  "moderation.clear_profile",
]);

const BOT_COMMANDS: ReadonlySet<string> = new Set(["bots.new", "bots.edit", "bots.deactivate"]);
const WEBHOOK_COMMANDS: ReadonlySet<string> = new Set(["bots.new_webhook", "bots.revoke_webhook"]);
const DESKTOP_PLUGIN_COMMANDS: ReadonlySet<string> = new Set([
  "plugins.update",
  "plugins.revoke_ai_access",
]);
const PLUGIN_COMMANDS: ReadonlySet<string> = new Set([
  "plugins.install",
  "plugins.toggle",
  "plugins.uninstall",
  ...DESKTOP_PLUGIN_COMMANDS,
]);
const PEOPLE_COMMANDS: ReadonlySet<string> = new Set([
  "people.add_contact",
  "people.remove_contact",
  "people.block",
  "people.unblock",
  "people.accept_request",
  "people.ignore_request",
  "people.report_request",
  "people.read_request_first",
]);

function openRole() {
  const id = useWorkspaceStore.getState().workspaceId;
  return id ? queryClient.getQueryData<ServerDetail>(queryKeys.server(id))?.viewerRole : undefined;
}

/** Whether the signed-in account is known to be an instance operator. */
function isInstanceOperator(): boolean {
  const userId = useAuthStore.getState().session?.userId;
  return queryClient.getQueryData<boolean>(queryKeys.instanceOperator(userId)) === true;
}

/**
 * Why `commandId` is refused to this person now, in the words a click would meet, or `null`
 * when it is offered. Commands outside the management set are always offered.
 */
export function manageRefusal(commandId: string): string | null {
  if (MODERATOR_COMMANDS.has(commandId)) return canModerate(openRole()) ? null : MODERATORS;
  if (commandId === "workspace.revoke_invite") return isOwner(openRole()) ? null : OWNERS;
  if (OPERATOR_COMMANDS.has(commandId)) return isInstanceOperator() ? null : OPERATORS;
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (BOT_COMMANDS.has(commandId)) return botsOfferedFor(workspaceId) ? null : BOTS;
  if (WEBHOOK_COMMANDS.has(commandId)) {
    const info = queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo);
    return botsOfferedFor(workspaceId) && webhooksAvailable(info) ? null : WEBHOOKS;
  }
  if (PLUGIN_COMMANDS.has(commandId)) {
    const capabilities = getRuntimeCapabilities(detectPlatform());
    if (!capabilities.pluginHost && !capabilities.webPlugins) return PLUGINS_NONE;
    if (DESKTOP_PLUGIN_COMMANDS.has(commandId) && !capabilities.pluginHost) {
      return PLUGINS_DESKTOP;
    }
    return null;
  }
  if (PEOPLE_COMMANDS.has(commandId)) {
    return useRelayStore.getState().info !== null ? null : RELAY;
  }
  return null;
}

/** Whether the palette offers `commandId` now: where the button for it is shown. */
export function manageCommandOffered(commandId: string): boolean {
  return manageRefusal(commandId) === null;
}

/** Says why `commandId` is refused in a toast and returns true, or returns false when offered. */
export function refuseManage(commandId: string): boolean {
  const refusal = manageRefusal(commandId);
  if (refusal) toast.info(refusal);
  return refusal !== null;
}
