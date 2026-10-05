import { useState } from "react";
import { Copy, Check } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { useCreateInviteMutation } from "../api/useInviteMutations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";

type InviteRole = ServerMemberRoleGql.MEMBER | ServerMemberRoleGql.GUEST;

const INVITE_ROLES: { role: InviteRole; label: string; hint: string }[] = [
  {
    role: ServerMemberRoleGql.MEMBER,
    label: "Member",
    hint: "Can browse and join channels, create channels and invite people.",
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
}

/** Basic client-side email format check — mirrors the pattern used for signup's email field. */
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Maps a `createInvite` GraphQL error to a field-level message.
 *
 * The only user-supplied, validatable field on `CreateInviteInput` is
 * `recipientEmail` (Track B3) — `serverId`/`maxUses` aren't user input here —
 * so a backend `VALIDATION` error on this mutation always means the email
 * address was rejected server-side (e.g. passed client validation but failed
 * a stricter server check). Returns `null` for any other error shape, which
 * falls back to the generic error banner.
 */
function mapCreateInviteError(err: unknown): string | null {
  if (err && typeof err === "object") {
    const e = err as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
    const code = e.response?.errors?.[0]?.extensions?.code;
    if (code === "VALIDATION") {
      return "That doesn't look like a valid email address.";
    }
  }
  return null;
}

export function InviteDialog({ open, onClose }: InviteDialogProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const createInvite = useCreateInviteMutation();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [role, setRole] = useState<InviteRole>(ServerMemberRoleGql.MEMBER);

  function handleGenerate() {
    if (!workspaceId) return;
    const trimmed = recipientEmail.trim();
    if (trimmed && !EMAIL_REGEX.test(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    createInvite.mutate(
      { serverId: workspaceId, role, ...(trimmed ? { recipientEmail: trimmed } : {}) },
      {
        onSuccess: (data) => {
          const link = `${window.location.origin}/join/${data.createInvite.inviteToken}`;
          setInviteLink(link);
          setCopied(false);
        },
        onError: (err) => {
          const mapped = mapCreateInviteError(err);
          if (mapped) setEmailError(mapped);
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
    createInvite.reset();
    onClose();
  }

  // A field-level email error already explains the failure; don't also show
  // the generic banner for the same error.
  const showGenericError = createInvite.error && !emailError;

  return (
    <Dialog open={open} onClose={handleClose} title="Invite member">
      <div className="space-y-4">
        {!inviteLink ? (
          <>
            <p className="text-sm text-rim-text-muted">
              Generate a one-time invite link to share with someone you want to add to this
              workspace.
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
                  If provided, we'll email the invite link. You can still copy the link below either
                  way.
                </p>
              )}
            </div>
            {showGenericError && (
              <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                {createInvite.error instanceof Error
                  ? createInvite.error.message
                  : "Failed to create invite"}
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
              Share this link with the person you want to invite:
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
