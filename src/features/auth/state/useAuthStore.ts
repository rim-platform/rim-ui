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
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
  setCsrfToken: (csrfToken: string) => void;
  /** Drops the session because the server ended it. */
  endSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  sessionEnded: false,
  csrfToken: null,
  setSession: (session) => set({ session, sessionEnded: false }),
  clearSession: () => set({ session: null, sessionEnded: false, csrfToken: null }),
  setCsrfToken: (csrfToken) => set({ csrfToken }),
  endSession: () => set({ session: null, sessionEnded: true, csrfToken: null }),
}));
