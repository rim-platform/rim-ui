import type { ReactNode } from "react";

import { agentAvailable } from "../../agent/agentAvailability";
import type { AgentRun } from "../../agents/runtime/runs";
import type { NotificationItem } from "../../notifications/api/useNotifications";
import type { FailedWorkspace } from "../api/useHomeMentions";
import type { WorkspaceUnread } from "../api/useHomeUnread";
import type { WaitingRow } from "../api/useHomeWaiting";
import { AgentRunsBody, MentionsBody, UnreadBody, WaitingBody } from "../components/HomeSections";

/** What Home has loaded, which each box shows its part of. */
export interface HomeBoxData {
  waiting: readonly WaitingRow[];
  mentions: {
    items: readonly NotificationItem[];
    failed: readonly FailedWorkspace[];
    isPending: boolean;
  };
  unread: readonly WorkspaceUnread[];
  runs: readonly AgentRun[];
  /** How many workspaces Home shows, after the filter. */
  shownWorkspaces: number;
  labelOf: (workspaceId: string) => string;
  onOpenRun: (run: AgentRun) => void;
  onAllRuns: () => void;
}

/** One kind of box: what it is called, how it is offered, and what it shows. */
export interface BoxKind {
  kind: string;
  /** The box's title. */
  name: string;
  /** What Add a box says about it. */
  description: string;
  /** Why this device cannot run it, or `null` when it can. */
  unavailableReason: () => string | null;
  /** Its content comes from the servers, so it may be out of date while the home server is away. */
  fromServer: boolean;
  /** The number beside the title, or `null` for none. */
  count: (data: HomeBoxData) => number | null;
  render: (data: HomeBoxData) => ReactNode;
}

/** The kinds this app knows, in the order Add a box lists them. */
export const BOX_KINDS: readonly BoxKind[] = [
  {
    kind: "waiting",
    name: "Waiting for you",
    description: "Message requests and join requests to decide on",
    unavailableReason: () => null,
    fromServer: true,
    count: (data) => (data.waiting.length > 0 ? data.waiting.length : null),
    render: (data) => <WaitingBody rows={data.waiting} />,
  },
  {
    kind: "mentions",
    name: "Mentions and replies",
    description: "Unread mentions and replies across your workspaces",
    unavailableReason: () => null,
    fromServer: true,
    count: (data) => (data.mentions.items.length > 0 ? data.mentions.items.length : null),
    render: (data) => (
      <MentionsBody
        items={data.mentions.items}
        failed={data.mentions.failed}
        isPending={data.mentions.isPending}
        nameWorkspaces={data.shownWorkspaces > 1}
        labelOf={data.labelOf}
        hasOthers={data.shownWorkspaces > 1}
      />
    ),
  },
  {
    kind: "unread",
    name: "Unread",
    description: "Unread messages per workspace",
    unavailableReason: () => null,
    fromServer: true,
    count: (data) => {
      const total = data.unread.reduce((sum, row) => sum + row.messages, 0);
      return total > 0 ? total : null;
    },
    render: (data) => <UnreadBody rows={data.unread} />,
  },
  {
    kind: "agentRuns",
    name: "Your agents' runs",
    description: "The newest runs of the agents connected on this device",
    unavailableReason: () => (agentAvailable() ? null : "Your agents' runs needs the desktop app"),
    fromServer: false,
    count: () => null,
    render: (data) => (
      <AgentRunsBody runs={data.runs} onOpenRun={data.onOpenRun} onAllRuns={data.onAllRuns} />
    ),
  },
];

/** The kind named `kind`, or `undefined` for one this app does not know. */
export function boxKind(kind: string): BoxKind | undefined {
  return BOX_KINDS.find((entry) => entry.kind === kind);
}

/** What a box is called: its kind's name, or a plain name for a kind this app does not know. */
export function boxName(kind: string): string {
  return boxKind(kind)?.name ?? "Box from a newer version";
}
