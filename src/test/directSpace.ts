import { useRelayStore } from "../features/relay/state/useRelayStore";

/** This relay's direct space in tests. */
export const DIRECT_SPACE_ID = "direct-1";

/** The relay as started for `u1` once `relayInfo` answers, with `DIRECT_SPACE_ID` as its direct space. */
export function startRelayWithDirectSpace(): void {
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: DIRECT_SPACE_ID },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
}
