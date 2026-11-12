import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import type { ArgumentPicker } from "../runtime/argumentPickers";
import { selectEmptyLabel, selectPropsOf, type ControlProps } from "./argumentControlParts";
import { ChoiceSelect, type ChoiceOption } from "./ChoiceSelect";
import {
  useArchivedChannelTargets,
  useChannelTargets,
  useDirectTargets,
  useJoinableTargets,
  useOwnConversationTargets,
  type Targets,
} from "./paletteTargets";

const CHANNELS = [ConversationTypeEnum.CHANNEL];
const CHANNELS_AND_GROUPS = [ConversationTypeEnum.CHANNEL, ConversationTypeEnum.GROUP];

/** The options of `targets`, under `group` when one is given. */
function optionsOf(targets: Targets, group?: string): ChoiceOption[] {
  return targets.items.map((item) => ({
    value: item.id,
    label: showInvisibleCharacters(item.label),
    ...(group ? { group } : {}),
  }));
}

/** A conversation select over `options`. */
function ConversationChoice({
  props,
  options,
  isPending,
}: {
  props: ControlProps;
  options: ChoiceOption[];
  isPending: boolean;
}) {
  return (
    <ChoiceSelect
      {...selectPropsOf(props)}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={props.onChange}
      options={options}
      emptyLabel={selectEmptyLabel(
        props.argument,
        props.mode,
        isPending ? "Loading conversations…" : "Choose a conversation",
      )}
    />
  );
}

/** The workspace's channels, DMs and groups the viewer is in, as a select. */
function JoinedConversationSelect(props: ControlProps) {
  const own = useChannelTargets(props.workspaceId);
  return <ConversationChoice props={props} options={optionsOf(own)} isPending={own.isPending} />;
}

/**
 * The conversations a saved step can name: the viewer's own, then the workspace's public
 * channels the viewer has not joined, so the step can join them.
 */
function PresetConversationSelect(props: ControlProps) {
  const own = useChannelTargets(props.workspaceId);
  const joinable = useJoinableTargets(props.workspaceId);
  return (
    <ConversationChoice
      props={props}
      options={[
        ...optionsOf(own, "Your conversations"),
        ...optionsOf(joinable, "Other public channels"),
      ]}
      isPending={own.isPending || joinable.isPending}
    />
  );
}

/**
 * A conversation select: in a preset form also the public channels the viewer has not joined,
 * else the viewer's own conversations.
 */
export function ConversationSelect(props: ControlProps) {
  return props.mode === "preset" ? (
    <PresetConversationSelect {...props} />
  ) : (
    <JoinedConversationSelect {...props} />
  );
}

/** The viewer's channels. */
function OwnChannelSelect(props: ControlProps) {
  const own = useOwnConversationTargets(props.workspaceId, CHANNELS);
  return <ConversationChoice props={props} options={optionsOf(own)} isPending={own.isPending} />;
}

/** The viewer's channels, then the public channels not joined. */
function PresetChannelSelect(props: ControlProps) {
  const own = useOwnConversationTargets(props.workspaceId, CHANNELS);
  const joinable = useJoinableTargets(props.workspaceId);
  return (
    <ConversationChoice
      props={props}
      options={[
        ...optionsOf(own, "Your channels"),
        ...optionsOf(joinable, "Other public channels"),
      ]}
      isPending={own.isPending || joinable.isPending}
    />
  );
}

/** The viewer's channels and groups, without direct messages. */
function ChannelOrGroupSelect(props: ControlProps) {
  const own = useOwnConversationTargets(props.workspaceId, CHANNELS_AND_GROUPS);
  return <ConversationChoice props={props} options={optionsOf(own)} isPending={own.isPending} />;
}

/** The workspace's archived channels. */
function ArchivedChannelSelect(props: ControlProps) {
  const archived = useArchivedChannelTargets(props.workspaceId);
  return (
    <ConversationChoice
      props={props}
      options={optionsOf(archived)}
      isPending={archived.isPending}
    />
  );
}

/** The public channels the viewer has not joined. */
function JoinableChannelSelect(props: ControlProps) {
  const joinable = useJoinableTargets(props.workspaceId);
  return (
    <ConversationChoice
      props={props}
      options={optionsOf(joinable)}
      isPending={joinable.isPending}
    />
  );
}

/**
 * The public channels the viewer has not joined, then the viewer's own channels, which a saved
 * step may join again after one that leaves them.
 */
function PresetJoinableChannelSelect(props: ControlProps) {
  const joinable = useJoinableTargets(props.workspaceId);
  const own = useOwnConversationTargets(props.workspaceId, CHANNELS);
  return (
    <ConversationChoice
      props={props}
      options={[...optionsOf(joinable, "Channels to join"), ...optionsOf(own, "Your channels")]}
      isPending={own.isPending || joinable.isPending}
    />
  );
}

/** The direct messages and groups of the direct spaces, as the direct message list shows them. */
function DirectConversationSelect(props: ControlProps) {
  const direct = useDirectTargets();
  return (
    <ConversationChoice props={props} options={optionsOf(direct)} isPending={direct.isPending} />
  );
}

/**
 * A conversation select over the pool `picker.conversations` names. A preset form offers more
 * channels for some pools than the ask form, which runs at once.
 */
export function ConversationPoolSelect(props: ControlProps & { picker: ArgumentPicker }) {
  const preset = props.mode === "preset";
  switch (props.picker.conversations) {
    case "channels":
      return preset ? <PresetChannelSelect {...props} /> : <OwnChannelSelect {...props} />;
    case "channelsAndGroups":
      return <ChannelOrGroupSelect {...props} />;
    case "archivedChannels":
      return <ArchivedChannelSelect {...props} />;
    case "joinableChannels":
      return preset ? (
        <PresetJoinableChannelSelect {...props} />
      ) : (
        <JoinableChannelSelect {...props} />
      );
    case "direct":
      return <DirectConversationSelect {...props} />;
    default:
      return <ConversationSelect {...props} />;
  }
}
