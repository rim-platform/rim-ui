import { useRef, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { formatTime } from "../../../shared/utils/formatTime";
import { DELETE_MEMBER_MESSAGES, hasCapability } from "../../updater/api/serverCapabilities";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useMyServerRole } from "../api/useMyServerRole";
import {
  useBanMemberMutation,
  useKickMemberMutation,
  useSetMemberRoleMutation,
  useTimeoutMemberMutation,
  type MemberMessagesDeleted,
} from "../api/useModeration";
import { useMemberMessageDeletion } from "../hooks/useMemberMessageDeletion";
import { countOf, deletedText } from "../memberMessages";
import { assignableRoles, roleLabel, type ServerMemberRoleGql } from "../role";
import {
  BAN_EXPIRY_PRESETS,
  TIMEOUT_PRESETS,
  futureIsoFromLocalInput,
  isoInSeconds,
} from "../timeout";
import { DeleteMessagesFields } from "./DeleteMessagesFields";
import { ModerationDialog, ReasonField } from "./ModerationDialog";

export interface ModeratedMember {
  userId: string;
  displayName: string;
  role?: ServerMemberRoleGql | null;
  timeoutUntil?: string | null;
  /** Whether the person has left the workspace; their role is then unknown. */
  isFormerMember?: boolean;
}

/** The duration choice of the timeout dialog that reveals a date and time input. */
export const CUSTOM_DURATION = "custom";

/**
 * A moderation action waiting for its confirmation: the role the menu picked, or the timeout
 * preset (a `TIMEOUT_PRESETS` id or {@link CUSTOM_DURATION}).
 */
export type MemberModeration =
  | { action: "role"; member: ModeratedMember; role: ServerMemberRoleGql }
  | { action: "timeout"; member: ModeratedMember; preset: string }
  | { action: "kick"; member: ModeratedMember }
  | { action: "ban"; member: ModeratedMember }
  | { action: "delete-messages"; member: ModeratedMember };

/**
 * The confirmation dialog of a moderation action on a member, with the menu's choice already
 * made: change role, time out, kick, ban or delete their messages. The server re-checks that the
 * viewer may act.
 */
export function MemberModerationDialog({
  workspaceId,
  moderation,
  onClose,
}: {
  workspaceId: string;
  moderation: MemberModeration;
  onClose: () => void;
}) {
  const { member } = moderation;
  switch (moderation.action) {
    case "role":
      return (
        <ChangeRoleDialog
          workspaceId={workspaceId}
          member={member}
          initialRole={moderation.role}
          onClose={onClose}
        />
      );
    case "timeout":
      return (
        <TimeoutDialog
          workspaceId={workspaceId}
          member={member}
          initialPreset={moderation.preset}
          onClose={onClose}
        />
      );
    case "kick":
      return <KickDialog workspaceId={workspaceId} member={member} onClose={onClose} />;
    case "ban":
      return <BanDialog workspaceId={workspaceId} member={member} onClose={onClose} />;
    case "delete-messages":
      return <DeleteMessagesDialog workspaceId={workspaceId} member={member} onClose={onClose} />;
  }
}

interface ActionDialogProps {
  workspaceId: string;
  member: ModeratedMember;
  onClose: () => void;
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function ChangeRoleDialog({
  workspaceId,
  member,
  initialRole,
  onClose,
}: ActionDialogProps & { initialRole: ServerMemberRoleGql }) {
  const viewerRole = useMyServerRole(workspaceId);
  const roles = assignableRoles(viewerRole, member.role);
  const [role, setRole] = useState<ServerMemberRoleGql>(initialRole);
  const setMemberRole = useSetMemberRoleMutation();

  return (
    <ModerationDialog
      title={`Change ${member.displayName}'s role`}
      description={
        member.role ? `${member.displayName} is currently ${roleLabel(member.role)}.` : undefined
      }
      tone="warm"
      confirmLabel="Change role"
      confirmDisabled={!roles.includes(role)}
      errorFallback="Could not change the role"
      onConfirm={() =>
        setMemberRole.mutateAsync({ serverId: workspaceId, userId: member.userId, role })
      }
      onDone={() => {
        toast.success(`${member.displayName} is now ${roleLabel(role)}`);
        onClose();
      }}
      onClose={onClose}
    >
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-medium text-rim-text">New role</legend>
        {roles.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-rim-text hover:bg-white/5"
          >
            <input
              type="radio"
              name="member-role"
              value={option}
              checked={role === option}
              onChange={() => setRole(option)}
              className="accent-rim-accent"
            />
            {roleLabel(option)}
          </label>
        ))}
      </fieldset>
    </ModerationDialog>
  );
}

/** Segmented preset picker with a "Custom" option revealing a date-time input. */
function DurationPicker({
  label,
  presets,
  value,
  onChange,
  customValue,
  onCustomChange,
  extraOptions = [],
}: {
  label: string;
  presets: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  extraOptions?: { id: string; label: string }[];
}) {
  const options = [...extraOptions, ...presets, { id: CUSTOM_DURATION, label: "Custom" }];
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-rim-text">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-lg border px-2 py-1 text-xs transition",
              value === option.id
                ? "border-rim-accent bg-rim-accent/10 text-rim-accent"
                : "border-rim-line text-rim-text-muted hover:text-rim-text",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {value === CUSTOM_DURATION && (
        <input
          type="datetime-local"
          aria-label={`${label}: custom date and time`}
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          className="mt-2 w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      )}
    </div>
  );
}

function TimeoutDialog({
  workspaceId,
  member,
  initialPreset,
  onClose,
}: ActionDialogProps & { initialPreset: string }) {
  const [preset, setPreset] = useState(initialPreset);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const timeoutMember = useTimeoutMemberMutation();
  const confirmedUntil = useRef<string | null>(null);

  const customUntil = preset === CUSTOM_DURATION ? futureIsoFromLocalInput(custom) : null;

  function computeUntil(): string | null {
    if (preset === CUSTOM_DURATION) return futureIsoFromLocalInput(custom);
    const chosen = TIMEOUT_PRESETS.find((p) => p.id === preset);
    return chosen ? isoInSeconds(chosen.seconds) : null;
  }

  return (
    <ModerationDialog
      title={`Time out ${member.displayName}`}
      description={`${member.displayName} can keep reading but cannot send, react, pin, join or run commands in this workspace until the timeout ends. The server allows at most 30 days.`}
      tone="warm"
      confirmLabel="Time out"
      confirmDisabled={preset === CUSTOM_DURATION && !customUntil}
      errorFallback="Could not time the member out"
      onConfirm={async () => {
        const until = computeUntil();
        if (!until) throw new Error("Pick a time in the future");
        const res = await timeoutMember.mutateAsync({
          serverId: workspaceId,
          userId: member.userId,
          until,
          reason: trimmedOrNull(reason),
        });
        confirmedUntil.current = res.timeoutMember.until;
      }}
      onDone={() => {
        const until = confirmedUntil.current;
        toast.success(
          until
            ? `${member.displayName} is timed out until ${formatTime(until)}`
            : `${member.displayName} is timed out`,
        );
        onClose();
      }}
      onClose={onClose}
    >
      <DurationPicker
        label="Duration"
        presets={TIMEOUT_PRESETS}
        value={preset}
        onChange={setPreset}
        customValue={custom}
        onCustomChange={setCustom}
      />
      <ReasonField id="timeout-reason" value={reason} onChange={setReason} />
    </ModerationDialog>
  );
}

function KickDialog({ workspaceId, member, onClose }: ActionDialogProps) {
  const [reason, setReason] = useState("");
  const kickMember = useKickMemberMutation();

  return (
    <ModerationDialog
      title={`Kick ${member.displayName}?`}
      description={`${member.displayName} will be removed from the workspace and from every conversation in it. They can rejoin with a new invite.`}
      tone="danger"
      confirmLabel="Kick"
      errorFallback="Could not kick the member"
      onConfirm={() =>
        kickMember.mutateAsync({
          serverId: workspaceId,
          userId: member.userId,
          reason: trimmedOrNull(reason),
        })
      }
      onDone={() => {
        toast.success(`Kicked ${member.displayName}`);
        onClose();
      }}
      onClose={onClose}
    >
      <ReasonField id="kick-reason" value={reason} onChange={setReason} />
      <p className="text-xs text-rim-text-muted">The member will see this reason.</p>
    </ModerationDialog>
  );
}

const NEVER = "never";

function BanDialog({ workspaceId, member, onClose }: ActionDialogProps) {
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState(NEVER);
  const [custom, setCustom] = useState("");
  const banMember = useBanMemberMutation();
  const offersDeletion = hasCapability(useServerInfo().info, DELETE_MEMBER_MESSAGES);
  const deletion = useMemberMessageDeletion(workspaceId, member.userId, "none");
  const deleted = useRef<MemberMessagesDeleted | null>(null);
  const deleteError = useRef<unknown>(null);

  const customExpiry = expiry === CUSTOM_DURATION ? futureIsoFromLocalInput(custom) : null;

  function computeExpiry(): string | null {
    if (expiry === NEVER) return null;
    if (expiry === CUSTOM_DURATION) return futureIsoFromLocalInput(custom);
    const chosen = BAN_EXPIRY_PRESETS.find((p) => p.id === expiry);
    return chosen ? isoInSeconds(chosen.seconds) : null;
  }

  return (
    <ModerationDialog
      title={`Ban ${member.displayName}?`}
      description={`${member.displayName} will be removed from the workspace and cannot rejoin, even with an invite, until the ban ends or is lifted.`}
      tone="danger"
      confirmLabel={
        deletion.total > 0 ? `Ban and delete ${countOf(deletion.total, "message")}` : "Ban"
      }
      confirmDisabled={(expiry === CUSTOM_DURATION && !customExpiry) || !deletion.ready}
      errorFallback="Could not ban the member"
      onConfirm={async () => {
        deleted.current = null;
        deleteError.current = null;
        await banMember.mutateAsync({
          serverId: workspaceId,
          userId: member.userId,
          reason: trimmedOrNull(reason),
          expiresAt: computeExpiry(),
        });
        if (deletion.total === 0) return;
        // A ban that went through never offers Retry: a failed delete is reported on its own.
        try {
          deleted.current = await deletion.run();
        } catch (err) {
          deleteError.current = err;
        }
      }}
      onDone={() => {
        if (deleteError.current) {
          toast.error(
            `Banned ${member.displayName}, but deleting their messages failed: ${graphqlErrorMessage(deleteError.current, "the server refused")}`,
          );
        } else {
          toast.success(`Banned ${member.displayName}`);
          if (deleted.current) toast.success(deletedText(deleted.current));
        }
        onClose();
      }}
      onClose={onClose}
    >
      <ReasonField id="ban-reason" value={reason} onChange={setReason} />
      <p className="text-xs text-rim-text-muted">The member will see this reason.</p>
      <DurationPicker
        label="Ban expires"
        presets={BAN_EXPIRY_PRESETS}
        extraOptions={[{ id: NEVER, label: "Never" }]}
        value={expiry}
        onChange={setExpiry}
        customValue={custom}
        onCustomChange={setCustom}
      />
      {offersDeletion && (
        <DeleteMessagesFields deletion={deletion} legend="Delete their messages from:" offerNone />
      )}
    </ModerationDialog>
  );
}

/** Deletes a person's messages over a chosen period, starting on the last hour. */
function DeleteMessagesDialog({ workspaceId, member, onClose }: ActionDialogProps) {
  const deletion = useMemberMessageDeletion(workspaceId, member.userId, "1h");
  const result = useRef<MemberMessagesDeleted | null>(null);

  return (
    <ModerationDialog
      title={`Delete ${member.displayName}'s messages?`}
      description={`${member.displayName}'s messages in this workspace's channels, thread replies included, are deleted for everyone. Direct messages, groups, and encrypted or archived channels are left alone.`}
      tone="danger"
      confirmLabel={
        deletion.total > 0 ? `Delete ${countOf(deletion.total, "message")}` : "Delete messages"
      }
      confirmDisabled={deletion.total === 0}
      errorFallback="Could not delete the messages"
      onConfirm={async () => {
        result.current = await deletion.run();
      }}
      onDone={() => {
        if (result.current) toast.success(deletedText(result.current));
        onClose();
      }}
      onClose={onClose}
    >
      <DeleteMessagesFields deletion={deletion} legend="Delete messages from:" offerNone={false} />
    </ModerationDialog>
  );
}
