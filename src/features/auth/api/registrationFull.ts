import { graphqlErrorCode, REGISTRATION_FULL } from "../../../core/graphql/errors";
import { useServerInfo } from "../../updater/hooks/useServerInfo";

/** What the app says about a server that takes no new accounts. */
export const REGISTRATION_FULL_MESSAGE =
  "This server is full and takes no new accounts. Run your own server, or sign up on another one.";

/** Whether a failed signup is the server saying it is full. */
export function isRegistrationFull(err: unknown): boolean {
  return graphqlErrorCode(err) === REGISTRATION_FULL;
}

/** Whether the connected server says it is full (`serverInfo.registrationFull`). */
export function useRegistrationFull(): boolean {
  return useServerInfo().info?.registrationFull === true;
}
