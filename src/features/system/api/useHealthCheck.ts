import { useQuery } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { queryKeys } from "../../../core/query/keys";

/**
 * Lightweight connectivity probe using a minimal introspection query.
 * Does not require authentication.
 */
export function useHealthCheck() {
  return useQuery({
    queryKey: queryKeys.healthCheck,
    queryFn: async (): Promise<boolean> => {
      const res = await fetch(getGraphqlEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ __schema { queryType { name } } }" }),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0]?.message ?? "GraphQL error");
      return true;
    },
    retry: 2,
    refetchInterval: 30_000,
  });
}
