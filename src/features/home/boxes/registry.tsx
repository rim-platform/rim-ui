import type { ReactNode } from "react";

import { agentAvailable } from "../../agent/agentAvailability";
import { AgentSessionList } from "../../agents/components/sessions/AgentSessionList";
import type { AgentSessionRows } from "../../agents/components/sessions/useAgentSessionRows";
import type { AgentRun } from "../../agents/runtime/runs";
import type { NotificationItem } from "../../notifications/api/useNotifications";
import type { FailedWorkspace } from "../api/useHomeMentions";
import type { WorkspaceUnread } from "../api/useHomeUnread";
import type { WaitingRow } from "../api/useHomeWaiting";
import { AgentRunsBody, MentionsBody, UnreadBody, WaitingBody } from "../components/HomeSections";
import type { HomeBox } from "../layout/homeLayout";
import { ChannelBoxBody } from "./ChannelBox";
import { DirectBoxBody } from "./DirectBox";
import { QuickBoxBody } from "./QuickBox";
import {
  DEFAULT_COUNT,
  readChannelSettings,
  readDirectSettings,
  readQuickSettings,
  type ChannelSettings,
  type DirectSettings,
  type QuickSettings,
} from "./settings";

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
  /** The agent sessions of this device, running first, and how many wait for the person. */
  agentSessions: AgentSessionRows;
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
  /** Whether Home may hold more than one box of it, each with its own settings. */
  multiple: boolean;
  /**
   * For a kind with settings: whether a box's settings can be used, read as its kind reads them.
   * A kind without it has no settings.
   */
  settingsReadable?: (settings: unknown) => boolean;
  /** The settings a new box starts with; a kind with settings but none of these asks for them first. */
  defaultSettings?: () => Record<string, unknown>;
  /** The box's content; a box with settings is shown only once they can be read. */
  render: (data: HomeBoxData, box: HomeBox) => ReactNode;
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
    multiple: false,
    render: (data) => <WaitingBody rows={data.waiting} />,
  },
  {
    kind: "mentions",
    name: "Mentions and replies",
    description: "Unread mentions and replies across your workspaces",
    unavailableReason: () => null,
    fromServer: true,
    count: (data) => (data.mentions.items.length > 0 ? data.mentions.items.length : null),
    multiple: false,
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
    multiple: false,
    render: (data) => <UnreadBody rows={data.unread} />,
  },
  {
    kind: "agentRuns",
    name: "Your agents' runs",
    description: "The newest runs of the agents connected on this device",
    unavailableReason: () => (agentAvailable() ? null : "Your agents' runs needs the desktop app"),
    fromServer: false,
    count: () => null,
    multiple: false,
    render: (data) => (
      <AgentRunsBody runs={data.runs} onOpenRun={data.onOpenRun} onAllRuns={data.onAllRuns} />
    ),
  },
  {
    kind: "agentSessions",
    name: "Agent sessions",
    description: "The agents RIM started on this device, running ones first",
    unavailableReason: () => (agentAvailable() ? null : "Agent sessions needs the desktop app"),
    fromServer: false,
    count: (data) => (data.agentSessions.waiting > 0 ? data.agentSessions.waiting : null),
    multiple: false,
    render: (data) => <AgentSessionList rows={data.agentSessions.rows} />,
  },
  {
    kind: "direct",
    name: "Direct messages",
    description: "Your latest direct messages and groups",
    unavailableReason: () => null,
    fromServer: true,
    count: () => null,
    multiple: false,
    settingsReadable: (settings) => readDirectSettings(settings) !== null,
    defaultSettings: () => ({ count: DEFAULT_COUNT }),
    render: (_data, box) => (
      <DirectBoxBody settings={readDirectSettings(box.settings) as DirectSettings} />
    ),
  },
  {
    kind: "channel",
    name: "Channel",
    description: "The latest messages of a channel you pick",
    unavailableReason: () => null,
    fromServer: true,
    count: () => null,
    multiple: true,
    settingsReadable: (settings) => readChannelSettings(settings) !== null,
    render: (_data, box) => (
      <ChannelBoxBody
        boxId={box.id}
        settings={readChannelSettings(box.settings) as ChannelSettings}
      />
    ),
  },
  {
    kind: "quick",
    name: "Quick actions",
    description: "Buttons for commands you choose",
    unavailableReason: () => null,
    fromServer: false,
    count: () => null,
    multiple: true,
    settingsReadable: (settings) => readQuickSettings(settings) !== null,
    render: (_data, box) => (
      <QuickBoxBody settings={readQuickSettings(box.settings) as QuickSettings} />
    ),
  },
];

/** The kind named `kind`, or `undefined` for one this app does not know. */
export function boxKind(kind: string): BoxKind | undefined {
  return BOX_KINDS.find((entry) => entry.kind === kind);
}

/** Whether a box of a kind with settings has settings this app cannot use. */
export function settingsNeedFixing(box: HomeBox): boolean {
  const kind = boxKind(box.kind);
  return Boolean(kind?.settingsReadable && !kind.settingsReadable(box.settings));
}

/** What a box is called: its kind's name, or a plain name for a kind this app does not know. */
export function boxName(kind: string): string {
  return boxKind(kind)?.name ?? "Box from a newer version";
}
