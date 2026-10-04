import { create } from "zustand";

type ConnectionStatus = "connected" | "connecting" | "disconnected";

interface ConnectionState {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
  lastDisconnectedAt: string | null;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "connecting",
  setStatus: (status) =>
    set((state) => ({
      status,
      lastDisconnectedAt:
        status === "disconnected" ? new Date().toISOString() : state.lastDisconnectedAt,
    })),
  lastDisconnectedAt: null,
}));
