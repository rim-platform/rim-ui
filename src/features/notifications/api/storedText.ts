import { BUS_EVENTS, type MessagesDecryptedEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";
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

/** How long a notification waits for its encrypted message to be decrypted on this device. */
export const DECRYPT_WAIT_MS = 4_000;

/**
 * {@link storedText}, waiting for the message to be decrypted when the store does not hold it
 * yet: a notification usually arrives while the sync that decrypts its message is still running.
 *
 * @param messageId - The encrypted message.
 * @param timeoutMs - How long to wait for its decryption.
 * @returns The text, or `null` when the store still does not hold it decrypted once the sync
 * that carried it finished or `timeoutMs` passed, or when this device has no store.
 */
export function storedTextSoon(
  messageId: string,
  timeoutMs: number = DECRYPT_WAIT_MS,
): Promise<string | null> {
  if (!encryptedStoreAccount()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve(text);
    };
    // Subscribed before the first read, so a decryption between the two is not missed.
    const off = eventBus.on<MessagesDecryptedEvent>(BUS_EVENTS.MESSAGES_DECRYPTED, (event) => {
      if (event.messageIds.includes(messageId)) void storedText(messageId).then(finish);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    void storedText(messageId).then((text) => {
      if (text !== null) finish(text);
    });
  });
}
