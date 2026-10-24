import { create } from "zustand";

type AuthSession = {
  userId: string;
};

type AuthState = {
  session: AuthSession | null;
  /** The server ended the last session; sign-in says so until the next session starts. */
  sessionEnded: boolean;
  /** The CSRF token the last sign-in returned; `null` for a restored session or none. */
  csrfToken: string | null;
  /** The last sign-in's account has no password yet: the session may only set one. */
  mustSetPassword: boolean;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
  setCsrfToken: (csrfToken: string) => void;
  setMustSetPassword: (mustSetPassword: boolean) => void;
  /** Drops the session because the server ended it. */
  endSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  sessionEnded: false,
  csrfToken: null,
  mustSetPassword: false,
  setSession: (session) => set({ session, sessionEnded: false }),
  clearSession: () =>
    set({ session: null, sessionEnded: false, csrfToken: null, mustSetPassword: false }),
  setCsrfToken: (csrfToken) => set({ csrfToken }),
  setMustSetPassword: (mustSetPassword) => set({ mustSetPassword }),
  endSession: () =>
    set({ session: null, sessionEnded: true, csrfToken: null, mustSetPassword: false }),
}));
