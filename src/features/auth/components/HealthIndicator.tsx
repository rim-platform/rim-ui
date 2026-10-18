/**
 * `HealthIndicator` — shows a coloured dot + text indicating whether the
 * backend GraphQL endpoint is reachable. Every auth screen shares this widget.
 *
 * Relies on `useHealthCheck()` from the system feature and
 * `getGraphqlEndpoint()` from the graphql config module. Neither requires
 * Tauri APIs — works identically in the web build.
 */

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { useHealthCheck } from "../../system/api/useHealthCheck";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { cn } from "../../../shared/ui/cn";

/**
 * Inline health badge rendered on auth screens.
 *
 * Displays a colour-coded dot (green / amber / red) and a short label
 * reflecting the backend reachability state, or that it blocked this address. Does not accept props — all
 * data comes from hooks.
 */
export function HealthIndicator() {
  const { isSuccess, isError } = useHealthCheck();
  const blocked = useEdgeStore((s) => s.blocked);
  const color = isSuccess ? "bg-rim-success" : isError || blocked ? "bg-rim-danger" : "bg-rim-warm";
  const label = blocked
    ? "Address blocked"
    : isSuccess
      ? "Backend reachable"
      : isError
        ? "Backend unreachable"
        : "Connecting...";

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-rim-text-muted">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      <span>{label}</span>
      <span className="text-rim-text-faint">({getGraphqlEndpoint()})</span>
    </div>
  );
}
