import { create } from "zustand";

import { onWsStatus, wsStatus, type WsStatus } from "../../../core/graphql/wsClient";

interface ConnectionState {
  /** The WebSocket's state, followed from the moment this store exists. */
  status: WsStatus;
  setStatus: (status: WsStatus) => void;
  lastDisconnectedAt: string | null;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: wsStatus(),
  setStatus: (status) =>
    set((state) => ({
      status,
      lastDisconnectedAt:
        status === "disconnected" ? new Date().toISOString() : state.lastDisconnectedAt,
    })),
  lastDisconnectedAt: null,
}));

onWsStatus((status) => useConnectionStore.getState().setStatus(status));
