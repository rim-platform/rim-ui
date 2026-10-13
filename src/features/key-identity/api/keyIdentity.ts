/**
 * Key identity: enrolling the account's key, creating an account from a key alone, signing in
 * with this device's key, devices, identity rotation, the profile card and recovery.
 *
 * On the desktop the keys live on the Tauri side (`src-tauri/src/key_identity`) and never reach
 * the webview: this module talks to the server and asks the Tauri side for each signed
 * statement it needs, so the session cookie a key sign-in sets lands in the webview like a
 * password sign-in's. In the web app, signing in uses the browser's device key
 * (`keyBackend`); everything that needs the identity key stays desktop-only. Keys and
 * signatures are opaque strings here: their algorithm is the key backend's business.
 */

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { getApiOrigin, getGraphqlEndpoint } from "../../../core/graphql/config";
import {
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  VALIDATION,
} from "../../../core/graphql/errors";
import type {
  DeviceKey,
  EnrollIdentityKeyInput,
  KeyLoginChallenge,
  ProfileCard,
  RotateIdentityKeyInput,
  SignedStatement,
  SignedStatementInput,
  SignupWithInvitePayloadGql,
  SignupWithKeyInput,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { signInRequest } from "../../auth/api/signInRequest";
import { MAX_CARD_RELAYS } from "../../relay/contacts/contactLink";
import {
  readRegistration,
  solveProofOfWork,
  type RelayRegistration,
} from "../../relay/pow/proofOfWork";
import { keyBackend, keyCommand, type LocalKeyAccount } from "./keyBackend";

export { keyCommand, type LocalKeyAccount } from "./keyBackend";

// ─── What the Tauri side returns ────────────────────────────────────────────

/** A started enrollment: the new account id and the recovery kit, shown once. */
export interface EnrollmentDraft {
  draftId: string;
  principalId: string;
  /** The payload of the key log's inception, which a signup's proof-of-work is bound to. */
  inceptionPayload: string;
  /** The whole kit text (`RIM recovery kit (v2)` …), to copy. */
  recoveryKit: string;
  /** The kit's 12 recovery phrase words in order, to show as a numbered grid. */
  recoveryPhrase: string[];
}

/** The server's key log, verified on this device. */
export interface LogStatus {
  principalId: string;
  seq: number;
  /** This device can add and revoke devices, rotate and publish the profile card. */
  holdsIdentityKey: boolean;
}

interface EnrollmentStatements {
  keyLog: SignedStatementInput[];
  device: SignedStatementInput;
  proof: SignedStatementInput;
}

interface RecoveryStatements {
  principalId: string;
  deviceId: string;
  entry: SignedStatementInput;
  device: SignedStatementInput;
}

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
  mutation LoginWithKey($proof: SignedStatementInput!) {
    loginWithKey(proof: $proof) {
      userId
      csrfToken
    }
  }
`;

/** The same without `csrfToken`, for a server older than it. */
const LOGIN_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION = gql`
  mutation LoginWithKeyWithoutCsrfToken($proof: SignedStatementInput!) {
    loginWithKey(proof: $proof) {
      userId
    }
  }
`;

const ENROLL_MUTATION = gql`
  mutation EnrollIdentityKey($input: EnrollIdentityKeyInput!) {
    enrollIdentityKey(input: $input) {
      principalId
    }
  }
`;

const SIGNUP_WITH_KEY_MUTATION = gql`
  mutation SignupWithKey($input: SignupWithKeyInput!) {
    signupWithKey(input: $input) {
      userId
      serverId
      csrfToken
    }
  }
`;

/** The same without `csrfToken`, for a server older than it. */
const SIGNUP_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION = gql`
  mutation SignupWithKeyWithoutCsrfToken($input: SignupWithKeyInput!) {
    signupWithKey(input: $input) {
      userId
      serverId
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
 * server shows are confirmed and linked to the account, leftover keys from an enrollment it
 * never accepted are removed.
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
  // An enrollment in flight may land after the server's answer: its keys are not leftovers.
  if (enrollmentsInFlight > 0) return null;
  return settleDeviceKeys(account, await serverPrincipalId());
}

export async function forgetDeviceKeys(principalId: string): Promise<void> {
  await keyBackend().forget(principalId);
}

export async function defaultDeviceName(): Promise<string> {
  return keyBackend().defaultDeviceName();
}

// ─── Sign-in ────────────────────────────────────────────────────────────────

/**
 * Sign in with this device's key for `principalId`: a fresh challenge, signed by the key
 * backend, sent to `loginWithKey`, which sets the session cookie. Returns the account's user id.
 * A revoked device fails with the server's `FORBIDDEN`.
 */
export async function signInWithDeviceKey(principalId: string): Promise<string> {
  const { challengeId, nonce } = await challenge();
  const proof = await keyBackend().signLogin(getGraphqlEndpoint(), principalId, {
    challengeId,
    nonce,
  });
  const res = await signInRequest<{ loginWithKey: { userId: string } }>(
    "loginWithKey",
    LOGIN_WITH_KEY_MUTATION,
    LOGIN_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION,
    { proof },
  );
  // Best-effort: link the keys to the account now that the server named it.
  try {
    const { me } = await graphqlClient.request<{ me: MeAccount }>(ME_ACCOUNT_QUERY);
    await settleDeviceKeys({ userId: me.id, username: me.username }, me.principalId);
  } catch {
    // The sign-in itself succeeded; the next settle links the keys.
  }
  return res.loginWithKey.userId;
}

/**
 * Sign in again, without asking the person, as the account `userId` was signed in to: used
 * when a cold start or a reconnect finds the session cookie gone or expired. Returns the user
 * id, or `null` when this device holds no key for that account or the key sign-in fails (a
 * revoked device, for instance), so the caller falls back to the sign-in screen.
 */
export async function resumeWithDeviceKey(userId: string): Promise<string | null> {
  const account = (await listDeviceKeyAccounts()).find((a) => a.userId === userId);
  if (!account) return null;
  try {
    const signedIn = await signInWithDeviceKey(account.principalId);
    return signedIn === userId ? signedIn : null;
  } catch (err) {
    logger.warn("[RIM:keys] signing in with this device's key failed:", err);
    return null;
  }
}

// ─── Enrollment ─────────────────────────────────────────────────────────────

/**
 * Enrollments sent to the server and not answered yet. While one is in flight, the server
 * saying "not enrolled" proves nothing, so nothing removes keys on that basis.
 */
let enrollmentsInFlight = 0;

/** Create the keys of a new identity; the recovery kit in the result is shown once. */
export async function beginEnrollment(deviceName: string): Promise<EnrollmentDraft> {
  return keyCommand<EnrollmentDraft>("key_identity_begin_enrollment", { deviceName });
}

/** The signed-in account's `principalId` as the server has it now. */
async function serverPrincipalId(): Promise<string | null> {
  const { me } = await graphqlClient.request<{ me: MeAccount }>(ME_ACCOUNT_QUERY);
  return me.principalId;
}

/**
 * Give up on an enrollment (cancelled, or the settings closed). Its keys are removed only when
 * the server says the account is not enrolled with them: if an attempt whose answer was lost
 * did enroll it, the keys are kept, since the password no longer signs in. Without an answer
 * the keys stay, and a later settle cleans them up.
 */
export async function abandonEnrollment(
  draft: EnrollmentDraft,
  account: KeyAccount,
): Promise<void> {
  if (enrollmentsInFlight > 0) return;
  let principalId: string | null;
  try {
    principalId = await serverPrincipalId();
  } catch {
    return;
  }
  if (principalId === draft.principalId) {
    await settleDeviceKeys(account, principalId);
  } else {
    await keyCommand<null>("key_identity_discard_enrollment", { draftId: draft.draftId });
  }
}

/**
 * Enroll the signed-in account with a draft's keys. The keys are stored before the server is
 * asked, so the account never ends up enrolled without them. A failure leaves the draft in
 * place, so the person can retry with the recovery kit they already saved.
 */
export async function completeEnrollment(
  draft: EnrollmentDraft,
  account: KeyAccount & { displayName: string },
): Promise<void> {
  const { challengeId, nonce } = await challenge();
  const statements = await keyCommand<EnrollmentStatements>("key_identity_sign_enrollment", {
    draftId: draft.draftId,
    account: serverAccount(account),
    challenge: { challengeId, nonce },
  });
  const input: EnrollIdentityKeyInput = statements;
  enrollmentsInFlight += 1;
  try {
    await graphqlClient.request(ENROLL_MUTATION, { input });
  } catch (err) {
    // An earlier attempt whose answer was lost may have enrolled the account already.
    if ((await serverPrincipalId().catch(() => null)) !== draft.principalId) throw err;
  } finally {
    enrollmentsInFlight -= 1;
  }
  await settleDeviceKeys(account, draft.principalId);
  // Best-effort: the card can be published later from Settings.
  try {
    await publishProfileCard(await fetchMyKeyIdentity(), account.displayName);
  } catch {
    // Settings shows the card as not published and offers to publish it.
  }
}

// ─── Key-only signup ────────────────────────────────────────────────────────

/** What the join page fills in for `signupWithKey`: the name and the page's token, if any. */
export type KeySignupFields = Omit<
  SignupWithKeyInput,
  "keyLog" | "device" | "proof" | "proofOfWork"
>;

/** How a signup reports and stops the proof-of-work a relay in `pow` mode asks for. */
export interface KeySignupOptions {
  /** Told when a proof-of-work of `bits` bits starts; it ends when the signup settles. */
  onProofOfWork?: (bits: number) => void;
  /** Aborting stops the proof-of-work: the signup then fails with `PowCancelled`. */
  signal?: AbortSignal;
}

/** The new account; `serverId` is set when a workspace invite also joined its workspace. */
export type KeySignupResult = Pick<SignupWithInvitePayloadGql, "userId"> & {
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
 * The proof-of-work this server asks of a signup with no token, over the draft's inception:
 * `undefined` when its verified discovery document names another registration mode, or cannot
 * be read (the server then says what it wants). A retry with the same draft reuses the nonce.
 */
async function proofOfWorkFor(
  draft: EnrollmentDraft,
  fields: KeySignupFields,
  options: KeySignupOptions,
): Promise<string | undefined> {
  if (hasToken(fields)) return undefined;
  let registration: RelayRegistration;
  try {
    registration = await readRegistration(getApiOrigin());
  } catch (err) {
    logger.warn("[RIM:keys] reading this server's registration mode failed:", err);
    return undefined;
  }
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
 * failed attempt may have removed them), sign in with the device key, which links the keys to
 * the account, and publish the profile card. The server id is `null`: the answer that named it
 * was lost and the invite token is used up, so the caller fills in the workspace of the invite
 * it previewed.
 */
async function finishTakenSignup(draft: EnrollmentDraft): Promise<KeySignupResult> {
  const fields = sentSignups.get(draft.draftId);
  if (fields) {
    await keyCommand<null>("key_identity_restore_draft_keys", {
      draftId: draft.draftId,
      endpoint: getGraphqlEndpoint(),
      username: fields.username,
    });
  }
  const userId = await signInWithDeviceKey(draft.principalId);
  if (fields) await publishFirstCard(fields);
  sentSignups.delete(draft.draftId);
  return { userId, serverId: null };
}

/**
 * Create an account from a draft's keys alone, with no password and no email. The keys are
 * stored before `signupWithKey` is sent, so an account the server created never ends up
 * without them. When it fails, the key log says whether the account exists: if not, the keys
 * go and the draft stays, so a retry uses the same keys and the saved recovery kit; if an
 * earlier attempt whose answer was lost created it, this device signs in with its key; with no
 * answer either way the keys stay for a later sign-in. The server sets the session cookie.
 *
 * Without a token, on a relay in `pow` registration mode, the proof-of-work is found first,
 * before the challenge is fetched, so the challenge does not expire while it runs.
 */
export async function signupWithKey(
  draft: EnrollmentDraft,
  fields: KeySignupFields,
  options: KeySignupOptions = {},
): Promise<KeySignupResult> {
  const sent: KeySignupFields = { ...fields, username: fields.username.trim() };
  const proofOfWork = await proofOfWorkFor(draft, sent, options);
  let challengeId: string;
  let nonce: string;
  try {
    ({ challengeId, nonce } = await challenge());
  } catch (err) {
    throw new KeyChallengeFailed(err);
  }
  const statements = await keyCommand<EnrollmentStatements>("key_identity_sign_signup", {
    draftId: draft.draftId,
    endpoint: getGraphqlEndpoint(),
    username: sent.username,
    challenge: { challengeId, nonce },
  });
  sentSignups.set(draft.draftId, sent);
  const input: SignupWithKeyInput = { ...sent, ...statements, ...(proofOfWork && { proofOfWork }) };
  let result: KeySignupResult;
  signupsInFlight += 1;
  try {
    const res = await signInRequest<{ signupWithKey: SignupWithInvitePayloadGql }>(
      "signupWithKey",
      SIGNUP_WITH_KEY_MUTATION,
      SIGNUP_WITH_KEY_WITHOUT_CSRF_TOKEN_MUTATION,
      { input },
    );
    result = { userId: res.signupWithKey.userId, serverId: res.signupWithKey.serverId ?? null };
  } catch (err) {
    // A refused nonce is searched for again, against the relay's discovery document as it is.
    if (proofOfWorkRefused(err)) proofs.delete(draft.draftId);
    const taken = await principalTaken(draft.principalId);
    if (taken === false) {
      await keyCommand<null>("key_identity_remove_draft_keys", { draftId: draft.draftId }).catch(
        () => undefined,
      );
    }
    if (!taken) throw err;
    return await finishTakenSignup(draft);
  } finally {
    signupsInFlight -= 1;
  }
  sentSignups.delete(draft.draftId);
  proofs.delete(draft.draftId);
  // Best-effort from here: the account exists and the session is set. A later sign-in links
  // the keys.
  try {
    await settleDeviceKeys({ userId: result.userId, username: sent.username }, draft.principalId);
  } catch (err) {
    logger.warn("[RIM:keys] linking the keys after signup failed:", err);
  }
  await publishFirstCard(sent);
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
    await keyCommand<null>("key_identity_discard_enrollment", { draftId: draft.draftId });
  }
  return taken;
}

/**
 * The person discards a signup draft. Its keys go only when the server holds no account with
 * them. If an attempt the client saw fail created the account after all, the account gets its
 * keys back and this device signs in to it: the result is that account, else `null`.
 */
export async function discardKeySignup(draft: EnrollmentDraft): Promise<KeySignupResult | null> {
  if ((await discardUnlessTaken(draft)) !== true) return null;
  return finishTakenSignup(draft);
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
  await keyCommand<null>("key_identity_restore_draft_keys", {
    draftId: draft.draftId,
    endpoint: getGraphqlEndpoint(),
    username: fields.username,
  });
}

/**
 * After a device-key sign-in failed: remove this device's keys for an account the server has
 * never seen, such as a signup or enrollment whose request never reached it (the app quit, the
 * page closed). Only unconfirmed keys whose principal has no key log on the server go. Returns
 * whether they did.
 */
export async function forgetKeysTheServerNeverSaw(account: LocalKeyAccount): Promise<boolean> {
  if (account.confirmed || signupsInFlight > 0 || enrollmentsInFlight > 0) return false;
  if ((await principalTaken(account.principalId)) !== false) return false;
  await keyBackend().forgetUnconfirmed(account.principalId);
  return true;
}

// ─── Devices, rotation, profile card ────────────────────────────────────────

/** Verify the server's key log here and settle a pending rotation against it. */
export async function syncKeyLog(identity: MyKeyIdentity): Promise<LogStatus | null> {
  if (!identity.principalId) return null;
  return keyCommand<LogStatus>("key_identity_sync_log", {
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
  });
}

/** Revoke a device; returns the signed revocation, which other servers are sent too. */
export async function revokeDevice(
  identity: MyKeyIdentity,
  deviceId: string,
): Promise<SignedStatementInput> {
  const revocation = await keyCommand<SignedStatementInput>("key_identity_sign_revocation", {
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
    deviceId,
  });
  await graphqlClient.request(REVOKE_MUTATION, { revocation });
  return revocation;
}

/** Replace the identity key. The recovery key and every device stay. */
export async function rotateIdentityKey(identity: MyKeyIdentity): Promise<void> {
  const entry = await keyCommand<SignedStatementInput>("key_identity_begin_rotation", {
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
  });
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
 */
export function profileCardRelays(identity?: MyKeyIdentity): string[] {
  const here = getApiOrigin();
  const listed = identity ? publishedRelays(identity) : [];
  return listed.includes(here) ? listed : [here, ...listed].slice(0, MAX_CARD_RELAYS);
}

/**
 * Whether the published card is missing or no longer says what it should: the display name,
 * the relays (this server must be one), the active devices, or the identity key that signed it.
 */
export function profileCardIsStale(identity: MyKeyIdentity, displayName: string): boolean {
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
    JSON.stringify(payload.relays) !== JSON.stringify(profileCardRelays(identity)) ||
    JSON.stringify(active) !== JSON.stringify(listed)
  );
}

/** Sign a new profile card (version + 1) listing `relays`, without publishing it. */
export function signProfileCard(
  identity: MyKeyIdentity,
  displayName: string,
  relays: string[],
): Promise<SignedStatementInput> {
  return keyCommand<SignedStatementInput>("key_identity_sign_profile_card", {
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
    card: {
      version: (identity.profileCard?.version ?? 0) + 1,
      displayName: displayName.trim(),
      relays,
      // The Tauri side lists a device only if its certificate verifies against the key log.
      certificates: identity.devices
        .filter((d) => !d.revokedAt)
        .map((d) => statementInput(d.certificate)),
    },
  });
}

/**
 * Sign and publish a new profile card: display name, relays (`relays`, or the card's current
 * ones with this server among them), the active devices.
 */
export async function publishProfileCard(
  identity: MyKeyIdentity,
  displayName: string,
  relays: string[] = profileCardRelays(identity),
): Promise<void> {
  const card = await signProfileCard(identity, displayName, relays);
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
 * account's public key log, sign a recovery rotation and a new device on the Tauri side, send
 * them, and sign in with the new device key. The server signs out every other device.
 * `kit` is a whole kit of either version, a bare 12-word phrase or a bare `RK1-` key; the
 * Tauri side reads it. Returns the account's user id.
 */
export async function recoverAccount(
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
  const statements = await keyCommand<RecoveryStatements>("key_identity_begin_recovery", {
    endpoint: getGraphqlEndpoint(),
    kit,
    accountId: principalId,
    keyLog: logStatements(keyLog),
    deviceName,
  });
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
      await keyCommand<null>("key_identity_discard_recovery", {
        principalId: statements.principalId,
        deviceId: statements.deviceId,
      }).catch(() => undefined);
      throw err;
    }
  }
  return signInWithDeviceKey(statements.principalId);
}
