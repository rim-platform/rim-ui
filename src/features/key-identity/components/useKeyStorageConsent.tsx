import { useRef, useState, type ReactNode } from "react";

import { requestKeyStorage } from "../api/keyIdentity";
import { StorageRefusedPrompt } from "./StorageRefusedPrompt";

/** What `useKeyStorageConsent` gives a form that creates keys. */
export interface KeyStorageConsent {
  /**
   * Ask the platform to keep the keys' storage before keys are made. Resolves `true` at once
   * when it will (or cannot say); after a refusal, once the person accepts the risk (`false` if
   * they go back). The answer is remembered for the form's lifetime.
   */
  ensure: () => Promise<boolean>;
  /** The question after a refusal, to render where the form's buttons are; `null` otherwise. */
  prompt: ReactNode;
}

/**
 * Before a signup or enrollment creates keys: asks the browser for persistent storage and, when
 * it refuses, says what that means and lets the person go on or go back.
 */
export function useKeyStorageConsent(): KeyStorageConsent {
  const [answer, setAnswer] = useState<((accepted: boolean) => void) | null>(null);
  const accepted = useRef(false);

  async function ensure(): Promise<boolean> {
    if (accepted.current) return true;
    if ((await requestKeyStorage()) !== "refused") return true;
    return new Promise<boolean>((resolve) => {
      setAnswer(() => (yes: boolean) => {
        setAnswer(null);
        if (yes) accepted.current = true;
        resolve(yes);
      });
    });
  }

  const prompt = answer ? (
    <StorageRefusedPrompt onContinue={() => answer(true)} onBack={() => answer(false)} />
  ) : null;
  return { ensure, prompt };
}
