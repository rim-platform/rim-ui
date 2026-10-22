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
 * has terms of service, both signups ask for "I accept the terms of use" and send the terms URL
 * back as `acceptedTermsUrl`; when it has a minimum age, both ask for "I am at least N" and send
 * N back as `confirmedMinimumAge`. A server that says it is full (`serverInfo.registrationFull`)
 * gets "This server is full" instead of either signup, and a signup it refuses as full
 * (`REGISTRATION_FULL`) says the same.
 *
 * Where this app can hold an identity key it offers "Create account with a key"
 * (`KeySignupForm`) first: an account with no password and no email, signed in by a key kept on
 * this device. With `keyOnly` (a relay in pow mode, no token), or when the server takes key
 * signups only (`serverInfo.signupRequiresKeys`), it offers only that; where this app cannot
 * hold keys it then says so and points to the desktop app, with no password form. A password
 * signup the server refuses anyway shows the server's message.
 *
 * **Fields:**
 * - `username` — required, unique handle.
 * - `email` — required, validated client-side against `EMAIL_REGEX` before
 *   submit. Trimmed before send (server also trims + lowercases). If the server
 *   returns `EMAIL_TAKEN`, an inline error renders next to this field.
 * - `password` — required, 8 char minimum hint.
 * - `displayName` — optional. Trimmed before send; omitted entirely (not sent
 *   as `""`) when blank after trim. Falls back to `username` server-side.
 *
 * **Password policy note:**
 * The form shows a hardcoded "8 character minimum" hint. The backend enforces
 * its own rules and surfaces field errors on rejection.
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

import {
  EXPIRED_TOKEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  INVALID_TOKEN,
} from "../../../core/graphql/errors";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { isTermsRefusal, useSignupTerms } from "../api/useSignupTerms";
import { isMinimumAgeRefusal, useSignupMinimumAge } from "../api/useMinimumAge";
import { isRegistrationFull, REGISTRATION_FULL_MESSAGE } from "../api/registrationFull";
import { useSignupWithInviteMutation } from "../api/useSignupWithInviteMutation";
import { useInviteCode } from "../api/useInviteCode";
import { useJoinServerMutation } from "../../workspaces/api/useJoinServer";
import { InstanceNotice } from "../../updater/components/InstanceNotice";
import { checkDisplayName } from "../displayName";
import { InviteTokenType, RegistrationMode } from "../types";
import { Button } from "../../../shared/ui/Button";
import { InviteByline } from "./InviteByline";
import { InviteCodeField } from "./InviteCodeField";
import { JoinField } from "./JoinField";
import { KeySignupForm, type KeySignupTokens } from "./KeySignupForm";
import { TermsAcceptance } from "./TermsAcceptance";
import { BrandHeading } from "./BrandHeading";
import { ServerChoice } from "./ServerChoice";
import { AbuseContact } from "./AbuseContact";
import { MinimumAgeConfirmation } from "./MinimumAgeConfirmation";
import { RegistrationFullNotice } from "./RegistrationFullNotice";

/**
 * Email validation regex mirroring the backend's pragmatic email regex:
 * `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`
 * Exported so tests can import the same constant rather than duplicating it.
 */
export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

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
  /** Offer only the key signup: the server takes no password signup without a token. */
  keyOnly?: boolean;
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
 * Maps a GraphQL error extension code from `signupWithInvite` to a
 * `{ field: "email" | "general", message: string }` descriptor.
 *
 * Returns `null` when the error is not a recognised typed code (falls back
 * to the generic error banner).
 */
function mapSignupError(err: unknown): { field: "email" | "general"; message: string } | null {
  if (err && typeof err === "object") {
    const e = err as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
    const code = e.response?.errors?.[0]?.extensions?.code;
    if (code === "EMAIL_TAKEN") {
      return { field: "email", message: "This email is already in use. Try logging in instead." };
    }
  }
  return null;
}

/**
 * What this page offers: `key` alone, `key-or-password` (the key first where this app holds
 * keys), `password` alone, `no-keys` (the server needs a key signup and this app cannot make
 * one), or `checking` while that is not known yet.
 */
type SignupOffer = "key" | "key-or-password" | "password" | "no-keys" | "checking";

function signupOffer(
  canHoldKeys: boolean,
  probingKeys: boolean,
  keysRequired: boolean | undefined,
): SignupOffer {
  if (canHoldKeys) {
    if (keysRequired === undefined) return "key";
    return keysRequired ? "key" : "key-or-password";
  }
  if (probingKeys || keysRequired === undefined) return "checking";
  return keysRequired ? "no-keys" : "password";
}

/** The server takes key signups only and this app cannot make keys: where to sign up instead. */
function NoKeysHere() {
  return (
    <div role="alert" className="space-y-2 text-sm">
      <p className="font-medium text-rim-text">This server needs a key signup</p>
      <p className="text-rim-text-muted">
        New accounts here sign up with a key instead of a password, and this browser cannot create
        keys. Create your account in the RIM desktop app, or open this page in a current browser
        that can.
      </p>
    </div>
  );
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
  keyOnly = false,
  onSuccess,
}: JoinFormProps) {
  const { capabilities, deviceKeyStore } = useRuntime();
  const { signupRequiresKeys, info } = useServerInfo();
  const full = info?.registrationFull === true;
  const offer = signupOffer(
    capabilities.identityKeys,
    deviceKeyStore === "checking",
    keyOnly || signupRequiresKeys,
  );
  // Where this device can keep a key, the key signup comes first; the password form is the
  // fallback behind the toggle.
  const [chosen, setMethod] = useState<"password" | "key">("key");
  const method = offer === "key-or-password" ? chosen : offer === "password" ? "password" : "key";
  // A key signup in progress keeps its form mounted until it settles.
  const [keySignupBusy, setKeySignupBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const signup = useSignupWithInviteMutation();
  const terms = useSignupTerms();
  const age = useSignupMinimumAge();
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

  // A refused token already shows under the invite code field.
  const signupErrorCode = graphqlErrorCode(signup.error);
  const errorAtField =
    byCode && (signupErrorCode === INVALID_TOKEN || signupErrorCode === EXPIRED_TOKEN);

  /**
   * Validates the email field client-side. Sets inline error and returns
   * `false` if invalid, clears error and returns `true` if valid.
   */
  function validateEmail(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setEmailError("Email is required.");
      return false;
    }
    if (trimmed.length > 254) {
      setEmailError("Email must be 254 characters or fewer.");
      return false;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return false;
    }
    setEmailError(null);
    return true;
  }

  /**
   * Validates the displayName field client-side.
   * Only validates when non-empty after trim — the field is optional.
   * Returns `false` and sets an inline error when the trimmed value exceeds
   * 64 characters, the server's limit.
   */
  function validateDisplayName(value: string): boolean {
    const error = checkDisplayName(value);
    setDisplayNameError(error);
    return error === null;
  }

  /**
   * Builds the `SignupWithInviteInput` for the mutation.
   *
   * - `email`: always included, trimmed client-side.
   * - `displayName`: omitted entirely from the payload when blank after trim
   *   (NOT sent as `""`). Falls back to `username` server-side.
   * - Token fields: from `tokenFields`, or the invite code field for `CODE`.
   * - `acceptedTermsUrl`: the server's terms URL once accepted, absent without terms.
   * - `confirmedMinimumAge`: the server's minimum age once confirmed, absent without one.
   */
  function buildInput() {
    const trimmedDisplayName = displayName.trim();
    return {
      username,
      email: email.trim(),
      password,
      ...(trimmedDisplayName.length > 0 ? { displayName: trimmedDisplayName } : {}),
      ...signupTokens,
      ...terms.fields,
      ...age.fields,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Client-side validation gates — prevents round-trips for obvious invalid
    // input. Server remains the source of truth for uniqueness and final rules.
    if (!validateEmail(email)) {
      return;
    }
    if (!validateDisplayName(displayName)) {
      return;
    }

    signup.mutate(buildInput(), {
      onSuccess: (data) => {
        signedUp(data.signupWithInvite.userId, data.signupWithInvite.serverId ?? null);
      },
      onError: (err) => {
        if (terms.noteFailure(err)) return;
        if (age.noteFailure(err)) return;
        if (inviteRefused(err)) return;
        const mapped = mapSignupError(err);
        if (isRegistrationFull(err)) {
          setFormError(REGISTRATION_FULL_MESSAGE);
        } else if (mapped?.field === "email") {
          setEmailError(mapped.message);
        } else {
          setFormError(graphqlErrorMessage(err, "Registration failed. Try again."));
        }
      },
    });
  }

  const canSubmit =
    username.trim().length > 0 &&
    email.trim().length > 0 &&
    password.trim().length >= 8 &&
    terms.satisfied &&
    age.satisfied &&
    inviteReady;

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
          ) : offer === "no-keys" ? (
            <NoKeysHere />
          ) : offer === "checking" ? (
            <p className="text-sm text-rim-text-muted">Loading...</p>
          ) : method === "key" ? (
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
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {byCode && (
                <InviteCodeField
                  invite={invite}
                  mode={registrationMode}
                  disabled={signup.isPending}
                />
              )}
              <JoinField
                label="Username"
                value={username}
                onChange={setUsername}
                placeholder="yourname"
                required
              />
              <JoinField
                label="Email"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  // Clear inline error on edit so the user isn't blocked while typing.
                  if (emailError) setEmailError(null);
                }}
                placeholder="you@example.com"
                type="email"
                error={emailError}
                required
              />
              <JoinField
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="password"
                type="password"
                hint="8 character minimum"
              />
              <JoinField
                label="Display name (optional)"
                value={displayName}
                onChange={(v) => {
                  setDisplayName(v);
                  // Clear the inline error while the user edits.
                  if (displayNameError) setDisplayNameError(null);
                }}
                placeholder=""
                hint="If left blank, your username will be shown."
                error={displayNameError}
              />
              <TermsAcceptance terms={terms} disabled={signup.isPending} />
              <MinimumAgeConfirmation age={age} disabled={signup.isPending} />
              {(formError ||
                (signup.error &&
                  !isTermsRefusal(signup.error) &&
                  !isMinimumAgeRefusal(signup.error) &&
                  !errorAtField)) &&
                !emailError && (
                  <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                    {formError ?? graphqlErrorMessage(signup.error, "Registration failed.")}
                  </p>
                )}
              <button
                type="submit"
                disabled={signup.isPending || !canSubmit}
                className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
              >
                {signup.isPending ? "Creating account..." : "Create account"}
              </button>
            </form>
          )}
        </div>

        {!joining && !full && offer === "key-or-password" && method === "key" && (
          <div className="space-y-1 text-center text-xs text-rim-text-faint">
            <button
              type="button"
              onClick={() => setMethod("password")}
              disabled={keySignupBusy}
              className="underline underline-offset-2 transition hover:text-rim-text-muted disabled:opacity-50"
            >
              Create account with a password
            </button>
            <p>A password account can add a key later in Settings &gt; Security.</p>
          </div>
        )}
        {!joining && !full && offer === "key-or-password" && method === "password" && (
          <div className="space-y-3 text-center">
            <div className="flex items-center gap-3 text-xs text-rim-text-faint">
              <span className="flex-1 border-t border-rim-line" />
              <span>OR</span>
              <span className="flex-1 border-t border-rim-line" />
            </div>
            <button
              type="button"
              onClick={() => setMethod("key")}
              className="inline-block rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-sm text-rim-text-muted transition hover:text-rim-text"
            >
              Create account with a key
            </button>
          </div>
        )}

        <AbuseContact />

        <ServerChoice />
      </div>
    </div>
  );
}
