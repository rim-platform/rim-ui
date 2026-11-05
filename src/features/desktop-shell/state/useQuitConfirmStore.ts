import { create } from "zustand";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { logger } from "../../../core/logger";
import { accountIsKept } from "../../auth/api/accountLock";
import { principalOf } from "../../auth/runtime/unlockGate";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { desktopShellAvailable } from "../availability";

/** The quit confirmation waiting for an answer. */
export interface QuitConfirmation {
  /** The account is not kept on this device, so the next start asks for its password. */
  needsPassword: boolean;
}

interface QuitConfirmState {
  request: QuitConfirmation | null;
  open: (request: QuitConfirmation) => void;
  close: () => void;
}

/** The quit confirmation of Ctrl+Q and the `app.quit` command. Only the dialog answers it. */
export const useQuitConfirmStore = create<QuitConfirmState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/**
 * Whether the signed-in account will need its password at the next start. With no signed-in
 * account, or when this device cannot tell, the answer is `false`, and the dialog says nothing
 * about a password.
 */
async function accountNeedsPassword(): Promise<boolean> {
  const userId = useAuthStore.getState().session?.userId;
  if (!userId) return false;
  try {
    const principal = await principalOf(getGraphqlEndpoint(), userId);
    return principal !== null && !(await accountIsKept(principal));
  } catch (error) {
    logger.warn("[RIM:desktop] could not check whether the account is kept:", error);
    return false;
  }
}

let opening = false;

/**
 * Opens the quit confirmation, which is all this does: a person still decides. Nothing happens
 * outside the desktop app or while the confirmation is already open or opening.
 */
export async function requestQuit(): Promise<void> {
  if (!desktopShellAvailable() || opening || useQuitConfirmStore.getState().request) return;
  opening = true;
  try {
    const needsPassword = await accountNeedsPassword();
    useQuitConfirmStore.getState().open({ needsPassword });
  } finally {
    opening = false;
  }
}
