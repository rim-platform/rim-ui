import type { InviteCodeState } from "../api/useInviteCode";
import { InviteTokenType, RegistrationMode } from "../types";
import { JoinField } from "./JoinField";

/** What the field says under it while it is blank, by registration mode. */
function blankHint(mode: RegistrationMode | undefined): string {
  if (mode === RegistrationMode.OPEN) {
    return "With a workspace invite, the new account joins that workspace.";
  }
  if (mode === RegistrationMode.POW) {
    return "An invite takes the place of the check that this is a real device, and a workspace invite also joins its workspace.";
  }
  return "This server creates accounts by invite only. Paste the code or the whole invite link you were sent.";
}

/** What the field says under it about the code it holds. */
function hint(invite: InviteCodeState, mode: RegistrationMode | undefined): string {
  if (invite.code.kind === "empty") return blankHint(mode);
  if (invite.checking) return "Checking the invite code...";
  const preview = invite.preview;
  if (!preview) return "";
  if (preview.tokenType === InviteTokenType.WORKSPACE && preview.workspace) {
    const { serverName, invitedByDisplayName } = preview.workspace;
    return `Invite to ${serverName} from ${invitedByDisplayName}. The new account joins it.`;
  }
  return mode === RegistrationMode.OPEN
    ? "This server creates accounts without an invite, so this code is not needed."
    : "Invite to this server.";
}

/**
 * The invite code field of a signup with no invite link: required on an invite-only server,
 * optional otherwise. Takes the bare code or a whole invite link, and says under it what the
 * code does once checked, or why it cannot be used.
 *
 * @param invite - The field's state, from `useInviteCode`.
 * @param mode - The server's registration mode.
 * @param disabled - Whether a signup in progress holds the field.
 */
export function InviteCodeField({
  invite,
  mode,
  disabled,
}: {
  invite: InviteCodeState;
  mode: RegistrationMode | undefined;
  disabled?: boolean;
}) {
  return (
    <JoinField
      label={invite.required ? "Invite code" : "Invite code (optional)"}
      value={invite.text}
      onChange={invite.setText}
      placeholder="Invite code or link"
      hint={hint(invite, mode)}
      error={invite.error}
      required={invite.required}
      disabled={disabled}
    />
  );
}
