/**
 * The account password's API: the OPAQUE messages of a registration, a login, a change and a
 * reset with the recovery phrase, as unpadded base64url strings. Each call goes through a
 * {@link GraphqlRequest}, the app's own server by default, so a relay switch can send the same
 * documents to the relay it moves to.
 */

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  graphqlErrorCode,
  PASSWORD_LOCKED,
  RATE_LIMITED,
  retryAfterSeconds,
} from "../../../core/graphql/errors";
import type {
  KeyLoginChallenge,
  PasswordChangeStart,
  PasswordLoginFinish,
  PasswordLoginStart,
  PasswordResetStart,
  SignedStatementInput,
} from "../../../core/graphql/generated/schema-types";

/** Sends one GraphQL document and returns its data. */
export type GraphqlRequest = <T>(
  document: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

/** The app's own server. */
export const appServer: GraphqlRequest = (document, variables) =>
  graphqlClient.request(document, variables);

/**
 * The "Keep me signed in" arguments of `loginWithKey` and `signupWithKey`: whether the session is
 * kept, and whether this app holds its keep key itself (the desktop, in its secret vault) or the
 * server holds it for the session (the web app).
 *
 * @param keep - Whether the person ticked "Keep me signed in".
 * @param desktop - Whether this is the desktop app.
 */
export function keepSignedInArguments(
  keep: boolean,
  desktop: boolean,
): { keepSignedIn: boolean; keepKeyHeld: boolean } {
  return { keepSignedIn: keep, keepKeyHeld: desktop };
}

/** Too many wrong passwords: only a reset with the recovery phrase opens the account again. */
export class PasswordLockedError extends Error {
  constructor() {
    super("Too many wrong tries. Use your recovery phrase to set a new password.");
    this.name = PASSWORD_LOCKED;
  }
}

/** Wrong tries made the next one wait. */
export class PasswordWaitError extends Error {
  /** Seconds until the next try, when the server said. */
  readonly retryAfterSeconds: number | undefined;

  constructor(seconds: number | undefined) {
    super(passwordWaitMessage(seconds));
    this.name = "PASSWORD_WAIT";
    this.retryAfterSeconds = seconds;
  }
}

/**
 * "Try again in N minutes" for a wait of `seconds`.
 *
 * @param seconds - The server's `retryAfterSeconds`, if it gave one.
 */
export function passwordWaitMessage(seconds: number | undefined): string {
  if (seconds === undefined) return "Too many wrong tries. Try again later.";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The password typed does not match the account's. */
export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WRONG_PASSWORD";
  }
}

/** Rethrows a refused try as {@link PasswordLockedError} or {@link PasswordWaitError}. */
function triesRefusal(err: unknown): unknown {
  const code = graphqlErrorCode(err);
  if (code === PASSWORD_LOCKED) return new PasswordLockedError();
  if (code === RATE_LIMITED) return new PasswordWaitError(retryAfterSeconds(err));
  return err;
}

const REGISTRATION_START = gql`
  mutation PasswordRegistrationStart($principalId: String!, $request: String!) {
    passwordRegistrationStart(principalId: $principalId, request: $request)
  }
`;

const LOGIN_START = gql`
  mutation PasswordLoginStart($principalId: String!, $request: String!) {
    passwordLoginStart(principalId: $principalId, request: $request) {
      loginId
      response
    }
  }
`;

const LOGIN_FINISH = gql`
  mutation PasswordLoginFinish($loginId: ID!, $credentialFinalization: String!) {
    passwordLoginFinish(loginId: $loginId, credentialFinalization: $credentialFinalization) {
      ticket
      serverShare
      rewraps
    }
  }
`;

const CHANGE_START = gql`
  mutation PasswordChangeStart($credentialRequest: String!, $registrationRequest: String!) {
    passwordChangeStart(
      credentialRequest: $credentialRequest
      registrationRequest: $registrationRequest
    ) {
      loginId
      credentialResponse
      registrationResponse
    }
  }
`;

const CHANGE_FINISH = gql`
  mutation PasswordChangeFinish(
    $loginId: ID!
    $credentialFinalization: String!
    $registrationUpload: String!
    $rewrap: String!
  ) {
    passwordChangeFinish(
      loginId: $loginId
      credentialFinalization: $credentialFinalization
      registrationUpload: $registrationUpload
      rewrap: $rewrap
    ) {
      changedAt
    }
  }
`;

const RESET_CHALLENGE = gql`
  mutation PasswordResetChallenge($principalId: String!) {
    passwordResetChallenge(principalId: $principalId) {
      challengeId
      nonce
    }
  }
`;

const RESET_START = gql`
  mutation PasswordResetStart($statement: SignedStatementInput!, $registrationRequest: String!) {
    passwordResetStart(statement: $statement, registrationRequest: $registrationRequest) {
      resetId
      registrationResponse
    }
  }
`;

const RESET_FINISH = gql`
  mutation PasswordResetFinish($resetId: ID!, $registrationUpload: String!) {
    passwordResetFinish(resetId: $resetId, registrationUpload: $registrationUpload)
  }
`;

const SET_PASSWORD_START = gql`
  mutation SetPasswordStart($registrationRequest: String!) {
    setPasswordStart(registrationRequest: $registrationRequest)
  }
`;

const SET_PASSWORD = gql`
  mutation SetPassword($registrationUpload: String!) {
    setPassword(registrationUpload: $registrationUpload) {
      serverShare
    }
  }
`;

/**
 * Starts registering the password of a new account.
 *
 * @param request - The OPAQUE `RegistrationRequest`.
 * @returns The `RegistrationResponse`.
 */
export async function passwordRegistrationStart(
  principalId: string,
  request: string,
  send: GraphqlRequest = appServer,
): Promise<string> {
  const res = await send<{ passwordRegistrationStart: string }>(REGISTRATION_START, {
    principalId,
    request,
  });
  return res.passwordRegistrationStart;
}

/**
 * Starts a password login; the server counts it as a try.
 *
 * @param request - The OPAQUE `CredentialRequest`.
 * @throws PasswordLockedError after the 10th wrong try, PasswordWaitError while a wait runs.
 */
export async function passwordLoginStart(
  principalId: string,
  request: string,
  send: GraphqlRequest = appServer,
): Promise<Pick<PasswordLoginStart, "loginId" | "response">> {
  try {
    const res = await send<{ passwordLoginStart: PasswordLoginStart }>(LOGIN_START, {
      principalId,
      request,
    });
    return res.passwordLoginStart;
  } catch (err) {
    throw triesRefusal(err);
  }
}

/**
 * Finishes a password login.
 *
 * @param credentialFinalization - The OPAQUE `CredentialFinalization`.
 * @returns The ticket for `loginWithKey`, the server share sealed under the login's transport
 *   key, and the rewraps, newest first.
 */
export async function passwordLoginFinish(
  loginId: string,
  credentialFinalization: string,
  send: GraphqlRequest = appServer,
): Promise<Pick<PasswordLoginFinish, "ticket" | "serverShare" | "rewraps">> {
  const res = await send<{ passwordLoginFinish: PasswordLoginFinish }>(LOGIN_FINISH, {
    loginId,
    credentialFinalization,
  });
  return res.passwordLoginFinish;
}

/**
 * Starts changing the signed-in account's password; the server counts it as a try.
 *
 * @throws PasswordLockedError or PasswordWaitError as {@link passwordLoginStart}.
 */
export async function passwordChangeStart(
  credentialRequest: string,
  registrationRequest: string,
): Promise<Pick<PasswordChangeStart, "loginId" | "credentialResponse" | "registrationResponse">> {
  try {
    const res = await graphqlClient.request<{ passwordChangeStart: PasswordChangeStart }>(
      CHANGE_START,
      { credentialRequest, registrationRequest },
    );
    return res.passwordChangeStart;
  } catch (err) {
    throw triesRefusal(err);
  }
}

/** Finishes a password change; the account's other sessions end. */
export async function passwordChangeFinish(input: {
  loginId: string;
  credentialFinalization: string;
  registrationUpload: string;
  rewrap: string;
}): Promise<void> {
  await graphqlClient.request(CHANGE_FINISH, input);
}

/** A challenge for a `password-reset` statement. */
export async function passwordResetChallenge(
  principalId: string,
): Promise<Pick<KeyLoginChallenge, "challengeId" | "nonce">> {
  const res = await graphqlClient.request<{
    passwordResetChallenge: Pick<KeyLoginChallenge, "challengeId" | "nonce">;
  }>(RESET_CHALLENGE, { principalId });
  return res.passwordResetChallenge;
}

/**
 * Starts a reset with a `password-reset` statement the recovery key signed.
 *
 * @param registrationRequest - The OPAQUE `RegistrationRequest` of the new password.
 */
export async function passwordResetStart(
  statement: SignedStatementInput,
  registrationRequest: string,
): Promise<Pick<PasswordResetStart, "resetId" | "registrationResponse">> {
  const res = await graphqlClient.request<{ passwordResetStart: PasswordResetStart }>(RESET_START, {
    statement,
    registrationRequest,
  });
  return res.passwordResetStart;
}

/** Finishes a reset: the new password replaces the old one and every session ends. */
export async function passwordResetFinish(
  resetId: string,
  registrationUpload: string,
): Promise<void> {
  await graphqlClient.request(RESET_FINISH, { resetId, registrationUpload });
}

/**
 * Starts setting a password for a signed-in account that has none.
 *
 * @returns The `RegistrationResponse`.
 */
export async function setPasswordStart(registrationRequest: string): Promise<string> {
  const res = await graphqlClient.request<{ setPasswordStart: string }>(SET_PASSWORD_START, {
    registrationRequest,
  });
  return res.setPasswordStart;
}

/**
 * Finishes setting the password.
 *
 * @returns The account's new server share, in the clear.
 */
export async function setPassword(registrationUpload: string): Promise<string> {
  const res = await graphqlClient.request<{ setPassword: { serverShare: string } }>(SET_PASSWORD, {
    registrationUpload,
  });
  return res.setPassword.serverShare;
}
