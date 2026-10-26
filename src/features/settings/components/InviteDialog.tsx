import { useId, useState } from "react";
import { Copy, Check } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { getWebBaseUrl } from "../../../core/graphql/config";
import { graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  DEFAULT_INVITE_USES,
  INVITE_EXPIRY_DAYS,
  useCreateInviteMutation,
  type InviteExpiryDays,
} from "../api/useInviteMutations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { FeatureOffNotice } from "../../updater/components/FeatureOffNotice";
import { useServerFeature } from "../../updater/hooks/useServerFeature";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { LimitNote } from "../../limits/components/LimitNote";
import { isLimitRefusal, limitView } from "../../limits/limits";

type InviteRole = ServerMemberRoleGql.MEMBER | ServerMemberRoleGql.GUEST;

const INVITE_ROLES: { role: InviteRole; label: string; hint: string }[] = [
  {
    role: ServerMemberRoleGql.MEMBER,
    label: "Member",
    hint: "Can browse and join channels, create channels and add people to conversations.",
  },
  {
    role: ServerMemberRoleGql.GUEST,
    label: "Guest",
    hint: "Only sees the conversations someone adds them to.",
  },
];

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  /** The workspace the invite is for: the open one when left out. */
  workspaceId?: string;
}

/** Basic client-side email format check — mirrors the pattern used for signup's email field. */
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Where a refused `createInvite` is explained: on the expiry or email field, else the banner. */
type InviteErrorField = { field: "expiry" | "email"; message: string } | null;

/**
 * Maps a `createInvite` `VALIDATION` error to the field it concerns. The server names
 * `expires_at` when the expiry is not in the future or more than 30 days out, which with the
 * offered lifetimes means this device's clock is off. Any other `VALIDATION` is put on the
 * email field when an address was sent, as that is the remaining user input. Returns `null`
 * for an instance cap or any other error, which the limit note or the generic banner shows.
 *
 * @param err The mutation's error.
 * @param sentEmail Whether the request carried a recipient address.
 */
function mapCreateInviteError(err: unknown, sentEmail: boolean): InviteErrorField {
  if (isLimitRefusal(err) || graphqlErrorCode(err) !== "VALIDATION") return null;
  if (graphqlErrorMessage(err, "").includes("expires_at")) {
    return {
      field: "expiry",
      message:
        "The server refused this expiry: invites expire within 30 days. Check this device's clock and try again.",
    };
  }
  if (sentEmail) {
    return { field: "email", message: "That doesn't look like a valid email address." };
  }
  return null;
}

function expiryLabel(days: InviteExpiryDays): string {
  return days === 1 ? "1 day" : `${days} days`;
}

export function InviteDialog({ open, onClose, workspaceId: target }: InviteDialogProps) {
  const openWorkspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceId = target ?? openWorkspaceId;
  const createInvite = useCreateInviteMutation();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [role, setRole] = useState<InviteRole>(ServerMemberRoleGql.MEMBER);
  const [expiresInDays, setExpiresInDays] = useState<InviteExpiryDays>(DEFAULT_INVITE_EXPIRY_DAYS);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const expirySelectId = useId();
  const email = useServerFeature("email");
  const limits = useServerInfo().limits;
  const usesCap = limits?.inviteMaxUses;
  const maxUses = usesCap != null && usesCap < DEFAULT_INVITE_USES ? usesCap : undefined;
  const dailyCap = limits?.invitesPerUserPerDay;
  // The client has no count of today's invites; a refusal for the daily cap means it is reached.
  const refusedDaily =
    isLimitRefusal(createInvite.error) &&
    graphqlErrorMessage(createInvite.error, "").includes("invites per user per day");
  const dailyLimit = limitView(
    dailyCap,
    refusedDaily ? (dailyCap ?? undefined) : undefined,
    ["invite in the last 24 hours", "invites in the last 24 hours"],
    "invites per user per day",
  );

  function handleGenerate() {
    if (!workspaceId) return;
    const trimmed = email.enabled ? recipientEmail.trim() : "";
    if (trimmed && !EMAIL_REGEX.test(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setExpiryError(null);
    createInvite.mutate(
      {
        serverId: workspaceId,
        role,
        ...(expiresInDays !== DEFAULT_INVITE_EXPIRY_DAYS ? { expiresInDays } : {}),
        ...(trimmed ? { recipientEmail: trimmed } : {}),
        ...(maxUses !== undefined ? { maxUses } : {}),
      },
      {
        onSuccess: (data) => {
          const link = `${getWebBaseUrl()}/join/${data.createInvite.inviteToken}`;
          setInviteLink(link);
          setCopied(false);
        },
        onError: (err) => {
          const mapped = mapCreateInviteError(err, Boolean(trimmed));
          if (mapped?.field === "expiry") setExpiryError(mapped.message);
          if (mapped?.field === "email") setEmailError(mapped.message);
        },
      },
    );
  }

  function handleCopy() {
    if (!inviteLink) return;
    navigator.clipboard
      .writeText(inviteLink)
      .then(() => {
        setCopied(true);
        toast.success("Invite link copied");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Couldn't copy — copy manually"));
  }

  function handleClose() {
    setInviteLink(null);
    setCopied(false);
    setRecipientEmail("");
    setEmailError(null);
    setRole(ServerMemberRoleGql.MEMBER);
    setExpiresInDays(DEFAULT_INVITE_EXPIRY_DAYS);
    setExpiryError(null);
    createInvite.reset();
    onClose();
  }

  // A field-level error or the daily cap already explains the failure; don't also show the
  // generic banner for the same error.
  const showGenericError =
    createInvite.error && !emailError && !expiryError && !(refusedDaily && dailyLimit);

  return (
    <Dialog open={open} onClose={handleClose} title="Invite member">
      <div className="space-y-4">
        {!inviteLink ? (
          <>
            <p className="text-sm text-rim-text-muted">
              Generate an invite link to share with the people you want to add to this workspace. It
              admits up to {DEFAULT_INVITE_USES} people.
            </p>
            <div>
              <p className="mb-1 text-xs font-medium text-rim-text">Joins as</p>
              <div role="radiogroup" aria-label="Joins as" className="grid grid-cols-2 gap-2">
                {INVITE_ROLES.map((option) => (
                  <button
                    key={option.role}
                    type="button"
                    role="radio"
                    aria-checked={role === option.role}
                    onClick={() => setRole(option.role)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition",
                      role === option.role
                        ? "border-rim-accent bg-rim-accent/10"
                        : "border-rim-line hover:bg-white/5",
                    )}
                  >
                    <span className="block text-sm text-rim-text">{option.label}</span>
                    <span className="block text-xs text-rim-text-muted">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor={expirySelectId}
                className="mb-1 block text-xs font-medium text-rim-text"
              >
                Expires after
              </label>
              <select
                id={expirySelectId}
                value={expiresInDays}
                onChange={(e) => {
                  setExpiresInDays(Number(e.target.value) as InviteExpiryDays);
                  setExpiryError(null);
                }}
                className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
              >
                {INVITE_EXPIRY_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {expiryLabel(days)}
                  </option>
                ))}
              </select>
              {expiryError ? (
                <p className="mt-1 text-xs text-rim-danger">{expiryError}</p>
              ) : (
                <p className="mt-1 text-xs text-rim-text-muted">
                  Every invite expires, at the latest 30 days after it is created.
                </p>
              )}
            </div>
            {email.enabled ? (
              <div>
                <label
                  htmlFor="invite-recipient-email"
                  className="mb-1 block text-xs font-medium text-rim-text"
                >
                  Email invite (optional)
                </label>
                <input
                  id="invite-recipient-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => {
                    setRecipientEmail(e.target.value);
                    setEmailError(null);
                  }}
                  placeholder="teammate@example.com"
                  className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
                />
                {emailError ? (
                  <p className="mt-1 text-xs text-rim-danger">{emailError}</p>
                ) : (
                  <p className="mt-1 text-xs text-rim-text-muted">
                    If provided, we'll email the invite link. You can still copy the link below
                    either way.
                  </p>
                )}
              </div>
            ) : (
              <FeatureOffNotice
                feature="email"
                view={email}
                message="This server can't send email invites. Generate the link and share it yourself"
                hideReason
              />
            )}
            {usesCap != null && (
              <p className="text-xs text-rim-text-muted">
                {maxUses === 1
                  ? "Each link can be used once."
                  : `Each link can be used up to ${maxUses ?? DEFAULT_INVITE_USES} times.`}
              </p>
            )}
            <LimitNote limit={dailyLimit} />
            {showGenericError && (
              <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                {graphqlErrorMessage(createInvite.error, "Failed to create invite")}
              </p>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={createInvite.isPending}
              className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
            >
              {createInvite.isPending ? "Generating..." : "Generate invite link"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-rim-text-muted">
              Share this link with the person you want to invite. It expires in{" "}
              {expiryLabel(expiresInDays)}.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-rim-text">{inviteLink}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded p-1 text-rim-text-muted transition hover:text-rim-text"
                aria-label="Copy invite link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-rim-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
