import { useMemo } from "react";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { personName } from "../../../shared/utils/handles";
import { useConversation } from "../../conversations/api/useConversation";
import { MemberPicker } from "../../conversations/components/MemberPicker";
import { pendingMembersOf } from "../../conversations/utils";
import { useServerBans } from "../../workspaces/api/useModeration";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { isTimeoutActive } from "../../workspaces/timeout";
import { memberIdsOf, type ArgumentPicker } from "../runtime/argumentPickers";
import {
  formConversationId,
  selectEmptyLabel,
  selectPropsOf,
  useFieldWorkspace,
  type ControlProps,
} from "./argumentControlParts";
import { ChoiceSelect } from "./ChoiceSelect";

/** Which of the workspace's members a member search offers. */
interface MemberLimits {
  /** When given, the only members offered. */
  onlyUserIds?: readonly string[];
  /** Members never offered. */
  excludeUserIds?: readonly string[];
  /** Whether bots are offered. */
  includeBots: boolean;
}

const EVERYONE: MemberLimits = { includeBots: true };

/**
 * A search over the workspace's members within `limits`. With `single` it holds one member's id;
 * else several, shown as named chips and held as their ids joined with commas.
 */
function MemberSearch({
  props,
  single,
  limits,
}: {
  props: ControlProps;
  single: boolean;
  limits: MemberLimits;
}) {
  const { value, onChange, controlId, describedBy, autoFocus, onSubmit, mode, argument } = props;
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const selected = single
    ? typeof value === "string" && value !== ""
      ? [value]
      : []
    : memberIdsOf(value);
  const optional = mode === "preset" && !argument.required;
  return (
    <div className="rounded-lg border border-rim-line bg-rim-void">
      <MemberPicker
        workspaceId={workspaceId}
        selectedUserIds={selected}
        onChange={(ids) => onChange(single ? (ids[0] ?? "") : ids.join(","))}
        onlyUserIds={limits.onlyUserIds}
        excludeUserIds={limits.excludeUserIds}
        includeBots={limits.includeBots}
        single={single}
        rowsInTabOrder={false}
        inputId={controlId}
        inputDescribedBy={describedBy}
        autoFocus={autoFocus}
        onConfirm={onSubmit}
        placeholder={optional ? "Search members (optional)" : "Search members"}
        listClassName="max-h-40"
      />
    </div>
  );
}

/** One member of the workspace, bots included, picked by searching its members. */
export function MemberField(props: ControlProps) {
  return <MemberSearch props={props} single limits={EVERYONE} />;
}

/** The conversation the form names, as far as this client knows it. */
function useFormConversation(props: ControlProps) {
  const workspaceId = useFieldWorkspace(props.workspaceId);
  return useConversation(workspaceId, formConversationId(props)).data;
}

/** The members of the form's conversation; all of the workspace's while it is not known. */
function InConversationField(props: ControlProps & { single: boolean }) {
  const conversation = useFormConversation(props);
  const memberIds = conversation?.memberIds;
  const limits = useMemo(() => ({ onlyUserIds: memberIds, includeBots: true }), [memberIds]);
  return <MemberSearch props={props} single={props.single} limits={limits} />;
}

/**
 * The members not yet in the form's conversation, nor invited to it. Bots are offered as the
 * conversation's own invite list offers them: to a moderator, for a channel.
 */
function NotInConversationField(props: ControlProps & { single: boolean }) {
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const conversation = useFormConversation(props);
  const canModerate = useCanModerate(workspaceId);
  const limits = useMemo(
    () => ({
      excludeUserIds: conversation
        ? [...conversation.memberIds, ...pendingMembersOf(conversation)]
        : undefined,
      includeBots: canModerate && conversation?.conversationType === ConversationTypeEnum.CHANNEL,
    }),
    [conversation, canModerate],
  );
  return <MemberSearch props={props} single={props.single} limits={limits} />;
}

/** The workspace's members whose timeout is in force. */
function TimedOutField(props: ControlProps & { single: boolean }) {
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const { data: members } = useServerMembers(workspaceId);
  const limits = useMemo(
    () => ({
      onlyUserIds: (members ?? [])
        .filter((m) => isTimeoutActive(m.timeoutUntil))
        .map((m) => m.userId),
      includeBots: true,
    }),
    [members],
  );
  return <MemberSearch props={props} single={props.single} limits={limits} />;
}

/** The workspace's members who are not bots. */
const PEOPLE: MemberLimits = { includeBots: false };

/**
 * The people banned from the workspace, as a select: they are not members, so a member search
 * cannot find them.
 */
function BannedSelect(props: ControlProps) {
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const { data: bans, isPending, isError } = useServerBans(workspaceId);
  const options = (bans ?? []).map((ban) => ({
    value: ban.userId,
    label: ban.user ? personName(ban.user, ban.userId, null) : "A deleted account",
  }));
  const prompt = isError
    ? "Could not load the bans"
    : isPending
      ? "Loading bans…"
      : options.length === 0
        ? "Nobody is banned"
        : "Choose a person";
  return (
    <ChoiceSelect
      {...selectPropsOf(props)}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={props.onChange}
      options={options}
      emptyLabel={selectEmptyLabel(props.argument, props.mode, prompt)}
    />
  );
}

/**
 * A field of one person or several, from the pool `picker.members` names: several for a
 * `members` picker, one for a `member` picker.
 */
export function MemberPoolField(props: ControlProps & { picker: ArgumentPicker }) {
  const single = props.picker.kind !== "members";
  switch (props.picker.members) {
    case "banned":
      return <BannedSelect {...props} />;
    case "timedOut":
      return <TimedOutField {...props} single={single} />;
    case "inConversation":
      return <InConversationField {...props} single={single} />;
    case "notInConversation":
      return <NotInConversationField {...props} single={single} />;
    case "people":
      return <MemberSearch props={props} single={single} limits={PEOPLE} />;
    default:
      return <MemberSearch props={props} single={single} limits={EVERYONE} />;
  }
}
