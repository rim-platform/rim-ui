import { useQuery } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { listDeviceKeyAccounts } from "./keyIdentity";

/** The accounts on this server that this device holds a key for; idle where it can hold none. */
export function useDeviceKeyAccounts() {
  const { capabilities } = useRuntime();
  return useQuery({
    queryKey: queryKeys.deviceKeyAccounts(getGraphqlEndpoint()),
    queryFn: listDeviceKeyAccounts,
    enabled: capabilities.deviceKeys,
  });
}
