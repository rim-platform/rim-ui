import { useRef, useState } from "react";
import { Ban, Clock, MoreVertical, Shield, TimerOff, UserX } from "lucide-react";

import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMyServerRole } from "../api/useMyServerRole";
import {
  useBanMemberMutation,
  useClearTimeoutMutation,
  useKickMemberMutation,
  useSetMemberRoleMutation,
  useTimeoutMemberMutation,
} from "../api/useModeration";
import { assignableRoles, canTargetMember, roleLabel, type ServerMemberRoleGql } from "../role";
import {
  BAN_EXPIRY_PRESETS,
  TIMEOUT_PRESETS,
  futureIsoFromLocalInput,
  isTimeoutActive,
  isoInSeconds,
} from "../timeout";
import { ModerationDialog, ReasonField } from "./ModerationDialog";

export interface ModeratedMember {
  userId: string;
  displayName: string;
  role?: ServerMemberRoleGql | null;
  timeoutUntil?: string | null;
}

interface MemberActionsMenuProps {
  workspaceId: string;
  member: ModeratedMember;
  className?: string;
}

type PendingAction = "role" | "timeout" | "kick" | "ban" | null;

/**
 * The per-member moderation menu (member directory and conversation members panel). Renders
 * nothing unless the viewer may target this member: Owner/Moderator only, never on themselves,
 * never on the Owner, and a Moderator never on another Moderator (see `canTarget`).
 */
export function MemberActionsMenu({ workspaceId, member, className }: MemberActionsMenuProps) {
  const viewerId = useAuthStore((s) => s.session?.userId);
  const viewerRole = useMyServerRole(workspaceId);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const clearTimeoutMutation = useClearTimeoutMutation();

  if (!canTargetMember({ userId: viewerId, role: viewerRole }, member)) return null;

  const roles = assignableRoles(viewerRole, member.role);
  const name = member.displayName;
  const close = () => setPending(null);

  function open(action: Exclude<PendingAction, null>) {
    setMenuPosition(null);
    setPending(action);
  }

  function handleClearTimeout() {
    setMenuPosition(null);
    clearTimeoutMutation.mutate(
      { serverId: workspaceId, userId: member.userId },
      {
        onSuccess: () => toast.success(`Cleared ${name}'s timeout`),
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not clear the timeout")),
      },
    );
  }

  const items: DropdownMenuItem[] = [];
  if (roles.length > 0) {
    items.push({
      id: "change-role",
      label: "Change role...",
      icon: <Shield className="h-4 w-4" />,
      onSelect: () => open("role"),
    });
  }
  items.push({
    id: "timeout",
    label: "Time out...",
    icon: <Clock className="h-4 w-4" />,
    onSelect: () => open("timeout"),
  });
  if (isTimeoutActive(member.timeoutUntil)) {
    items.push({
      id: "clear-timeout",
      label: "Clear timeout",
      icon: <TimerOff className="h-4 w-4" />,
      onSelect: handleClearTimeout,
    });
  }
  items.push(
    {
      id: "kick",
      label: "Kick...",
      icon: <UserX className="h-4 w-4" />,
      danger: true,
      onSelect: () => open("kick"),
    },
    {
      id: "ban",
      label: "Ban...",
      icon: <Ban className="h-4 w-4" />,
      danger: true,
      onSelect: () => open("ban"),
    },
  );

  return (
    <>
      <button
        type="button"
        aria-label={`Moderate ${name}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuPosition({ x: rect.right - 180, y: rect.bottom + 4 });
        }}
        className={cn(
          "shrink-0 rounded p-1 text-rim-text-faint transition hover:bg-white/5 hover:text-rim-text",
          className,
        )}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {menuPosition && (
        <DropdownMenu items={items} position={menuPosition} onClose={() => setMenuPosition(null)} />
      )}

      {pending === "role" && member.role && (
        <ChangeRoleDialog
          workspaceId={workspaceId}
          member={member}
          currentRole={member.role}
          roles={roles}
          onClose={close}
        />
      )}
      {pending === "timeout" && (
        <TimeoutDialog workspaceId={workspaceId} member={member} onClose={close} />
      )}
      {pending === "kick" && (
        <KickDialog workspaceId={workspaceId} member={member} onClose={close} />
      )}
      {pending === "ban" && <BanDialog workspaceId={workspaceId} member={member} onClose={close} />}
    </>
  );
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
  currentRole,
  roles,
  onClose,
}: ActionDialogProps & { currentRole: ServerMemberRoleGql; roles: ServerMemberRoleGql[] }) {
  const [role, setRole] = useState<ServerMemberRoleGql>(roles[0]);
  const setMemberRole = useSetMemberRoleMutation();

  return (
    <ModerationDialog
      title={`Change ${member.displayName}'s role`}
      description={`${member.displayName} is currently ${roleLabel(currentRole)}.`}
      tone="warm"
      chips={["MUTATING", member.displayName]}
      confirmLabel="Change role"
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

const CUSTOM = "custom";

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
  const options = [...extraOptions, ...presets, { id: CUSTOM, label: "Custom" }];
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
      {value === CUSTOM && (
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

function TimeoutDialog({ workspaceId, member, onClose }: ActionDialogProps) {
  const [preset, setPreset] = useState(TIMEOUT_PRESETS[0].id);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const timeoutMember = useTimeoutMemberMutation();
  const confirmedUntil = useRef<string | null>(null);

  const customUntil = preset === CUSTOM ? futureIsoFromLocalInput(custom) : null;

  function computeUntil(): string | null {
    if (preset === CUSTOM) return futureIsoFromLocalInput(custom);
    const chosen = TIMEOUT_PRESETS.find((p) => p.id === preset);
    return chosen ? isoInSeconds(chosen.seconds) : null;
  }

  return (
    <ModerationDialog
      title={`Time out ${member.displayName}`}
      description={`${member.displayName} can keep reading but cannot send, react, pin, join or run commands in this workspace until the timeout ends. The server allows at most 30 days.`}
      tone="warm"
      chips={["MUTATING", member.displayName]}
      confirmLabel="Time out"
      confirmDisabled={preset === CUSTOM && !customUntil}
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
      chips={["DANGEROUS", member.displayName]}
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
    </ModerationDialog>
  );
}

const NEVER = "never";

function BanDialog({ workspaceId, member, onClose }: ActionDialogProps) {
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState(NEVER);
  const [custom, setCustom] = useState("");
  const banMember = useBanMemberMutation();

  const customExpiry = expiry === CUSTOM ? futureIsoFromLocalInput(custom) : null;

  function computeExpiry(): string | null {
    if (expiry === NEVER) return null;
    if (expiry === CUSTOM) return futureIsoFromLocalInput(custom);
    const chosen = BAN_EXPIRY_PRESETS.find((p) => p.id === expiry);
    return chosen ? isoInSeconds(chosen.seconds) : null;
  }

  return (
    <ModerationDialog
      title={`Ban ${member.displayName}?`}
      description={`${member.displayName} will be removed from the workspace and cannot rejoin, even with an invite, until the ban ends or is lifted.`}
      tone="danger"
      chips={["DANGEROUS", member.displayName]}
      confirmLabel="Ban"
      confirmDisabled={expiry === CUSTOM && !customExpiry}
      errorFallback="Could not ban the member"
      onConfirm={() =>
        banMember.mutateAsync({
          serverId: workspaceId,
          userId: member.userId,
          reason: trimmedOrNull(reason),
          expiresAt: computeExpiry(),
        })
      }
      onDone={() => {
        toast.success(`Banned ${member.displayName}`);
        onClose();
      }}
      onClose={onClose}
    >
      <ReasonField id="ban-reason" value={reason} onChange={setReason} />
      <DurationPicker
        label="Ban expires"
        presets={BAN_EXPIRY_PRESETS}
        extraOptions={[{ id: NEVER, label: "Never" }]}
        value={expiry}
        onChange={setExpiry}
        customValue={custom}
        onCustomChange={setCustom}
      />
    </ModerationDialog>
  );
}
