import { create } from "zustand";

type AuthSession = {
  userId: string;
};

type AuthState = {
  session: AuthSession | null;
  /** The server ended the last session; sign-in says so until the next session starts. */
  sessionEnded: boolean;
  setSession: (session: AuthSession) => void;
  clearSession: () => void;
  /** Drops the session because the server ended it. */
  endSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  sessionEnded: false,
  setSession: (session) => set({ session, sessionEnded: false }),
  clearSession: () => set({ session: null, sessionEnded: false }),
  endSession: () => set({ session: null, sessionEnded: true }),
}));
