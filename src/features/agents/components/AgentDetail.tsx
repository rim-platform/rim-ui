import { useQueryClient } from "@tanstack/react-query";

import { Button } from "../../../shared/ui/Button";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useInstalledPlugins } from "../../plugins/api/usePluginList";
import type { PluginInfo } from "../../plugins/types";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { hasGrantIn } from "../runtime/grants";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { groupRuns, plural } from "../runtime/runs";
import { useAgentRecordStore, type RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { channelLabel } from "./AgentRecordDialog";

/** Most places the list of what an agent was given shows. */
const MAX_PLACES = 8;

/** One channel an agent was handed messages from. */
interface Place {
  workspaceId: string;
  channelId: string;
  messages: number;
  /** When the last read of it was kept, ISO 8601. */
  lastAt: string;
}

/**
 * The channels the agent was handed messages from, newest read first.
 *
 * @returns Every such place, with the number of different messages it was given from there.
 */
function placesGiven(entries: readonly RecordEntry[], agentId: string): Place[] {
  const places = new Map<string, Place & { ids: Set<string> }>();
  for (const entry of entries) {
    if (entry.agentId !== agentId || entry.refused || entry.change || entry.plugin) continue;
    if (!entry.channelId || entry.messageIds.length === 0) continue;
    const key = `${entry.workspaceId}\u0000${entry.channelId}`;
    const place = places.get(key) ?? {
      workspaceId: entry.workspaceId,
      channelId: entry.channelId,
      messages: 0,
      lastAt: entry.at,
      ids: new Set<string>(),
    };
    for (const id of entry.messageIds) place.ids.add(id);
    if (Date.parse(entry.at) >= Date.parse(place.lastAt)) place.lastAt = entry.at;
    places.set(key, place);
  }
  return [...places.values()]
    .map(({ ids, ...place }) => ({ ...place, messages: ids.size }))
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** What the agent's read grants come to, in a line. */
export function grantSummary(agent: ConnectedAgent): string {
  const granted = Object.values(agent.grants ?? {});
  const everything = granted.filter((grant) => grant.all).length;
  const listed = granted
    .filter((grant) => !grant.all)
    .reduce((sum, grant) => sum + grant.channelIds.length, 0);
  const parts = [
    ...(everything > 0
      ? [`Every channel in ${plural(everything, "workspace", "workspaces")}`]
      : []),
    ...(listed > 0 ? [`${plural(listed, "channel", "channels")} granted`] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "Nothing granted";
}

/** How many approved plugin commands can run now, and how many cannot. */
function approvedCommands(
  agent: ConnectedAgent,
  plugins: PluginInfo[] | undefined,
): { current: number; stale: number } {
  let current = 0;
  let stale = 0;
  for (const [pluginId, approval] of Object.entries(agent.pluginApprovals ?? {})) {
    const plugin = plugins?.find((candidate) => candidate.plugin_id === pluginId);
    if (!plugins) {
      current += approval.commandIds.length;
    } else if (!plugin?.enabled || plugin.manifest_hash !== approval.manifestHash) {
      stale += approval.commandIds.length;
    } else {
      const offered = approval.commandIds.filter((id) =>
        plugin.commands?.some((command) => command.id === id && command.ai_callable),
      ).length;
      current += offered;
      stale += approval.commandIds.length - offered;
    }
  }
  return { current, stale };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wider text-rim-text-faint">{title}</h4>
      {children}
    </section>
  );
}

/**
 * One connected agent on one page: what it can read, what asks the person first, what stays
 * closed, which plugin commands are approved and what it has been given. Its buttons run the
 * agent commands (disconnect, choose reads, choose commands, record, runs) on this agent.
 */
export function AgentDetail({ agent }: { agent: ConnectedAgent }) {
  const qc = useQueryClient();
  const { data: servers } = useMyServers();
  const { data: plugins } = useInstalledPlugins();
  const entries = useAgentRecordStore((s) => s.entries);
  const name = showInvisibleCharacters(agent.name);
  const run = (commandId: string) => void runCommandFromClick(commandId, { agent_id: agent.id });

  const workspaceName = (id: string) =>
    showInvisibleCharacters(
      servers?.find((server) => server.id === id)?.name ?? (id || "an unknown workspace"),
    );
  const granted = Object.entries(agent.grants ?? {}).filter(([workspaceId]) =>
    hasGrantIn(agent.grants ?? {}, workspaceId),
  );
  const { current, stale } = approvedCommands(agent, plugins);
  const rimCommands = (agent.commandApprovals ?? []).length;
  const places = placesGiven(entries, agent.id);
  const shown = places.slice(0, MAX_PLACES);

  return (
    <section
      aria-label={`${name} in detail`}
      className="space-y-5 rounded-lg border border-rim-line bg-rim-panel-soft p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="break-words text-base font-semibold text-rim-agent">{name}</h3>
          <p className="text-xs text-rim-text-muted">
            Connected {new Date(agent.pairedAt).toLocaleString()}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Disconnect ${name}`}
          onClick={() => run("agents.disconnect")}
        >
          Disconnect
        </Button>
      </div>

      <p className="break-words text-sm text-rim-text-muted">
        {name} acts as you and can <span className="font-medium">do only what you can do</span>,
        further limited by what you grant below. It can ask for more, but it can never grant itself
        anything or confirm its own actions.
      </p>

      <Section title="Can read">
        {granted.length === 0 ? (
          <p className="text-sm text-rim-text-muted">Nothing yet.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {granted.map(([workspaceId, grant]) => (
                <li key={workspaceId} className="text-sm text-rim-text">
                  <div className="break-words font-medium">{workspaceName(workspaceId)}</div>
                  {grant.all ? (
                    <div className="text-xs text-rim-text-muted">Every channel you can see</div>
                  ) : (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {grant.channelIds.map((channelId) => (
                        <li
                          key={channelId}
                          className="break-all rounded-full bg-rim-void px-2 py-0.5 text-xs text-rim-text-muted"
                        >
                          {showInvisibleCharacters(channelLabel(qc, workspaceId, channelId))}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-rim-text-muted">Granted by you. No prompt on each read.</p>
          </>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Choose what ${name} can read`}
          onClick={() => run("agents.choose_reads")}
        >
          Choose what it can read
        </Button>
      </Section>

      <Section title="Asks you first">
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-rim-text">
          <li>Sending a message</li>
          <li>A plugin command that its plugin doesn&apos;t mark as read-only</li>
          <li>Every RIM command you approved for it</li>
        </ul>
        <p className="text-xs text-rim-text-muted">
          Each approval covers one call. You see the exact text or arguments, and the request ends
          after 60 seconds.
        </p>
      </Section>

      <Section title="Closed">
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-rim-text">
          <li>Channels you haven&apos;t granted</li>
          <li>Encrypted conversations, direct messages and groups</li>
          <li>Workspaces you haven&apos;t granted</li>
        </ul>
        <p className="text-xs text-rim-text-muted">
          You open channels and workspaces one at a time. Encrypted conversations stay closed.
        </p>
      </Section>

      <Section title="Commands">
        <p className="break-words text-sm text-rim-text">
          {rimCommands > 0
            ? `RIM commands: ${rimCommands} approved.`
            : `RIM commands: none approved for ${name}.`}
        </p>
        <p className="text-xs text-rim-text-muted">
          A RIM command asks you each time, and a dangerous one can only be suggested. It works only
          in channels and workspaces it has a grant for.
        </p>
        <p className="break-words text-sm text-rim-text">
          {current > 0
            ? `Plugin commands: ${current} approved.`
            : `Plugin commands: none approved.`}
          {stale > 0 &&
            ` ${stale} can't run now: their plugin changed, was removed or is turned off.`}
        </p>
        <p className="text-xs text-rim-text-muted">
          A plugin command can do anything the plugin can. A command its plugin marks as read-only
          runs without asking, and RIM can&apos;t check that mark. A dangerous command can only be
          suggested, and you run it yourself. A grant doesn&apos;t limit what a plugin that can read
          conversations reads.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Choose the commands of ${name}`}
          onClick={() => run("agents.choose_plugin_commands")}
        >
          Choose its commands
        </Button>
      </Section>

      <Section title="What it has been given">
        {shown.length === 0 ? (
          <p className="text-sm text-rim-text-muted">Nothing yet.</p>
        ) : (
          <>
            <table className="w-full text-left text-sm text-rim-text">
              <thead className="sr-only sm:not-sr-only">
                <tr className="text-xs text-rim-text-faint">
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Channel
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Messages
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Last read
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((place) => (
                  <tr
                    key={`${place.workspaceId}-${place.channelId}`}
                    className="block border-t border-rim-line py-1.5 sm:table-row"
                  >
                    <th
                      scope="row"
                      className="block break-words py-0.5 pr-3 font-normal sm:table-cell"
                    >
                      {workspaceName(place.workspaceId)} · #
                      {showInvisibleCharacters(
                        channelLabel(qc, place.workspaceId, place.channelId),
                      )}
                    </th>
                    <td className="block py-0.5 pr-3 text-xs text-rim-text-muted sm:table-cell sm:text-sm">
                      {plural(place.messages, "message", "messages")}
                    </td>
                    <td className="block py-0.5 text-xs text-rim-text-muted sm:table-cell sm:text-sm">
                      <span className="sm:hidden">Last read </span>
                      {new Date(place.lastAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {places.length > shown.length && (
              <p className="text-xs text-rim-text-muted">
                The {shown.length} most recent of {places.length} channels.
              </p>
            )}
          </>
        )}
        <p className="text-xs text-rim-text-muted">This list stays on this device.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`What ${name} was given`}
            onClick={() => run("agents.open_record")}
          >
            What it was given
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Runs of ${name}`}
            onClick={() => run("agents.open_runs")}
          >
            Its runs
          </Button>
        </div>
      </Section>

      <Section title="What RIM can't control">
        <p className="break-words text-sm text-rim-text-muted">
          Once {name} has this content, where it goes depends on {name} and the model it uses. RIM
          can&apos;t see or limit that. Taking a grant away stops new reads; it can&apos;t take back
          what was read.
        </p>
      </Section>
    </section>
  );
}

/** How many runs the record holds for the agent. */
export function runCount(entries: readonly RecordEntry[], agentId: string): number {
  return groupRuns(entries.filter((entry) => entry.agentId === agentId)).length;
}
