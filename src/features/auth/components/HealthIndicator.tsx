/**
 * `HealthIndicator` — the server line under the sign-in heading: a coloured dot, the address of
 * the server this app talks to and whether it answers. When it does not, a bar says so and
 * points to another server. It reads the health check the page already runs and the address
 * of the endpoint; it makes no request of its own.
 */

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { endpointHost, getGraphqlEndpoint } from "../../../core/graphql/config";
import { useHealthCheck } from "../../system/api/useHealthCheck";
import { cn } from "../../../shared/ui/cn";

/** The address shown for the server, or an empty string when none is known. */
function serverAddress(): string {
  const endpoint = getGraphqlEndpoint();
  return endpoint ? endpointHost(endpoint) : "";
}

/**
 * The server line of the auth screens: green and "reachable", amber while connecting, red
 * when the address is blocked, and a danger bar when the server does not answer.
 */
export function HealthIndicator() {
  const { isSuccess, isError } = useHealthCheck();
  const blocked = useEdgeStore((s) => s.blocked);
  const address = serverAddress();

  if (isError && !blocked && !isSuccess) {
    return (
      <p
        role="status"
        className="rounded-[10px] border border-rim-danger-solid/50 bg-rim-danger-solid/15 px-3 py-2.5 text-left text-sm text-rim-danger"
      >
        <strong className="font-semibold">
          {address ? `Can't reach ${address}.` : "Can't reach the server."}
        </strong>{" "}
        Check your connection, or use another server.
      </p>
    );
  }

  const color = isSuccess ? "bg-rim-success" : blocked ? "bg-rim-danger" : "bg-rim-warm";
  const label = blocked ? "address blocked" : isSuccess ? "reachable" : "connecting...";

  return (
    <div className="inline-flex items-center justify-center gap-2 text-[13px] text-rim-text-muted">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      {address ? (
        <>
          <span className="font-mono text-xs">{address}</span>
          <span>{label}</span>
        </>
      ) : (
        <span>
          {isSuccess ? "Server reachable" : blocked ? "Address blocked" : "Connecting..."}
        </span>
      )}
    </div>
  );
}
