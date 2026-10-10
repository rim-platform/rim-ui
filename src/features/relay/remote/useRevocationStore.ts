/**
 * Device revocations this app is following to every host, kept in the relay store so the
 * direct sending 2 minutes in survives a restart.
 */

import { create } from "zustand";

import type { Statement } from "../../key-identity/browser/statements";
import { allRecords, deleteRecord, putRecord } from "../state/relayDb";
import { accountKey } from "../state/spaces";
import type { HostRevocation } from "./revocationFanout";

/** A revocation followed to every host. */
export interface FollowedRevocation {
  deviceId: string;
  revocation: Statement;
  revokedAt: number;
  /** Set once the app sent it directly to the hosts still waiting; their outcome. */
  direct: HostRevocation[] | null;
}

interface RevocationRecord extends FollowedRevocation {
  account: string;
  name: string;
}

interface RevocationState {
  followed: FollowedRevocation[];
  load: (account: string) => Promise<void>;
  follow: (account: string, entry: FollowedRevocation) => Promise<void>;
  dismiss: (account: string, deviceId: string) => Promise<void>;
}

const PREFIX = "revocation:";

function record(account: string, entry: FollowedRevocation): RevocationRecord {
  return { account, name: `${PREFIX}${entry.deviceId}`, ...entry };
}

export const useRevocationStore = create<RevocationState>((set, get) => ({
  followed: [],
  async load(account) {
    const records = (await allRecords<RevocationRecord>("meta")).filter(
      (r) => r.account === account && r.name.startsWith(PREFIX),
    );
    set({
      followed: records.map(({ deviceId, revocation, revokedAt, direct }) => ({
        deviceId,
        revocation,
        revokedAt,
        direct,
      })),
    });
  },
  async follow(account, entry) {
    set({ followed: [...get().followed.filter((f) => f.deviceId !== entry.deviceId), entry] });
    await putRecord("meta", record(account, entry));
  },
  async dismiss(account, deviceId) {
    set({ followed: get().followed.filter((f) => f.deviceId !== deviceId) });
    await deleteRecord("meta", [account, `${PREFIX}${deviceId}`]);
  },
}));

/** Start following a revocation the relay committed, if the relay runs for this account. */
export async function followRevocation(deviceId: string, revocation: Statement): Promise<void> {
  const account = accountKey();
  if (!account) return;
  await useRevocationStore
    .getState()
    .follow(account, { deviceId, revocation, revokedAt: Date.now(), direct: null });
}
