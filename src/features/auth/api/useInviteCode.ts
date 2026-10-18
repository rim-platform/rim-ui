import { useEffect, useState } from "react";

import {
  EXPIRED_TOKEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  INVALID_TOKEN,
} from "../../../core/graphql/errors";
import { inviteCodeToken, type InviteCode } from "../inviteCode";
import { InviteTokenType, RegistrationMode, type InviteTokenPreview } from "../types";
import { usePreviewInviteToken } from "./usePreviewInviteToken";

/** How long typing pauses before the code is previewed. */
const PREVIEW_DELAY_MS = 300;

/** What a signup refuses an invite to another server with. */
export const REMOTE_INVITE_MESSAGE =
  "This invite is for a workspace on another server. Create your account first, then join it with Join with an invite code.";

/** The token fields a signup sends: one for an invite this server takes there, else none. */
export interface InviteSignupTokens {
  instanceInviteToken?: string;
  workspaceInviteToken?: string;
}

/** The invite code field of a signup with no invite link, and what it means for the signup. */
export interface InviteCodeState {
  /** The field's contents. */
  text: string;
  setText: (text: string) => void;
  /** Whether the server creates no account without an invite. */
  required: boolean;
  /** What the field holds. */
  code: InviteCode;
  /** The checked invite the field holds; absent while it is blank, checking or refused. */
  preview: InviteTokenPreview | undefined;
  /** The code is being checked. */
  checking: boolean;
  /** Why the code cannot be used, shown under the field: the server's message, mostly. */
  error: string | null;
  /** Whether a signup may go ahead with what the field holds. */
  ready: boolean;
  /** The token fields the signup sends. */
  tokens: InviteSignupTokens;
  /** A workspace invite to accept once the account exists: an open server takes no token at signup. */
  joinAfter: string | null;
  /** The workspace the code invites to, for a workspace invite. */
  workspaceId: string | undefined;
  /**
   * Shows a signup's refusal of the token under the field.
   *
   * @param err - What the signup failed with.
   * @returns Whether it was a refusal of the token (`INVALID_TOKEN`, `EXPIRED_TOKEN`).
   */
  noteRefusal: (err: unknown) => boolean;
}

/** `value`, once it has stayed the same for `PREVIEW_DELAY_MS`. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

/** The signup fields for a checked invite: the one its type routes to. */
function tokenFields(preview: InviteTokenPreview, token: string): InviteSignupTokens {
  return preview.tokenType === InviteTokenType.WORKSPACE
    ? { workspaceInviteToken: token }
    : { instanceInviteToken: token };
}

/**
 * The invite code a signup with no invite link takes: the bare token or a whole invite link,
 * checked with `previewInviteToken` once typing pauses, which says whether it is a workspace or
 * an instance invite. How the signup uses it follows the registration mode: an invite-only
 * server needs it and takes it at signup, a pow server takes it in place of the proof-of-work,
 * and an open server takes no token at signup, so a workspace invite is accepted once the
 * account exists and an instance invite is not needed. An unknown mode counts as invite-only.
 *
 * @param mode - The server's registration mode.
 * @returns The field's state and the token fields the signup sends.
 */
export function useInviteCode(mode: RegistrationMode | undefined): InviteCodeState {
  const [text, setText] = useState("");
  const [refused, setRefused] = useState<{ token: string; message: string } | null>(null);
  const code = inviteCodeToken(text);
  const token = code.kind === "token" ? code.token : "";
  const settled = useSettled(token);
  const query = usePreviewInviteToken(settled, settled.length > 0);
  const required = mode !== RegistrationMode.OPEN && mode !== RegistrationMode.POW;

  const current = token.length > 0 && settled === token;
  const refusedHere = refused !== null && refused.token === token;
  const preview = current && !refusedHere && !query.error ? query.data : undefined;
  const checking = token.length > 0 && !refusedHere && (!current || query.isFetching);

  let error: string | null = null;
  if (code.kind === "remote") error = REMOTE_INVITE_MESSAGE;
  else if (refusedHere) error = refused.message;
  else if (current && query.error && !query.isFetching) {
    error = graphqlErrorMessage(query.error, "Could not check this invite code.");
  }

  const ready = code.kind === "empty" ? !required : preview !== undefined && !checking;
  const open = mode === RegistrationMode.OPEN;
  const tokens = preview && !open ? tokenFields(preview, token) : {};
  const joinAfter =
    preview && open && preview.tokenType === InviteTokenType.WORKSPACE ? token : null;

  return {
    text,
    setText,
    required,
    code,
    preview,
    checking,
    error,
    ready,
    tokens,
    joinAfter,
    workspaceId: preview?.workspace?.serverId,
    noteRefusal(err) {
      const errCode = graphqlErrorCode(err);
      if (!token || (errCode !== INVALID_TOKEN && errCode !== EXPIRED_TOKEN)) return false;
      setRefused({ token, message: graphqlErrorMessage(err, "This invite code was refused.") });
      return true;
    },
  };
}
