import { encryptedStoreAccount, readCachedMessage } from "../../messages/api/messageCache";
import { isPlaceholder } from "../../e2ee/utils/timeline";

/** What a notification shows for an encrypted message this device cannot read (yet). */
export const ENCRYPTED_MESSAGE_TEXT = "Encrypted message";

/**
 * The decrypted text of an encrypted message, from this device's store (the desktop cache or the
 * web app's encrypted store).
 *
 * @returns The text, or `null` when the store does not hold the message decrypted: not synced
 * yet, a placeholder, or no store on this device.
 */
export async function storedText(messageId: string): Promise<string | null> {
  const account = encryptedStoreAccount();
  if (!account) return null;
  const stored = await readCachedMessage(account, messageId);
  return stored && !isPlaceholder(stored) ? stored.text : null;
}
