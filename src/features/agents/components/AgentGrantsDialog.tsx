import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { BROWSE_FILTER, fetchChannels } from "../../conversations/api/useChannels";
import type { ConversationSummaryPage } from "../../conversations/types";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { useMyServers, type Server } from "../../workspaces/api/useMyServers";
import type { AgentGrants } from "../runtime/grants";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";

type Grant = AgentGrants[string];

const NO_GRANT: Grant = { all: false, channelIds: [] };

/** The channels a person can tick: those a grant could cover. */
function tickable(page: ConversationSummaryPage | undefined) {
  return (page?.items ?? []).filter((channel) => !channel.encryptedAt);
}

/** What saving keeps: no grant in a workspace not shown, or for a channel not shown. */
function grantsToSave(
  draft: AgentGrants,
  workspaces: Server[],
  lists: UseQueryResult<ConversationSummaryPage>[],
): AgentGrants {
  const grants: AgentGrants = {};
  workspaces.forEach((workspace, index) => {
    const grant = draft[workspace.id] ?? NO_GRANT;
    const page = lists[index]?.data;
    const shown = new Set(tickable(page).map((channel) => channel.id));
    const channelIds = grant.all
      ? []
      : grant.channelIds.filter((id) => page === undefined || shown.has(id));
    if (grant.all || channelIds.length > 0) grants[workspace.id] = { all: grant.all, channelIds };
  });
  return grants;
}

/** A checkbox whose label holds `children`. */
export function Check({
  checked,
  disabled = false,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm text-rim-text">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-rim-accent"
      />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}

/** Shows that a list is loading. */
export function Spinner() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center py-3">
      <Loader2 className="h-4 w-4 animate-spin text-rim-text-muted" />
    </div>
  );
}

function WorkspaceGrants({
  workspace,
  list,
  grant,
  onChange,
}: {
  workspace: Server;
  list: UseQueryResult<ConversationSummaryPage>;
  grant: Grant;
  onChange: (grant: Grant) => void;
}) {
  const headingId = `agent-grants-${workspace.id}`;
  const toggleChannel = (id: string, on: boolean) => {
    const others = grant.channelIds.filter((channelId) => channelId !== id);
    onChange({ ...grant, channelIds: on ? [...others, id] : others });
  };
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="break-words text-sm font-medium text-rim-text">
        {workspace.name}
      </h3>
      <Check checked={grant.all} onChange={(all) => onChange({ ...grant, all })}>
        All channels you can see
        <span className="block text-xs text-rim-text-muted">
          Includes private channels you&apos;re in, and channels you join later.
        </span>
      </Check>
      {list.isPending && <Spinner />}
      {list.isError && (
        <p role="alert" className="px-2 py-1.5 text-xs text-rim-danger">
          Could not load this workspace&apos;s channels
        </p>
      )}
      {tickable(list.data).map((channel) => (
        <Check
          key={channel.id}
          checked={grant.all || grant.channelIds.includes(channel.id)}
          disabled={grant.all}
          onChange={(on) => toggleChannel(channel.id, on)}
        >
          {channel.title ?? channel.id}{" "}
          {channel.isPrivate && (
            <span className="ml-2 text-xs text-rim-text-muted">private channel</span>
          )}
        </Check>
      ))}
      {list.data?.pageInfo.hasNext && (
        <p className="px-2 py-1.5 text-xs text-rim-text-muted">
          Only the first {list.data.items.length} channels are listed here. All channels you can see
          also covers the rest.
        </p>
      )}
    </section>
  );
}

/** Chooses what one agent may read. Nothing is applied until it is saved. */
export function AgentGrantsDialog({
  agent,
  onClose,
}: {
  agent: ConnectedAgent;
  onClose: () => void;
}) {
  const setGrants = useConnectedAgentsStore((s) => s.setGrants);
  const [draft, setDraft] = useState<AgentGrants>(() => agent.grants ?? {});
  const servers = useMyServers();
  const workspaces = (servers.data ?? []).filter((server) => !isDirectSpace(server.id));
  const lists = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: ["agents", "channels", workspace.id],
      staleTime: 30_000,
      queryFn: () => fetchChannels(workspace.id, BROWSE_FILTER),
    })),
  });

  const save = () => {
    setGrants(agent.id, grantsToSave(draft, workspaces, lists));
    onClose();
  };

  return (
    <Dialog open title={`What can ${agent.name} read?`} maxWidth="max-w-lg" onClose={onClose}>
      <p className="text-sm text-rim-text-muted">
        Everything starts off. Reads don&apos;t prompt after this, and you can change this at any
        time.
      </p>
      <div className="mt-3 max-h-[50vh] space-y-4 overflow-y-auto">
        {servers.isPending && <Spinner />}
        {servers.isError && (
          <p role="alert" className="text-sm text-rim-danger">
            Could not load your workspaces
          </p>
        )}
        {servers.isSuccess && workspaces.length === 0 && (
          <p className="text-sm text-rim-text-muted">You have no workspaces yet.</p>
        )}
        {workspaces.map((workspace, index) => (
          <WorkspaceGrants
            key={workspace.id}
            workspace={workspace}
            list={lists[index]}
            grant={draft[workspace.id] ?? NO_GRANT}
            onChange={(grant) => setDraft({ ...draft, [workspace.id]: grant })}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-rim-text-muted">
        Encrypted conversations, direct messages and groups stay closed. Agents can&apos;t read
        them.
      </p>
      <p className="mt-1 text-xs text-rim-text-muted">
        What it reads goes to the model provider it uses. Once it has the content, RIM can&apos;t
        see or limit where it goes next.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!servers.isSuccess} onClick={save}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}
