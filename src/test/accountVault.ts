/**
 * The account vault in tests: unlocked with a fixed data key, so that the sealed stores read and
 * write as they do for a signed-in account.
 */

import { lockVault, unlockVault, type VaultAccount } from "../core/accountVault/accountVault";

/** The account a test vault holds unless a test names another. */
export const TEST_VAULT_ACCOUNT: VaultAccount = {
  endpoint: "http://localhost:8080/api",
  principalId: "rimp1_test-vault-account",
};

/** A fixed data key, so that what one test seals another could open. */
export const TEST_DATA_KEY = new Uint8Array(32).fill(7);

/** Unlock the vault for `account` with {@link TEST_DATA_KEY}, locking any account held before. */
export async function unlockTestVault(account: VaultAccount = TEST_VAULT_ACCOUNT): Promise<void> {
  lockVault();
  await unlockVault(account, TEST_DATA_KEY);
}
