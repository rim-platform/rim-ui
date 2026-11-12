import { useEffect, useRef, type ReactNode } from "react";

import { useChannelPosting } from "../../conversations/api/useChannelPosting";
import { useConversation } from "../../conversations/api/useConversation";
import { formatSlowModeInterval } from "../../conversations/api/useSlowMode";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { roleLabel } from "../../workspaces/role";
import type { ArgumentPicker, CurrentValueSource } from "../runtime/argumentPickers";
import { humanizeValue } from "../runtime/argumentValues";
import { formConversationId, useFieldWorkspace, type ControlProps } from "./argumentControlParts";

/** An argument's current value: what its field would hold, and how it reads. */
interface CurrentValue {
  value: string;
  label: string;
}

/**
 * The current value `source` names for the form's conversation or member, or `undefined` while
 * it is not known.
 */
function useCurrentValue(
  source: CurrentValueSource,
  props: ControlProps,
  picker: ArgumentPicker,
): CurrentValue | undefined {
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const { data: conversation } = useConversation(
    source === "memberRole" ? undefined : workspaceId,
    formConversationId(props),
  );
  const posting = useChannelPosting(
    workspaceId,
    source === "postingPolicy" ? conversation : undefined,
  );
  const { data: members } = useServerMembers(source === "memberRole" ? workspaceId : undefined);
  const labelOf = (value: string) => picker.valueLabels?.[value] ?? humanizeValue(value);
  switch (source) {
    case "slowMode":
      if (!conversation) return undefined;
      return {
        value: String(conversation.slowModeSeconds),
        label:
          conversation.slowModeSeconds > 0
            ? formatSlowModeInterval(conversation.slowModeSeconds)
            : "Off",
      };
    case "notificationLevel": {
      if (!conversation) return undefined;
      const value = conversation.notificationLevel?.toLowerCase() ?? "default";
      return { value, label: labelOf(value) };
    }
    case "postingPolicy": {
      if (!posting.supported) return undefined;
      const value = posting.policy.toLowerCase();
      return { value, label: labelOf(value) };
    }
    case "memberRole": {
      const userId = props.formValues.user_id;
      const member =
        typeof userId === "string" && userId !== ""
          ? members?.find((candidate) => candidate.userId === userId)
          : undefined;
      if (!member) return undefined;
      return { value: member.memberRole.toLowerCase(), label: roleLabel(member.memberRole) };
    }
  }
}

/**
 * An ask-form field with the argument's current value: an empty field starts with it once it is
 * known, and a member's role, which follows the member picked, is shown under the field as
 * "Now: …" instead.
 */
export function WithCurrentValue({
  props,
  picker,
  source,
  children,
}: {
  props: ControlProps;
  picker: ArgumentPicker;
  source: CurrentValueSource;
  children: ReactNode;
}) {
  const current = useCurrentValue(source, props, picker);
  const startsField = source !== "memberRole";
  const started = useRef(false);
  const { value, onChange } = props;

  useEffect(() => {
    if (!startsField || started.current || current === undefined) return;
    started.current = true;
    if (value === "") onChange(current.value);
  }, [startsField, current, value, onChange]);

  return (
    <div className="space-y-1">
      {children}
      {!startsField && current && (
        <p className="text-xs text-rim-text-faint">Now: {current.label}</p>
      )}
    </div>
  );
}
