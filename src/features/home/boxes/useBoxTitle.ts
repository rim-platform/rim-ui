import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useConversation } from "../../conversations/api/useConversation";
import { useHomeWorkspaces } from "../api/useHomeWorkspaces";
import type { HomeBox } from "../layout/homeLayout";
import { boxName } from "./registry";
import { readChannelSettings } from "./settings";

/**
 * What a box is called, from its settings where they name something: a channel box is
 * "#deploys in Platform", with any invisible characters of those names shown. Every other box
 * is called by its kind.
 */
export function useBoxTitle(box: HomeBox): string {
  const channel = box.kind === "channel" ? readChannelSettings(box.settings) : null;
  const { workspaces } = useHomeWorkspaces();
  const conversation = useConversation(channel?.workspaceId, channel?.conversationId);
  if (!channel) return boxName(box.kind);
  const title = conversation.data?.title;
  const name = title ? `#${title}` : "A channel";
  const workspace = workspaces.find((w) => w.id === channel.workspaceId)?.label;
  return showInvisibleCharacters(workspace ? `${name} in ${workspace}` : name);
}
