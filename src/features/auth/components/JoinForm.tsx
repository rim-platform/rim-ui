/**
 * `JoinForm` — registration form used on `/join/:token` and `/join` (no invite link).
 *
 * Handles three variants via the `variant` prop:
 * - `"WORKSPACE"`: header shows workspace name, copy says "Create your account."
 * - `"INSTANCE"`: header says "Create your RIM account." No workspace name. Routes via `instanceInviteToken`.
 * - `"CODE"`: same as INSTANCE copy, with an "Invite code" field (`InviteCodeField`) that takes
 *   the bare token or a whole invite link: required on an invite-only server, optional
 *   otherwise. The checked code routes to `workspaceInviteToken` or `instanceInviteToken` by its
 *   type.
 *
 * An open server (`registrationMode` `OPEN`) takes no token at signup, whichever variant: there
 * the signup sends none, a workspace invite, from a link or a code, is accepted with
 * `joinServerByInvite` once the account exists, and an instance invite is not needed. A failure
 * of that join says the account is ready and lets the person go on without the workspace.
 *
 * The server's instance notice shows at the top, its abuse contact at the bottom. When the server
 * has terms of service, the signup asks for "I accept the terms of use" and sends the terms URL
 * back as `acceptedTermsUrl`; when it has a minimum age, it asks for "I am at least N" and sends
 * N back as `confirmedMinimumAge`. A server that says it is full (`serverInfo.registrationFull`)
 * gets "This server is full" instead of the signup, and a signup it refuses as full
 * (`REGISTRATION_FULL`) says the same.
 *
 * The signup is the key signup (`KeySignupForm`): an account created from an identity key kept
 * on this device and an OPAQUE password. Where this app cannot create keys it says so in place
 * of the form.
 *
 * Props:
 * - `variant` — token type discriminator; controls header copy and mutation input.
 * - `token` — raw token string (`null` for the `CODE` variant).
 * - `registrationMode` — the server's registration mode, for the `CODE` variant's field.
 * - `workspaceName` — workspace name shown in the header when `variant === "WORKSPACE"`.
 * - `workspaceId` — the invite's workspace, from its preview, when `variant === "WORKSPACE"`.
 * - `invitedBy`, `ownerName` — who invited and who owns the workspace, from its preview.
 * - `onSuccess(userId, serverId?)` — called after successful signup.
 */

import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useInviteCode } from "../api/useInviteCode";
import { useJoinServerMutation } from "../../workspaces/api/useJoinServer";
import { InstanceNotice } from "../../updater/components/InstanceNotice";
import { InviteTokenType, RegistrationMode } from "../types";
import { Button } from "../../../shared/ui/Button";
import { InviteByline } from "./InviteByline";
import { InviteCodeField } from "./InviteCodeField";
import { KeySignupForm, type KeySignupTokens } from "./KeySignupForm";
import { BrandHeading } from "./BrandHeading";
import { ServerChoice } from "./ServerChoice";
import { AbuseContact } from "./AbuseContact";
import { RegistrationFullNotice } from "./RegistrationFullNotice";
import { NoKeysHere } from "./NoKeysHere";

type JoinFormVariant = InviteTokenType | "CODE";

interface JoinFormProps {
  /**
   * Which registration path this form represents.
   * - `WORKSPACE` — workspace invite token, shows workspace name.
   * - `INSTANCE` — instance invite token; routes via `instanceInviteToken`.
   * - `CODE` — no invite link; the form asks for an invite code.
   */
  variant: JoinFormVariant;
  /** Raw invite token. `null` for the `CODE` variant. */
  token: string | null;
  /**
   * The server's registration mode: the `CODE` variant's field follows it, and on an `OPEN`
   * server no variant sends a token with the signup.
   */
  registrationMode?: RegistrationMode;
  /** Workspace name shown in the header when `variant === "WORKSPACE"`. */
  workspaceName?: string;
  /** The invite's workspace, from its preview, when `variant === "WORKSPACE"`. */
  workspaceId?: string;
  /** Who sent the workspace invite, from its preview. */
  invitedBy?: string;
  /** The invite's workspace owner, from its preview; null when it has none. */
  ownerName?: string | null;
  /**
   * Called on successful signup.
   * @param userId - The new user's ID.
   * @param serverId - Present only for workspace invite tokens.
   */
  onSuccess: (userId: string, serverId: string | null) => void;
}

/**
 * The token field a signup sends for an invite link's variant: exactly one for a token variant,
 * none for `CODE`, whose field gives its own.
 *   - `WORKSPACE` → `workspaceInviteToken`
 *   - `INSTANCE`  → `instanceInviteToken`
 */
function tokenFields(variant: JoinFormVariant, token: string | null): KeySignupTokens {
  if (!token) return {};
  if (variant === InviteTokenType.WORKSPACE) return { workspaceInviteToken: token };
  if (variant === InviteTokenType.INSTANCE) return { instanceInviteToken: token };
  return {};
}

/** Returns the header copy for the given variant. */
function headerCopy(variant: JoinFormVariant, workspaceName?: string): string {
  if (variant === InviteTokenType.WORKSPACE && workspaceName) {
    return `You're joining ${workspaceName}`;
  }
  // INSTANCE and CODE show the same default copy.
  return "Create your RIM account";
}

/**
 * Signup form for all registration paths (invite token + open registration).
 */
export function JoinForm({
  variant,
  token,
  workspaceName,
  workspaceId,
  invitedBy,
  ownerName,
  registrationMode,
  onSuccess,
}: JoinFormProps) {
  const { capabilities, deviceKeyStore } = useRuntime();
  const { info } = useServerInfo();
  const full = info?.registrationFull === true;
  const probingKeys = !capabilities.identityKeys && deviceKeyStore === "checking";
  // A key signup in progress keeps its form mounted until it settles.
  const [keySignupBusy, setKeySignupBusy] = useState(false);
  const byCode = variant === "CODE";
  const invite = useInviteCode(registrationMode);
  const join = useJoinServerMutation();
  // The new account while its invite's workspace is joined, and why that failed, if it did.
  const [joining, setJoining] = useState<{ userId: string; error: string | null } | null>(null);
  const openServer = registrationMode === RegistrationMode.OPEN;
  const signupTokens = byCode ? invite.tokens : openServer ? {} : tokenFields(variant, token);
  // The workspace invite to accept once the account exists, where the signup could not take it.
  const joinAfter = byCode
    ? invite.joinAfter
    : openServer && variant === InviteTokenType.WORKSPACE
      ? token
      : null;
  const signupWorkspaceId = signupTokens.workspaceInviteToken
    ? byCode
      ? invite.workspaceId
      : workspaceId
    : undefined;
  const inviteReady = !byCode || invite.ready;
  const invitedWorkspace =
    (byCode ? invite.preview?.workspace?.serverName : workspaceName) ?? "the workspace";

  /**
   * Opens the new account, joining the invite's workspace first where the signup could not take
   * the invite.
   */
  function signedUp(userId: string, serverId: string | null) {
    const joinToken = joinAfter;
    if (!joinToken) {
      onSuccess(userId, serverId);
      return;
    }
    setJoining({ userId, error: null });
    join.mutate(joinToken, {
      onSuccess: (data) => onSuccess(userId, data.joinServerByInvite.serverId),
      onError: (err) =>
        setJoining({ userId, error: graphqlErrorMessage(err, "Could not join the workspace.") }),
    });
  }

  /** Offers a failed signup to the invite code field, which shows a refused token itself. */
  function inviteRefused(err: unknown): boolean {
    return byCode && invite.noteRefusal(err);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <InstanceNotice />

        <header className="text-center">
          <BrandHeading />
          <p className="mt-1 text-sm text-rim-text-muted">{headerCopy(variant, workspaceName)}</p>
          {variant === InviteTokenType.WORKSPACE && workspaceName && (
            <>
              <InviteByline invitedBy={invitedBy} ownerName={ownerName} />
              <p className="mt-1 text-sm text-rim-text-faint">Create your account.</p>
            </>
          )}
        </header>

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          {joining ? (
            joining.error ? (
              <div role="alert" className="space-y-3 text-sm">
                <p className="font-medium text-rim-text">Your account is ready</p>
                <p className="text-rim-danger">
                  It could not join {invitedWorkspace}: {joining.error}
                </p>
                <p className="text-rim-text-muted">
                  Continue to the app and join with the invite link or code from there.
                </p>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => onSuccess(joining.userId, null)}
                >
                  Continue
                </Button>
              </div>
            ) : (
              <p role="status" className="text-sm text-rim-text-muted">
                Your account is ready. Joining {invitedWorkspace}...
              </p>
            )
          ) : full ? (
            <RegistrationFullNotice />
          ) : probingKeys ? (
            <p className="text-sm text-rim-text-muted">Loading...</p>
          ) : !capabilities.identityKeys ? (
            <NoKeysHere />
          ) : (
            <div className="space-y-4">
              {byCode && (
                <InviteCodeField invite={invite} mode={registrationMode} disabled={keySignupBusy} />
              )}
              <KeySignupForm
                tokens={signupTokens}
                workspaceId={signupWorkspaceId}
                onSuccess={signedUp}
                onBusyChange={setKeySignupBusy}
                ready={inviteReady}
                onFailure={inviteRefused}
              />
            </div>
          )}
        </div>

        <AbuseContact />

        <ServerChoice />
      </div>
    </div>
  );
}
