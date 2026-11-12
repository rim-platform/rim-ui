import { X } from "lucide-react";

import { Button } from "../../../../shared/ui/Button";
import { useConversation } from "../../../conversations/api/useConversation";
import { askChipLabel } from "../../runtime/askContext";
import { grantMayCover } from "../../runtime/grants";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { useAgentProgramsStore } from "../../state/useAgentProgramsStore";
import {
  dismissRefusal,
  grantRefusedChannel,
  removeAbout,
  useAskAgentStore,
  type RefusedChannel,
} from "../../state/useAskAgentStore";
import { useConnectedAgentsStore } from "../../state/useConnectedAgentsStore";

/** What the next prompt of the session is about, with a button that takes it off. */
export function AboutChip({ sessionKey }: { sessionKey: string }) {
  const subject = useAskAgentStore((s) => s.about[sessionKey]);
  if (!subject) return null;
  return (
    <div className="flex">
      <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-rim-accent/30 bg-rim-panel-soft py-0.5 pl-2.5 pr-1 text-xs text-rim-text">
        <span className="truncate">{showInvisibleCharacters(askChipLabel(subject))}</span>
        <button
          type="button"
          aria-label="Remove what this prompt is about"
          onClick={() => removeAbout(sessionKey)}
          className="rounded-full p-0.5 text-rim-text-muted hover:text-rim-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

/** One refused channel: who asked, and the grant it lacks. Gone once a grant covers it. */
function RefusalCard({
  sessionKey,
  channel,
  agentName,
  agentId,
}: {
  sessionKey: string;
  channel: RefusedChannel;
  agentName: string;
  agentId: string | null;
}) {
  const { data } = useConversation(channel.workspaceId, channel.conversationId);
  const covered = useConnectedAgentsStore((s) => {
    const agent = s.agents.find((item) => item.id === agentId);
    return grantMayCover(agent?.grants ?? {}, channel.workspaceId, channel.conversationId);
  });
  if (covered) return null;
  const channelName = data?.title ?? "this channel";
  const shown = data?.title ? `#${showInvisibleCharacters(data.title)}` : "this channel";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rim-warm/30 bg-rim-panel px-3 py-2">
      <p className="min-w-0 flex-[1_1_16rem] text-sm text-rim-text">
        {agentName} asked to read {shown}, which it can&apos;t read.
      </p>
      <Button
        type="button"
        size="sm"
        onClick={() => grantRefusedChannel(sessionKey, channel, channelName)}
      >
        Let it read {shown}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => dismissRefusal(sessionKey, channel)}
      >
        Dismiss
      </Button>
    </div>
  );
}

/** The channels RIM's tools refused this session's agent for want of a grant. */
export function RefusalCards({
  sessionKey,
  profileId,
  agentName,
}: {
  sessionKey: string;
  profileId: string | null;
  agentName: string;
}) {
  const refused = useAskAgentStore((s) => s.refused[sessionKey]);
  const agentId = useAgentProgramsStore(
    (s) => s.profiles.find((profile) => profile.id === profileId)?.agentId ?? null,
  );
  if (!refused || refused.length === 0) return null;
  return (
    <div
      aria-label="Channels it couldn't read"
      className="shrink-0 space-y-2 border-t border-rim-line px-4 py-3"
    >
      <div className="mx-auto max-w-3xl space-y-2">
        {refused.map((channel) => (
          <RefusalCard
            key={`${channel.workspaceId}/${channel.conversationId}`}
            sessionKey={sessionKey}
            channel={channel}
            agentName={agentName}
            agentId={agentId}
          />
        ))}
      </div>
    </div>
  );
}
