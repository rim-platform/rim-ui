import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import type { ServerFeatureKey } from "../../../core/serverFeatures";
import { useServerInfo } from "./useServerInfo";

/** Whether one optional feature works on the connected server. */
export interface ServerFeatureView {
  /**
   * The feature works, or its state is not known yet (loading, unreachable, or a server that
   * does not list it), so nothing hides before the server says so. The server enforces the
   * switch either way.
   */
  enabled: boolean;
  /** The state the server reports; `undefined` while it is not known. */
  state: ServerFeatureState | undefined;
  /** Why an unavailable feature is unavailable; `null` otherwise. */
  reason: string | null;
}

/** The connected server's state of `key`, read from `serverInfo.features`. */
export function useServerFeature(key: ServerFeatureKey): ServerFeatureView {
  const { info } = useServerInfo();
  const entry = info?.features?.find((f) => f.key === key);
  const state = entry?.state;
  return {
    enabled: state === undefined || state === ServerFeatureState.ENABLED,
    state,
    reason: entry?.reason ?? null,
  };
}
