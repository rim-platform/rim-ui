import { registerListChannelsTool } from "./listChannels";
import { registerListMembersTool } from "./listMembers";
import { registerSearchMessagesTool } from "./searchMessages";
import { registerGetRecentMessagesTool } from "./getRecentMessages";
import { registerGetCurrentContextTool } from "./getCurrentContext";
import {
  registerNavigateToChannelTool,
  registerOpenThreadTool,
  registerSwitchWorkspaceTool,
  registerOpenSettingsTool,
} from "./navigateActions";

export function registerBuiltinTools(): void {
  // Read tools
  registerListChannelsTool();
  registerListMembersTool();
  registerSearchMessagesTool();
  registerGetRecentMessagesTool();
  registerGetCurrentContextTool();

  // Action tools
  registerNavigateToChannelTool();
  registerOpenThreadTool();
  registerSwitchWorkspaceTool();
  registerOpenSettingsTool();
}
