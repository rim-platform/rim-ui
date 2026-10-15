import type { EnrollmentDraft, LocalKeyAccount } from "../features/key-identity/api/keyIdentity";

/** The signed-in account the key identity fixtures use. */
export const KEY_ACCOUNT = { userId: "u-alice", username: "alice" };

/** Its account id once enrolled. */
export const KEY_PRINCIPAL = "rimp1_alice";

export const RECOVERY_PHRASE =
  "abandon amount liar amount expire adjust cage candy arch gather drum buyer".split(" ");

export const RECOVERY_KIT = `RIM recovery kit (v2)\nAccount id: ${KEY_PRINCIPAL}\nRecovery phrase: ${RECOVERY_PHRASE.join(" ")}\n`;

/** A started enrollment of the account, as `beginEnrollment` returns it. */
export const enrollmentDraft: EnrollmentDraft = {
  draftId: "draft-1",
  principalId: KEY_PRINCIPAL,
  inceptionPayload: "{}",
  recoveryKit: RECOVERY_KIT,
  recoveryPhrase: RECOVERY_PHRASE,
};

/** This device's confirmed key for the account. */
export const localKeyAccount: LocalKeyAccount = {
  principalId: KEY_PRINCIPAL,
  userId: KEY_ACCOUNT.userId,
  username: KEY_ACCOUNT.username,
  deviceId: "d-this",
  deviceName: "Laptop",
  hasIdentityKey: true,
  confirmed: true,
};
