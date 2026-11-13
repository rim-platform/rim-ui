import { useJoinedChannels } from "../../conversations/api/useChannels";
import { sidebarChannels } from "../../conversations/utils";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { agentAvailable } from "../../agent/agentAvailability";
import { useCanManageBots } from "../../bots/availability";
import { useKeybindLabel } from "../../commands/hooks/useKeybindLabel";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { settingsTabCommandId } from "../../settings/settingsTabs";
import { EDIT_HOME_COMMAND_ID } from "../editHome";

/** One first thing to try: what it is called, one muted line, and the command a click runs. */
interface StartRow {
  id: string;
  title: string;
  hint: string;
  /** A keystroke shown after the hint in parentheses, hidden at phone width. */
  keystroke?: string;
  commandId: string;
  args?: Record<string, unknown>;
}

/** The command that opens the search box, which also runs commands. */
const OPEN_SEARCH_COMMAND_ID = "workspace.open_search";
/** The keystroke search has when the person has not changed it. */
const DEFAULT_SEARCH_KEYSTROKE = "Ctrl+Shift+F";
/** The command that opens the Unreads page. */
const OPEN_UNREADS_COMMAND_ID = "workspace.open_unreads";
/** The command that opens a channel, taking its `conversationId`. */
const OPEN_CHANNEL_COMMAND_ID = "workspace.navigate_to_channel";

/**
 * The rows the Getting started box offers here, in order.
 *
 * @param firstChannelId - The first channel under Channels in the workspace in view, if any.
 * @param canManageBots - Whether the person is an Owner or Moderator who is offered Bots.
 * @param desktop - Whether this is the desktop app, which has the Assistant and Agents.
 * @param searchKeystroke - The keystroke bound to search, shown on the search row.
 */
function startRows(
  firstChannelId: string | null,
  canManageBots: boolean,
  desktop: boolean,
  searchKeystroke: string,
): StartRow[] {
  const rows: StartRow[] = [];
  if (firstChannelId) {
    rows.push({
      id: "hello",
      title: "Say hello",
      hint: "Open a channel and send your first message",
      commandId: OPEN_CHANNEL_COMMAND_ID,
      args: { conversationId: firstChannelId },
    });
  }
  rows.push(
    {
      id: "search",
      title: "Search and run anything",
      hint: "One box for messages, channels and commands",
      keystroke: searchKeystroke,
      commandId: OPEN_SEARCH_COMMAND_ID,
    },
    {
      id: "unreads",
      title: "Catch up on Unreads",
      hint: "Everything you haven't read, across workspaces",
      commandId: OPEN_UNREADS_COMMAND_ID,
    },
    {
      id: "plugins",
      title: "Add a tool beside the conversation",
      hint: "Plugins show panels next to your chat",
      commandId: settingsTabCommandId("plugins"),
    },
  );
  if (canManageBots) {
    rows.push({
      id: "webhooks",
      title: "Bring alerts into a channel",
      hint: "GitHub, Grafana or any service can post through a webhook",
      commandId: settingsTabCommandId("bots"),
    });
  }
  if (desktop) {
    rows.push(
      {
        id: "assistant",
        title: "Ask the assistant",
        hint: "An AI panel with your own provider key",
        commandId: settingsTabCommandId("agent"),
      },
      {
        id: "agents",
        title: "Connect an agent",
        hint: "Let Claude Code or another program read what you choose",
        commandId: settingsTabCommandId("agents"),
      },
    );
  }
  rows.push({
    id: "home",
    title: "Make Home yours",
    hint: "Add, move and remove these boxes",
    commandId: EDIT_HOME_COMMAND_ID,
  });
  return rows;
}

/**
 * A short list of first things to try, each row a button that runs its command as the palette
 * runs it, and "I'm done with this", which takes the box off Home.
 *
 * @param onDone - Removes the box from the layout; without it the footer is left out.
 */
export function GettingStartedBody({ onDone }: { onDone?: () => void }) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const direct = useIsDirectSpace(workspaceId);
  const { data } = useJoinedChannels(workspaceId ?? undefined);
  const canManageBots = useCanManageBots(workspaceId);
  const firstChannelId = direct ? null : (sidebarChannels(data?.items ?? [])[0]?.id ?? null);
  const searchKeystroke = useKeybindLabel(OPEN_SEARCH_COMMAND_ID) ?? DEFAULT_SEARCH_KEYSTROKE;
  const rows = startRows(firstChannelId, canManageBots, agentAvailable(), searchKeystroke);

  return (
    <div className="space-y-3">
      <ul className="space-y-1" aria-label="Getting started">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => void runCommandFromClick(row.commandId, row.args)}
              className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
            >
              <span className="text-sm text-rim-text">{row.title}</span>
              <span className="text-xs text-rim-text-muted">
                {row.hint}
                {row.keystroke && <span className="max-[399px]:hidden"> ({row.keystroke})</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {onDone && (
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-rim-line px-2 py-0.5 text-xs text-rim-text-muted transition hover:text-rim-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
        >
          I&apos;m done with this
        </button>
      )}
    </div>
  );
}
