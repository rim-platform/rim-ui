/**
 * Key identity: enrolling the account's key, creating an account from a key and a password,
 * signing in with the password and this device's key, devices, identity rotation, the profile
 * card and recovery.
 *
 * The keys live with the key backend (`keyBackend`): on the Tauri side on the desktop, where they
 * never reach the webview, and as non-extractable WebCrypto keys in the web app. This module
 * talks to the server and asks the backend for each signed statement it needs, so the session
 * cookie a key sign-in sets lands in the page like a password sign-in's. Keys and signatures
 * are opaque strings here: their algorithm is the key backend's business.
 */

import { gql } from "graphql-request";
import { isTauri } from "@tauri-apps/api/core";

import { graphqlClient } from "../../../core/graphql/client";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import {
  CONFLICT,
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  VALIDATION,
} from "../../../core/graphql/errors";
import type {
  DeviceKey,
  KeyLoginChallenge,
  LoginPayload,
  ProfileCard,
  RotateIdentityKeyInput,
  SignedStatement,
  SignedStatementInput,
  SignupWithKeyPayload,
  SignupWithKeyInput,
} from "../../../core/graphql/generated/schema-types";
import { NeedsRecoveryError } from "../../../core/accountVault/dkWraps";
import { logger } from "../../../core/logger";
import {
  keepSignedInArguments,
  passwordLoginFinish,
  passwordLoginStart,
  passwordRegistrationStart,
} from "../../auth/api/passwordApi";
import { signInRequest } from "../../auth/api/signInRequest";
import {
  addRecoveryWrapToUnlocked,
  holdSession,
  lockAccount,
  type SessionKeys,
  unlockWithRecovery,
  unlockWithRecoveryOnDesktop,
} from "../../auth/runtime/accountUnlock";
import { startLogin, startRegistration, type PasswordLogin } from "../../auth/runtime/opaqueFlows";
import { fetchRegistrationMode } from "../../auth/api/useServerConfig";
import { RegistrationMode } from "../../auth/types";
import { MAX_CARD_RELAYS } from "../../relay/contacts/contactLink";
import {
  readRegistration,
  solveProofOfWork,
  type RelayRegistration,
} from "../../relay/pow/proofOfWork";
import { serverOrigin } from "../../relay/state/serverOrigin";
import { parseRecoveryPhrase } from "../browser/recoveryKit";
import {
  keyBackend,
  type EnrollmentDraft,
  type LocalKeyAccount,
  type LogStatus,
  type RecoveryKitText,
  type StoragePersistence,
} from "./keyBackend";

export {
  keyCommand,
  type EnrollmentDraft,
  type LocalKeyAccount,
  type LogStatus,
  type RecoveryKitText,
  type StoragePersistence,
} from "./keyBackend";

/** The signed-in account, as key commands name it. */
export interface KeyAccount {
  userId: string;
  username: string;
}

function serverAccount(account: KeyAccount) {
  return { endpoint: getGraphqlEndpoint(), userId: account.userId, username: account.username };
}

// ─── Server documents ───────────────────────────────────────────────────────

const STATEMENT_FIELDS = "payload signature";

export const MY_KEY_IDENTITY_QUERY = gql`
  query MyKeyIdentity {
    myKeyIdentity {
      principalId
      keySeq
      keyLog { seq statement { ${STATEMENT_FIELDS} } }
      devices {
        deviceId
        publicKey
        name
        keySeq
        certificate { ${STATEMENT_FIELDS} }
        addedAt
        lastUsedAt
        revokedAt
      }
      profileCard { version updatedAt statement { ${STATEMENT_FIELDS} } }
    }
  }
`;

const KEY_LOG_QUERY = gql`
  query KeyLog($principalId: String!) {
    keyLog(principalId: $principalId) { seq statement { ${STATEMENT_FIELDS} } }
  }
`;

const CHALLENGE_MUTATION = gql`
  mutation KeyLoginChallenge {
    keyLoginChallenge {
      challengeId
      nonce
    }
  }
`;

const LOGIN_WITH_KEY_MUTATION = gql`
  mutation LoginWithKey(
    $proof: SignedStatementInput!
    $passwordTicket: String
    $keepSignedIn: Boolean!
    $keepKeyHeld: Boolean!
  ) {
    loginWithKey(
      proof: $proof
      passwordTicket: $passwordTicket
      keepSignedIn: $keepSignedIn
      keepKeyHeld: $keepKeyHeld
    ) {
      userId
      csrfToken
      sessionSecret
      keepKey
    }
  }
`;

/** The same without `csrfToken`, for a server older than it. */
const LOGIN_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION = gql`
  mutation LoginWithKeyWithoutCsrfToken(
    $proof: SignedStatementInput!
    $passwordTicket: String
    $keepSignedIn: Boolean!
    $keepKeyHeld: Boolean!
  ) {
    loginWithKey(
      proof: $proof
      passwordTicket: $passwordTicket
      keepSignedIn: $keepSignedIn
      keepKeyHeld: $keepKeyHeld
    ) {
      userId
      sessionSecret
      keepKey
    }
  }
`;

const SIGNUP_WITH_KEY_MUTATION = gql`
  mutation SignupWithKey($input: SignupWithKeyInput!) {
    signupWithKey(input: $input) {
      userId
      serverId
      csrfToken
      serverShare
      sessionSecret
      keepKey
    }
  }
`;

/** The same without `csrfToken`, for a server older than it. */
const SIGNUP_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION = gql`
  mutation SignupWithKeyWithoutCsrfToken($input: SignupWithKeyInput!) {
    signupWithKey(input: $input) {
      userId
      serverId
      serverShare
      sessionSecret
      keepKey
    }
  }
`;

const REVOKE_MUTATION = gql`
  mutation RevokeDeviceKey($revocation: SignedStatementInput!) {
    revokeDeviceKey(revocation: $revocation) {
      deviceId
      revokedAt
    }
  }
`;

const ROTATE_MUTATION = gql`
  mutation RotateIdentityKey($input: RotateIdentityKeyInput!) {
    rotateIdentityKey(input: $input) {
      principalId
      keySeq
    }
  }
`;

const PUBLISH_CARD_MUTATION = gql`
  mutation PublishProfileCard($card: SignedStatementInput!) {
    publishProfileCard(card: $card) {
      version
    }
  }
`;

const ME_ACCOUNT_QUERY = gql`
  query MeKeyAccount {
    me {
      id
      username
      displayName
      principalId
    }
  }
`;

type StatementOnly = { statement: Pick<SignedStatement, "payload" | "signature"> };

export type KeyIdentityDevice = Pick<
  DeviceKey,
  "deviceId" | "publicKey" | "name" | "keySeq" | "addedAt" | "lastUsedAt" | "revokedAt"
> & { certificate: StatementOnly["statement"] };

/** `myKeyIdentity` as this module selects it. */
export interface MyKeyIdentity {
  principalId: string | null;
  keySeq: number | null;
  keyLog: ({ seq: number } & StatementOnly)[];
  devices: KeyIdentityDevice[];
  profileCard: (Pick<ProfileCard, "version" | "updatedAt"> & StatementOnly) | null;
}

interface MeAccount {
  id: string;
  username: string;
  displayName: string;
  principalId: string | null;
}

export async function fetchMyKeyIdentity(): Promise<MyKeyIdentity> {
  const res = await graphqlClient.request<{ myKeyIdentity: MyKeyIdentity }>(MY_KEY_IDENTITY_QUERY);
  return res.myKeyIdentity;
}

function statementInput(statement: StatementOnly["statement"]): SignedStatementInput {
  return { payload: statement.payload, signature: statement.signature };
}

export function logStatements(log: StatementOnly[]): SignedStatementInput[] {
  return log.map(({ statement }) => statementInput(statement));
}

/** The public key log of `principalId` on this server (no session needed). */
export async function fetchKeyLog(principalId: string): Promise<SignedStatementInput[]> {
  const { keyLog } = await graphqlClient.request<{ keyLog: StatementOnly[] }>(KEY_LOG_QUERY, {
    principalId,
  });
  return logStatements(keyLog);
}

/** The signed-in account as key commands name it, with its display name. */
export async function fetchKeyAccount(): Promise<KeyAccount & { displayName: string }> {
  const { me } = await graphqlClient.request<{ me: MeAccount }>(ME_ACCOUNT_QUERY);
  return { userId: me.id, username: me.username, displayName: me.displayName || me.username };
}

async function challenge(): Promise<Pick<KeyLoginChallenge, "challengeId" | "nonce">> {
  const res = await graphqlClient.request<{
    keyLoginChallenge: Pick<KeyLoginChallenge, "challengeId" | "nonce">;
  }>(CHALLENGE_MUTATION);
  return res.keyLoginChallenge;
}

// ─── Local accounts ─────────────────────────────────────────────────────────

/** Accounts on this server this device can sign in to with a key. */
export async function listDeviceKeyAccounts(): Promise<LocalKeyAccount[]> {
  return keyBackend().accounts(getGraphqlEndpoint());
}

/**
 * Reconcile this device's keys with the server's view of the signed-in account: keys the
 * server shows are confirmed and linked to the account, leftover keys from a signup it never
 * accepted are removed.
 */
export async function settleDeviceKeys(
  account: KeyAccount,
  principalId: string | null,
): Promise<LocalKeyAccount | null> {
  return keyBackend().settle(serverAccount(account), principalId);
}

/**
 * Settle this device's keys against the server's current answer for the signed-in account,
 * fetched fresh (never a cached one: settling against a stale "not enrolled" would remove the
 * keys of an account that is enrolled).
 */
export async function reconcileDeviceKeys(account: KeyAccount): Promise<LocalKeyAccount | null> {
  return settleDeviceKeys(account, await serverPrincipalId());
}

export async function forgetDeviceKeys(principalId: string): Promise<void> {
  await keyBackend().forget(principalId);
}

export async function defaultDeviceName(): Promise<string> {
  return keyBackend().defaultDeviceName();
}

// ─── Sign-in ────────────────────────────────────────────────────────────────

/** The password the person typed, and whether they ticked "Keep me signed in". */
export interface PasswordEntry {
  password: string;
  keep: boolean;
}

/**
 * How a sign-in goes on when this device's data for the account opens only with the recovery
 * phrase: unlock it with the phrase's 16 bytes, or start empty on this device.
 */
export type RecoveryChoice = { entropy: Uint8Array } | "startEmpty";

/** What a sign-in with the password may be given besides the password. */
export interface PasswordSignInOptions {
  /**
   * The recovery phrase's 16 bytes, when the person entered the phrase already: it opens this
   * device's data when that needs it, and the data key is wrapped under it afterwards.
   */
  recoveryEntropy?: Uint8Array;
  /**
   * Asked when this device's data needs the recovery phrase; `wrongPhrase` says the last phrase
   * did not open it. Resolving `null` gives up the sign-in.
   */
  onNeedsRecovery?: (wrongPhrase: boolean) => Promise<RecoveryChoice | null>;
}

/** A finished sign-in. */
export interface PasswordSignInResult {
  userId: string;
  /** What this device kept for the account before no longer opens. */
  startedEmpty: boolean;
}

/** The person gave up a sign-in when asked for the recovery phrase. */
export class SignInCancelled extends Error {
  constructor() {
    super("The sign-in was cancelled.");
    this.name = "SignInCancelled";
  }
}

/** This device holds no keys for the account, so nothing was sent or changed. */
export class NoDeviceKeysError extends Error {
  constructor() {
    super("This device holds no keys for that account.");
    this.name = "NoDeviceKeysError";
  }
}

/** The 16 bytes of a recovery phrase given as its words. */
export function phraseEntropy(words: string[]): Promise<Uint8Array> {
  return parseRecoveryPhrase(words.join(" "));
}

/** The 16 bytes of a draft's recovery phrase, or `null` when its words do not read. */
async function draftEntropy(draft: EnrollmentDraft): Promise<Uint8Array | null> {
  try {
    return await phraseEntropy(draft.recoveryPhrase);
  } catch (err) {
    logger.warn("[RIM:keys] the draft's recovery phrase could not be read:", err);
    return null;
  }
}

/**
 * Unlocks the account with the recovery phrase on this platform.
 *
 * @returns Whether the phrase opened this device's data.
 */
function unlockWithPhrase(endpoint: string, principalId: string, entropy: Uint8Array) {
  return isTauri()
    ? unlockWithRecoveryOnDesktop(endpoint, principalId, entropy)
    : unlockWithRecovery(endpoint, principalId, entropy);
}

/**
 * Unlocks after an accepted login, asking for the recovery phrase or starting empty when this
 * device's data needs the phrase.
 */
async function unlockLogin(
  login: PasswordLogin,
  input: Parameters<PasswordLogin["unlock"]>[0],
  options: PasswordSignInOptions,
): Promise<{ startedEmpty: boolean }> {
  let known = options.recoveryEntropy ?? null;
  let wrongPhrase = false;
  let next = input;
  for (;;) {
    try {
      return await login.unlock(next);
    } catch (err) {
      if (!(err instanceof NeedsRecoveryError)) throw err;
    }
    let choice: RecoveryChoice | null;
    if (known) {
      choice = { entropy: known };
      known = null;
    } else {
      choice = (await options.onNeedsRecovery?.(wrongPhrase)) ?? null;
    }
    if (choice === null) throw new SignInCancelled();
    if (choice === "startEmpty") {
      next = { ...next, startEmpty: true };
      continue;
    }
    wrongPhrase = !(await unlockWithPhrase(input.endpoint, input.principalId, choice.entropy));
  }
}

/**
 * Holds what a sign-in or signup returned for its session. A keep wrap that could not be written
 * only means the password is asked for at the next start.
 */
async function holdSessionKeys(keys: SessionKeys): Promise<void> {
  try {
    await holdSession(keys);
  } catch (err) {
    logger.warn("[RIM:keys] keeping this device signed in failed:", err);
  }
}

/**
 * Signs in with this device's key for `principalId`: a fresh challenge, signed by the key
 * backend, sent to `loginWithKey`, which sets the session cookie. A revoked device fails with
 * the server's `FORBIDDEN`.
 *
 * The session's secret (unkept) is held before anything else is asked of the server, which
 * refuses a request without it; the keep key of a kept web session wraps the data key.
 *
 * @param passwordTicket - The ticket of an accepted password login, which this server's accounts
 *   need; only an account of another server signs in without one.
 * @param unlocked - Whether the account is unlocked here, so its data key can be kept for a
 *   reload or wrapped under the keep key.
 */
async function loginWithDeviceKey(
  principalId: string,
  passwordTicket: string | null,
  keep: boolean,
  unlocked: boolean,
): Promise<{ userId: string }> {
  const { challengeId, nonce } = await challenge();
  const proof = await keyBackend().signLogin(getGraphqlEndpoint(), principalId, {
    challengeId,
    nonce,
  });
  const res = await signInRequest<{
    loginWithKey: Pick<LoginPayload, "userId" | "sessionSecret" | "keepKey">;
  }>("loginWithKey", LOGIN_WITH_KEY_MUTATION, LOGIN_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION, {
    proof,
    passwordTicket,
    ...keepSignedInArguments(keep, isTauri()),
  });
  await holdSessionKeys({
    sessionSecret: res.loginWithKey.sessionSecret,
    keepKey: unlocked ? res.loginWithKey.keepKey : null,
  });
  // Best-effort: link the keys to the account now that the server named it.
  try {
    const { me } = await graphqlClient.request<{ me: MeAccount }>(ME_ACCOUNT_QUERY);
    await settleDeviceKeys({ userId: me.id, username: me.username }, me.principalId);
  } catch {
    // The sign-in itself succeeded; the next settle links the keys.
  }
  return { userId: res.loginWithKey.userId };
}

/**
 * Signs in with the account password and this device's key, in that order, so the keys sealed
 * under the account's data key open before the device key signs:
 *
 * 0. this device holds keys for the account; otherwise nothing is sent;
 * 1. the OPAQUE login: `passwordLoginStart` (a try), the password checked on this device, then
 *    `passwordLoginFinish`, which answers a sign-in ticket, the sealed server share and the
 *    rewraps;
 * 2. the unlock of this device's data, which may need the recovery phrase or starting empty;
 * 3. `loginWithKey` with the ticket, which sets the session cookie.
 *
 * @throws PasswordLockedError after 10 wrong tries, PasswordWaitError while a wait runs,
 *   WrongPasswordError for a wrong password, SignInCancelled when the person gave up at the
 *   recovery phrase, and the server's `FORBIDDEN` for a revoked device.
 * @throws NoDeviceKeysError when this device holds no keys for the account, before anything is
 *   sent or written.
 */
export async function signInWithPassword(
  principalId: string,
  entry: PasswordEntry,
  options: PasswordSignInOptions = {},
): Promise<PasswordSignInResult> {
  const endpoint = getGraphqlEndpoint();
  const held = await keyBackend().accounts(endpoint);
  if (!held.some((a) => a.principalId === principalId)) throw new NoDeviceKeysError();
  const login = await startLogin(entry.password);
  try {
    const started = await passwordLoginStart(principalId, login.request);
    const finalization = await login.finish(started.response);
    const finished = await passwordLoginFinish(started.loginId, finalization);
    const unlocked = await unlockLogin(
      login,
      {
        endpoint,
        principalId,
        serverShare: finished.serverShare,
        rewraps: finished.rewraps,
        keep: entry.keep,
      },
      options,
    );
    let signedIn: { userId: string };
    try {
      signedIn = await loginWithDeviceKey(principalId, finished.ticket, entry.keep, true);
    } catch (err) {
      lockAccount();
      throw err;
    }
    if (options.recoveryEntropy) {
      try {
        await addRecoveryWrapToUnlocked(options.recoveryEntropy);
      } catch (err) {
        logger.warn("[RIM:keys] wrapping the data key under the recovery phrase failed:", err);
      }
    }
    return { ...signedIn, startedEmpty: unlocked.startedEmpty };
  } finally {
    login.close();
  }
}

// ─── Enrollment ─────────────────────────────────────────────────────────────

/** Create the keys of a new identity; the result carries its recovery kit. */
export async function beginEnrollment(deviceName: string): Promise<EnrollmentDraft> {
  return keyBackend().beginEnrollment(deviceName);
}

/** The signed-in account's `principalId` as the server has it now. */
async function serverPrincipalId(): Promise<string | null> {
  const { me } = await graphqlClient.request<{ me: MeAccount }>(ME_ACCOUNT_QUERY);
  return me.principalId;
}

/**
 * Whether the person has saved a draft's recovery kit when its keys are stored: `saved` (they
 * confirmed it first) keeps no kit secret on this device, `later` keeps it until
 * `confirmRecoveryKitSaved`.
 */
export type RecoveryKitTiming = "saved" | "later";

/**
 * Tell the key backend the kit is saved before a draft's keys are stored, unless it is later.
 * `later` is refused on a device that does not keep the kit, before anything is stored or sent.
 */
async function recordKitTiming(draft: EnrollmentDraft, timing: RecoveryKitTiming): Promise<void> {
  if (timing === "saved") {
    await keyBackend().confirmRecoveryKit(draft.principalId);
  } else if (!keyBackend().keepsRecoveryKit) {
    throw new Error("This device cannot keep the recovery kit. Save it before you continue.");
  }
}

// ─── Key-only signup ────────────────────────────────────────────────────────

/**
 * What the join page fills in for `signupWithKey`: the name and the page's token, if any. The
 * password's OPAQUE `RegistrationUpload` and the "Keep me signed in" arguments are always sent:
 * {@link signupWithKey} makes them from the password it is given.
 */
export type KeySignupFields = Omit<
  SignupWithKeyInput,
  | "keyLog"
  | "device"
  | "proof"
  | "proofOfWork"
  | "passwordRegistration"
  | "keepSignedIn"
  | "keepKeyHeld"
>;

/** How a signup reports and stops the proof-of-work a relay in `pow` mode asks for. */
export interface KeySignupOptions {
  /** Told when a proof-of-work of `bits` bits starts; it ends when the signup settles. */
  onProofOfWork?: (bits: number) => void;
  /** Aborting stops the proof-of-work: the signup then fails with `PowCancelled`. */
  signal?: AbortSignal;
  /** Whether the person saved the recovery kit before the signup; `saved` when absent. */
  recoveryKit?: RecoveryKitTiming;
}

/** The new account; `serverId` is set when a workspace invite also joined its workspace. */
export type KeySignupResult = Pick<SignupWithKeyPayload, "userId"> & {
  serverId: string | null;
};

/** `keyLoginChallenge` failed, so nothing was signed or sent. `reason` is what it threw. */
export class KeyChallengeFailed extends Error {
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(graphqlErrorMessage(reason, "Could not reach the server."));
    this.name = "KeyChallengeFailed";
    this.reason = reason;
  }
}

/**
 * The server's discovery document could not be read, and the server may ask for a proof-of-work
 * that only that document describes, so the signup was not sent. `reason` is what failed.
 */
export class RegistrationUnreadable extends Error {
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(
      "Could not read how this server takes new accounts, so the account was not created. Try again in a moment.",
    );
    this.name = "RegistrationUnreadable";
    this.reason = reason;
  }
}

/**
 * The server's discovery document says it is full, so no proof-of-work was searched for and the
 * signup was not sent.
 */
export class RegistrationClosed extends Error {
  constructor() {
    super("This server is full and takes no new accounts.");
    this.name = "RegistrationClosed";
  }
}

/** Signups sent to the server and not answered yet; their keys are never given up meanwhile. */
let signupsInFlight = 0;

/** What each draft was last sent with, by draft id, to store its keys again under. */
const sentSignups = new Map<string, KeySignupFields>();

/** Each draft's proof-of-work, by draft id, for the relay and difficulty it was found for. */
const proofs = new Map<string, { boundTo: string; nonce: string }>();

function hasToken(fields: KeySignupFields): boolean {
  return Boolean(fields.instanceInviteToken || fields.workspaceInviteToken);
}

/** Whether the server refused a signup over its proof-of-work, or for want of one. */
export function proofOfWorkRefused(err: unknown): boolean {
  const code = graphqlErrorCode(err);
  return (
    (code === VALIDATION || code === FORBIDDEN) &&
    /proof-?of-?work/i.test(graphqlErrorMessage(err, ""))
  );
}

/**
 * Whether a server whose discovery document could not be read takes a signup without a token
 * and without a proof-of-work: it says it is open or invite-only.
 */
async function takesSignupWithoutProof(): Promise<boolean> {
  try {
    const mode = await fetchRegistrationMode();
    return mode === RegistrationMode.OPEN || mode === RegistrationMode.INVITE_ONLY;
  } catch {
    return false;
  }
}

/**
 * The proof-of-work this server asks of a signup with no token, over the draft's inception:
 * `undefined` when its verified discovery document names another registration mode, and
 * `RegistrationClosed` thrown when the document says the server is full. When the
 * document cannot be read, a server that says it is open or invite-only gets the signup without
 * one; any other throws `RegistrationUnreadable` rather than send a signup it would refuse. A
 * retry with the same draft reuses the nonce.
 */
async function proofOfWorkFor(
  draft: EnrollmentDraft,
  fields: KeySignupFields,
  options: KeySignupOptions,
): Promise<string | undefined> {
  if (hasToken(fields)) return undefined;
  let registration: RelayRegistration;
  try {
    registration = await readRegistration();
  } catch (err) {
    logger.warn("[RIM:keys] reading this server's registration mode failed:", err);
    if (await takesSignupWithoutProof()) return undefined;
    throw new RegistrationUnreadable(err);
  }
  if (registration.full) throw new RegistrationClosed();
  if (registration.mode !== "pow" || registration.powBits === null) return undefined;
  const boundTo = `${registration.serverId}|${registration.powBits}`;
  const known = proofs.get(draft.draftId);
  if (known?.boundTo === boundTo) return known.nonce;
  options.onProofOfWork?.(registration.powBits);
  const nonce = await solveProofOfWork(
    {
      serverId: registration.serverId,
      inceptionPayload: draft.inceptionPayload,
      bits: registration.powBits,
    },
    options.signal,
  );
  proofs.set(draft.draftId, { boundTo, nonce });
  return nonce;
}

/**
 * Whether an account on this server holds `principalId`, read from its public key log:
 * `null` when the server cannot say.
 */
async function principalTaken(principalId: string): Promise<boolean | null> {
  try {
    const { keyLog } = await graphqlClient.request<{ keyLog: StatementOnly[] }>(KEY_LOG_QUERY, {
      principalId,
    });
    return keyLog.length > 0;
  } catch {
    return null;
  }
}

function cardName(fields: KeySignupFields): string {
  return fields.displayName?.trim() || fields.username;
}

/** Best-effort: publish the new account's profile card; Settings publishes a missing one. */
async function publishFirstCard(fields: KeySignupFields): Promise<void> {
  try {
    await publishProfileCard(await fetchMyKeyIdentity(), cardName(fields));
  } catch (err) {
    logger.warn("[RIM:keys] publishing the profile card after signup failed:", err);
  }
}

/**
 * Finish a signup the server took although no answer said so: store the draft's keys again (a
 * failed attempt may have removed them), sign in with the password and the device key, which
 * links the keys to the account, and publish the profile card. The server id is `null`: the answer that named it
 * was lost and the invite token is used up, so the caller fills in the workspace of the invite
 * it previewed.
 */
async function finishTakenSignup(
  draft: EnrollmentDraft,
  entry: PasswordEntry,
): Promise<KeySignupResult> {
  const fields = sentSignups.get(draft.draftId);
  if (fields) {
    await keyBackend().restoreDraftKeys(draft.draftId, getGraphqlEndpoint(), fields.username);
  }
  const entropy = await draftEntropy(draft);
  const { userId } = await signInWithPassword(
    draft.principalId,
    entry,
    entropy ? { recoveryEntropy: entropy } : {},
  );
  if (fields) await publishFirstCard(fields);
  sentSignups.delete(draft.draftId);
  return { userId, serverId: null };
}

/**
 * Create an account from a draft's keys and a password, with no email. The password is
 * registered first (`passwordRegistrationStart`, then the OPAQUE upload goes with the signup).
 * The keys are stored before `signupWithKey` is sent, so an account the server created never
 * ends up without them. When it fails, the key log says whether the account exists: if not, the
 * keys go and the draft stays, so a retry uses the same keys and the saved recovery kit; if an
 * earlier attempt whose answer was lost created it, this device signs in with the password and
 * its key; with no answer either way the keys stay for a later sign-in. The server sets the
 * session cookie, and the new account is unlocked on this device with a new data key, wrapped
 * under the password and the draft's recovery phrase.
 *
 * Without a token, on a relay in `pow` registration mode, the proof-of-work is found first,
 * before the challenge is fetched, so the challenge does not expire while it runs.
 */
export async function signupWithKey(
  draft: EnrollmentDraft,
  fields: KeySignupFields,
  entry: PasswordEntry,
  options: KeySignupOptions = {},
): Promise<KeySignupResult> {
  const sent: KeySignupFields = { ...fields, username: fields.username.trim() };
  await recordKitTiming(draft, options.recoveryKit ?? "saved");
  const proofOfWork = await proofOfWorkFor(draft, sent, options);
  const registration = await startRegistration(entry.password);
  try {
    let response: string;
    try {
      response = await passwordRegistrationStart(draft.principalId, registration.request);
    } catch (err) {
      // An earlier attempt whose answer was lost created the account: sign in to it.
      if (graphqlErrorCode(err) === CONFLICT && (await principalTaken(draft.principalId))) {
        return await finishTakenSignup(draft, entry);
      }
      throw err;
    }
    const passwordRegistration = await registration.finish(response);
    const result = await sendSignup(draft, sent, entry, {
      passwordRegistration,
      ...(proofOfWork && { proofOfWork }),
    });
    // A signup found only after its answer was lost is signed in and unlocked already.
    if (result.taken) return { userId: result.userId, serverId: result.serverId };
    let unlocked = false;
    if (result.serverShare) {
      try {
        await registration.unlockAfterSignup({
          endpoint: getGraphqlEndpoint(),
          principalId: draft.principalId,
          serverShare: result.serverShare,
          recoveryEntropy: await draftEntropy(draft),
          keep: entry.keep,
        });
        unlocked = true;
      } catch (err) {
        // The account exists and the session is set: the app asks for the password to unlock.
        logger.warn("[RIM:keys] unlocking the new account failed:", err);
      }
    }
    await holdSessionKeys({
      sessionSecret: result.sessionSecret,
      keepKey: unlocked ? result.keepKey : null,
    });
    // Best-effort from here: the account exists and the session is set. A later sign-in links
    // the keys.
    try {
      await settleDeviceKeys({ userId: result.userId, username: sent.username }, draft.principalId);
    } catch (err) {
      logger.warn("[RIM:keys] linking the keys after signup failed:", err);
    }
    await publishFirstCard(sent);
    return { userId: result.userId, serverId: result.serverId };
  } finally {
    registration.close();
  }
}

/** What a sent signup answered, or that it was found taken and signed in to. */
type SentSignup = KeySignupResult & {
  /** The new account's server share, in the clear. */
  serverShare: string | null;
  sessionSecret: string | null;
  keepKey: string | null;
  taken: boolean;
};

/**
 * Sends a signup with its password registration. A signup the server took although no answer
 * said so is finished by signing in ({@link finishTakenSignup}) and comes back `taken`.
 */
async function sendSignup(
  draft: EnrollmentDraft,
  sent: KeySignupFields,
  entry: PasswordEntry,
  extra: Pick<SignupWithKeyInput, "passwordRegistration" | "proofOfWork">,
): Promise<SentSignup> {
  let challengeId: string;
  let nonce: string;
  try {
    ({ challengeId, nonce } = await challenge());
  } catch (err) {
    throw new KeyChallengeFailed(err);
  }
  // The keys are written before anything is sent; a failed write stops the signup here.
  const statements = await keyBackend().signSignup(
    draft.draftId,
    getGraphqlEndpoint(),
    sent.username,
    { challengeId, nonce },
  );
  sentSignups.set(draft.draftId, sent);
  const input: SignupWithKeyInput = {
    ...sent,
    ...statements,
    ...extra,
    ...keepSignedInArguments(entry.keep, isTauri()),
  };
  let result: SentSignup;
  signupsInFlight += 1;
  try {
    const res = await signInRequest<{ signupWithKey: SignupWithKeyPayload }>(
      "signupWithKey",
      SIGNUP_WITH_KEY_MUTATION,
      SIGNUP_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION,
      { input },
    );
    result = {
      userId: res.signupWithKey.userId,
      serverId: res.signupWithKey.serverId ?? null,
      serverShare: res.signupWithKey.serverShare ?? null,
      sessionSecret: res.signupWithKey.sessionSecret ?? null,
      keepKey: res.signupWithKey.keepKey ?? null,
      taken: false,
    };
  } catch (err) {
    // A refused nonce is searched for again, against the relay's discovery document as it is.
    if (proofOfWorkRefused(err)) proofs.delete(draft.draftId);
    const taken = await principalTaken(draft.principalId);
    if (taken === false) {
      await keyBackend()
        .removeDraftKeys(draft.draftId)
        .catch(() => undefined);
    }
    if (!taken) throw err;
    return {
      ...(await finishTakenSignup(draft, entry)),
      serverShare: null,
      sessionSecret: null,
      keepKey: null,
      taken: true,
    };
  } finally {
    signupsInFlight -= 1;
  }
  sentSignups.delete(draft.draftId);
  proofs.delete(draft.draftId);
  return result;
}

/**
 * Remove a draft's keys when the server holds no account with them. Returns whether it holds
 * one (`null` when it cannot say, or while a signup is in flight; nothing changes then).
 */
async function discardUnlessTaken(draft: EnrollmentDraft): Promise<boolean | null> {
  if (signupsInFlight > 0) return null;
  const taken = await principalTaken(draft.principalId);
  if (taken === false) {
    sentSignups.delete(draft.draftId);
    proofs.delete(draft.draftId);
    await keyBackend().discardEnrollment(draft.draftId);
  }
  return taken;
}

/**
 * The person discards a signup draft. Its keys go only when the server holds no account with
 * them. If an attempt the client saw fail created the account after all, the account gets its
 * keys back and this device signs in to it with the password the signup registered: the result
 * is that account, else `null`.
 */
export async function discardKeySignup(
  draft: EnrollmentDraft,
  entry: PasswordEntry,
): Promise<KeySignupResult | null> {
  if ((await discardUnlessTaken(draft)) !== true) return null;
  return finishTakenSignup(draft, entry);
}

/**
 * The page closes with a signup draft. Its keys go only when the server holds no account with
 * them; an account an earlier attempt created gets its keys back, to sign in with from the
 * sign-in screen. Without an answer the keys stay.
 */
export async function abandonKeySignup(draft: EnrollmentDraft): Promise<void> {
  if ((await discardUnlessTaken(draft)) !== true) return;
  const fields = sentSignups.get(draft.draftId);
  if (!fields) return;
  await keyBackend().restoreDraftKeys(draft.draftId, getGraphqlEndpoint(), fields.username);
}

/**
 * After a device-key sign-in failed: remove this device's keys for an account the server has
 * never seen, such as a signup whose request never reached it (the app quit, the page
 * closed). Only unconfirmed keys whose principal has no key log on the server go. Returns whether
 * they did.
 */
export async function forgetKeysTheServerNeverSaw(account: LocalKeyAccount): Promise<boolean> {
  if (account.confirmed || signupsInFlight > 0) return false;
  if ((await principalTaken(account.principalId)) !== false) return false;
  await keyBackend().forgetUnconfirmed(account.principalId);
  return true;
}

// ─── The recovery kit ───────────────────────────────────────────────────────

/**
 * Whether this device keeps a new identity's recovery kit until the person confirms saving it:
 * then a signup is sent first, with the kit `later`, and the kit shown after.
 * Otherwise the kit is saved before anything is sent.
 */
export function deviceKeepsRecoveryKit(): boolean {
  return keyBackend().keepsRecoveryKit;
}

/**
 * The recovery kit of `principalId` while the person has not confirmed saving it, read from
 * this device; `null` once confirmed, or where the device does not keep it.
 */
export async function unsavedRecoveryKit(principalId: string): Promise<RecoveryKitText | null> {
  return keyBackend().recoveryKit(principalId);
}

/** The person saved the recovery kit: this device stops keeping its secret. */
export async function confirmRecoveryKitSaved(principalId: string): Promise<void> {
  await keyBackend().confirmRecoveryKit(principalId);
}

/**
 * Ask the platform to keep the keys' storage. On the web a `refused` answer means the browser
 * may evict them; the answer is also kept for the UI (`useKeyStorageStore`).
 */
export function requestKeyStorage(): Promise<StoragePersistence> {
  return keyBackend().persistStorage();
}

// ─── Devices, rotation, profile card ────────────────────────────────────────

/** The account id of an enrolled identity, for the key backend. */
function enrolledId(identity: MyKeyIdentity): string {
  if (!identity.principalId) throw new Error("This account has no key identity yet.");
  return identity.principalId;
}

/** Verify the server's key log here and settle a pending rotation against it. */
export async function syncKeyLog(identity: MyKeyIdentity): Promise<LogStatus | null> {
  if (!identity.principalId) return null;
  return keyBackend().syncLog(identity.principalId, logStatements(identity.keyLog));
}

/** Revoke a device; returns the signed revocation, which other servers are sent too. */
export async function revokeDevice(
  identity: MyKeyIdentity,
  deviceId: string,
): Promise<SignedStatementInput> {
  const revocation = await keyBackend().signRevocation(
    enrolledId(identity),
    logStatements(identity.keyLog),
    deviceId,
  );
  await graphqlClient.request(REVOKE_MUTATION, { revocation });
  return revocation;
}

/** Replace the identity key. The recovery key and every device stay. */
export async function rotateIdentityKey(identity: MyKeyIdentity): Promise<void> {
  const entry = await keyBackend().beginRotation(
    enrolledId(identity),
    logStatements(identity.keyLog),
  );
  const input: RotateIdentityKeyInput = { entry };
  try {
    await graphqlClient.request(ROTATE_MUTATION, { input });
  } finally {
    // Promote the new key if the server took it, drop it if not.
    await syncKeyLog(await fetchMyKeyIdentity()).catch(() => null);
  }
}

/** The relays the published card lists, in its order; empty when there is no readable card. */
export function publishedRelays(identity: MyKeyIdentity): string[] {
  const card = identity.profileCard;
  if (!card) return [];
  try {
    const relays = (JSON.parse(card.statement.payload) as { relays?: unknown }).relays;
    return Array.isArray(relays) ? relays.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Where this account can be reached, preferred first: the published card's relays, with this
 * server put first when the card does not list it (a new card lists this server alone).
 *
 * @param here - The origin this server is known by (`serverOrigin`).
 * @param identity - The account's key identity; without it the list is this server alone.
 */
export function profileCardRelays(here: string, identity?: MyKeyIdentity): string[] {
  const listed = identity ? publishedRelays(identity) : [];
  return listed.includes(here) ? listed : [here, ...listed].slice(0, MAX_CARD_RELAYS);
}

/**
 * Whether the published card is missing or no longer says what it should: the display name,
 * the relays (this server, known by `here`, must be one), the active devices, or the identity
 * key that signed it.
 */
export function profileCardIsStale(
  identity: MyKeyIdentity,
  displayName: string,
  here: string,
): boolean {
  const card = identity.profileCard;
  if (!card) return true;
  let payload: {
    displayName?: unknown;
    keySeq?: unknown;
    relays?: unknown;
    devices?: { deviceId?: unknown }[];
  };
  try {
    payload = JSON.parse(card.statement.payload) as typeof payload;
  } catch {
    return true;
  }
  const active = identity.devices
    .filter((d) => !d.revokedAt)
    .map((d) => d.deviceId)
    .sort();
  const listed = (payload.devices ?? []).map((d) => String(d.deviceId)).sort();
  return (
    payload.displayName !== displayName.trim() ||
    payload.keySeq !== identity.keySeq ||
    JSON.stringify(payload.relays) !== JSON.stringify(profileCardRelays(here, identity)) ||
    JSON.stringify(active) !== JSON.stringify(listed)
  );
}

/** Sign a new profile card (version + 1) listing `relays`, without publishing it. */
export function signProfileCard(
  identity: MyKeyIdentity,
  displayName: string,
  relays: string[],
): Promise<SignedStatementInput> {
  return keyBackend().signProfileCard(enrolledId(identity), logStatements(identity.keyLog), {
    version: (identity.profileCard?.version ?? 0) + 1,
    displayName: displayName.trim(),
    relays,
    // The key backend lists a device only if its certificate verifies against the key log.
    certificates: identity.devices
      .filter((d) => !d.revokedAt)
      .map((d) => statementInput(d.certificate)),
  });
}

/**
 * Sign and publish a new profile card: display name, relays (`relays`, or the card's current
 * ones with this server among them), the active devices.
 *
 * @throws When this server's identity origin cannot be read and `relays` is not given.
 */
export async function publishProfileCard(
  identity: MyKeyIdentity,
  displayName: string,
  relays?: string[],
): Promise<void> {
  const listed = relays ?? profileCardRelays(await serverOrigin(), identity);
  const card = await signProfileCard(identity, displayName, listed);
  await graphqlClient.request(PUBLISH_CARD_MUTATION, { card });
}

/** The key log as statements, inception first, for signing elsewhere. */
export function keyLogStatements(identity: MyKeyIdentity): SignedStatementInput[] {
  return logStatements(identity.keyLog);
}

// ─── Recovery ───────────────────────────────────────────────────────────────

/** The account id (`rimp1_…`) in a pasted recovery kit, if there is one. */
export function accountIdInKit(kit: string): string | null {
  return /rimp1_[A-Za-z0-9_-]{43}/.exec(kit)?.[0] ?? null;
}

/**
 * Take an account back with its recovery kit, signed out, after losing every device: read the
 * account's public key log, sign a recovery rotation and a new device with the key backend, and
 * send them. The server signs out every other device. `kit` is a whole kit of either version, a
 * bare 12-word phrase or a bare `RK1-` key; the key backend reads it. This device then signs in
 * with the password ({@link signInWithPassword}).
 *
 * @returns The account's principal id.
 */
export async function recoverDeviceKeys(
  kit: string,
  accountId: string | null,
  deviceName: string,
): Promise<string> {
  const principalId = accountId?.trim() || accountIdInKit(kit);
  if (!principalId) {
    throw new Error(
      "Paste the whole recovery kit, or type the account id (it starts with rimp1_).",
    );
  }
  const { keyLog } = await graphqlClient.request<{ keyLog: StatementOnly[] }>(KEY_LOG_QUERY, {
    principalId,
  });
  const statements = await keyBackend().beginRecovery(
    getGraphqlEndpoint(),
    kit,
    principalId,
    logStatements(keyLog),
    deviceName,
  );
  const input: RotateIdentityKeyInput = { entry: statements.entry, device: statements.device };
  try {
    await graphqlClient.request(ROTATE_MUTATION, { input });
  } catch (err) {
    // Whether the rotation landed is in the key log, not in the error: an error can come
    // after the server committed it, or before it ever arrived.
    let landed: boolean;
    try {
      const fresh = await graphqlClient.request<{ keyLog: StatementOnly[] }>(KEY_LOG_QUERY, {
        principalId: statements.principalId,
      });
      // Anywhere in the log, not only at its head: a later rotation does not undo this one.
      landed = fresh.keyLog.some((e) => e.statement.payload === statements.entry.payload);
    } catch {
      // No answer either way: keep the keys for the next try.
      throw err;
    }
    if (!landed) {
      // Refused: drop the keys made for this attempt, putting back any it replaced.
      await keyBackend()
        .discardRecovery(statements.principalId, statements.deviceId)
        .catch(() => undefined);
      throw err;
    }
  }
  return statements.principalId;
}
