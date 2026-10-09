/**
 * Key identity in the desktop app (master plan Stage 3; contract
 * `rim-server/docs/specs/key-identity-v1.md`): enrolling the account's key, creating an account
 * from a key alone, signing in with this device's key, devices, identity rotation, the profile
 * card and recovery.
 *
 * The keys live on the Tauri side (`src-tauri/src/key_identity`) and never reach the webview.
 * This module talks to the server and asks the Tauri side for each signed statement it needs,
 * so the session cookie a key sign-in sets lands in the webview like a password sign-in's.
 * Keys and signatures are opaque strings here: their algorithm is the Tauri side's business.
 */

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { getApiOrigin, getGraphqlEndpoint } from "../../../core/graphql/config";
import type {
  DeviceKey,
  EnrollIdentityKeyInput,
  KeyLoginChallenge,
  ProfileCard,
  RotateIdentityKeyInput,
  SignedStatement,
  SignedStatementInput,
  SignupWithKeyInput,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { safeInvoke } from "../../../core/tauri/safeInvoke";

// ─── What the Tauri side returns ────────────────────────────────────────────

/** An account on this server that this device holds keys for. */
export interface LocalKeyAccount {
  principalId: string;
  /** Unknown right after a recovery, until the first sign-in. */
  userId: string | null;
  username: string | null;
  deviceId: string;
  deviceName: string;
  /** This device holds the identity key (it enrolled the account). */
  hasIdentityKey: boolean;
  /** The server has shown these keys on the account. */
  confirmed: boolean;
}

/** A started enrollment: the new account id and the recovery kit, shown once. */
export interface EnrollmentDraft {
  draftId: string;
  principalId: string;
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

/** A Tauri key command; a failure becomes an `Error` with the command's message. */
async function keyCommand<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
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

function logStatements(log: StatementOnly[]): SignedStatementInput[] {
  return log.map(({ statement }) => statementInput(statement));
}

async function challenge(): Promise<Pick<KeyLoginChallenge, "challengeId" | "nonce">> {
  const res = await graphqlClient.request<{
    keyLoginChallenge: Pick<KeyLoginChallenge, "challengeId" | "nonce">;
  }>(CHALLENGE_MUTATION);
  return res.keyLoginChallenge;
}

// ─── Local accounts ─────────────────────────────────────────────────────────

/** Accounts on this server this device can sign in to with a key. Empty in the web app. */
export async function listDeviceKeyAccounts(): Promise<LocalKeyAccount[]> {
  const result = await safeInvoke<LocalKeyAccount[]>("key_identity_accounts", {
    endpoint: getGraphqlEndpoint(),
  });
  return result.ok ? result.value : [];
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
  return keyCommand<LocalKeyAccount | null>("key_identity_settle", {
    account: serverAccount(account),
    principalId,
  });
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
  await keyCommand<null>("key_identity_forget", { principalId });
}

export async function defaultDeviceName(): Promise<string> {
  const result = await safeInvoke<string>("key_identity_default_device_name");
  return result.ok ? result.value : "Desktop";
}

// ─── Sign-in ────────────────────────────────────────────────────────────────

/**
 * Sign in with this device's key for `principalId`: a fresh challenge, signed on the Tauri
 * side, sent to `loginWithKey`, which sets the session cookie. Returns the account's user id.
 * A revoked device fails with the server's `FORBIDDEN`.
 */
export async function signInWithDeviceKey(principalId: string): Promise<string> {
  const { challengeId, nonce } = await challenge();
  const proof = await keyCommand<SignedStatementInput>("key_identity_sign_login", {
    endpoint: getGraphqlEndpoint(),
    principalId,
    challenge: { challengeId, nonce },
  });
  const res = await graphqlClient.request<{ loginWithKey: { userId: string } }>(
    LOGIN_WITH_KEY_MUTATION,
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
export type KeySignupFields = Omit<SignupWithKeyInput, "keyLog" | "device" | "proof">;

/** The new account; `serverId` is set when a workspace invite also joined its workspace. */
export interface KeySignupResult {
  userId: string;
  serverId: string | null;
}

/** Signups sent to the server and not answered yet; their keys are never given up meanwhile. */
let signupsInFlight = 0;

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

/**
 * Create an account from a draft's keys alone, with no password and no email. The keys are
 * stored before `signupWithKey` is sent, so an account the server created never ends up
 * without them. When it fails, the key log says whether the account exists: if not, the keys
 * go and the draft stays, so a retry uses the same keys and the saved recovery kit; if an
 * earlier attempt whose answer was lost created it, this device signs in with its key; with no
 * answer either way the keys stay for a later sign-in. The server sets the session cookie.
 */
export async function signupWithKey(
  draft: EnrollmentDraft,
  fields: KeySignupFields,
): Promise<KeySignupResult> {
  const username = fields.username.trim();
  const { challengeId, nonce } = await challenge();
  const statements = await keyCommand<EnrollmentStatements>("key_identity_sign_signup", {
    draftId: draft.draftId,
    endpoint: getGraphqlEndpoint(),
    username,
    challenge: { challengeId, nonce },
  });
  const input: SignupWithKeyInput = { ...fields, username, ...statements };
  let result: KeySignupResult;
  signupsInFlight += 1;
  try {
    const res = await graphqlClient.request<{ signupWithKey: KeySignupResult }>(
      SIGNUP_WITH_KEY_MUTATION,
      { input },
    );
    result = res.signupWithKey;
  } catch (err) {
    const taken = await principalTaken(draft.principalId);
    if (taken === false) {
      await keyCommand<null>("key_identity_remove_draft_keys", { draftId: draft.draftId }).catch(
        () => undefined,
      );
    }
    if (!taken) throw err;
    // Signing in links the keys to the account and finishes the draft.
    return { userId: await signInWithDeviceKey(draft.principalId), serverId: null };
  } finally {
    signupsInFlight -= 1;
  }
  const displayName = fields.displayName?.trim() || username;
  // Best-effort from here: the account exists and the session is set. A later sign-in links
  // the keys, and Settings publishes a missing profile card.
  try {
    await settleDeviceKeys({ userId: result.userId, username }, draft.principalId);
    await publishProfileCard(await fetchMyKeyIdentity(), displayName);
  } catch (err) {
    logger.warn("[RIM:keys] finishing the key signup failed:", err);
  }
  return result;
}

/**
 * Give up on a signup draft (discarded, or the page left). Its keys are removed only when the
 * server holds no account with them; if an attempt whose answer was lost created one, or the
 * server cannot say, they stay to sign in with.
 */
export async function abandonKeySignup(draft: EnrollmentDraft): Promise<void> {
  if (signupsInFlight > 0) return;
  if ((await principalTaken(draft.principalId)) !== false) return;
  await keyCommand<null>("key_identity_discard_enrollment", { draftId: draft.draftId });
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

export async function revokeDevice(identity: MyKeyIdentity, deviceId: string): Promise<void> {
  const revocation = await keyCommand<SignedStatementInput>("key_identity_sign_revocation", {
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
    deviceId,
  });
  await graphqlClient.request(REVOKE_MUTATION, { revocation });
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

/** Where this account can be reached: this server, as the card's one relay. */
export function profileCardRelays(): string[] {
  return [getApiOrigin()];
}

/**
 * Whether the published card is missing or no longer says what it should: the display name,
 * the relays, the active devices, or the identity key that signed it.
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
    JSON.stringify(payload.relays) !== JSON.stringify(profileCardRelays()) ||
    JSON.stringify(active) !== JSON.stringify(listed)
  );
}

/** Sign and publish a new profile card: display name, this server, the active devices. */
export async function publishProfileCard(
  identity: MyKeyIdentity,
  displayName: string,
): Promise<void> {
  const card = await keyCommand<SignedStatementInput>("key_identity_sign_profile_card", {
    principalId: identity.principalId,
    keyLog: logStatements(identity.keyLog),
    card: {
      version: (identity.profileCard?.version ?? 0) + 1,
      displayName: displayName.trim(),
      relays: profileCardRelays(),
      // The Tauri side lists a device only if its certificate verifies against the key log.
      certificates: identity.devices
        .filter((d) => !d.revokedAt)
        .map((d) => statementInput(d.certificate)),
    },
  });
  await graphqlClient.request(PUBLISH_CARD_MUTATION, { card });
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
