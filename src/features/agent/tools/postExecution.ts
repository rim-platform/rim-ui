import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";

/**
 * Agent-tool-path cache invalidation, mirroring what
 * `src/features/commands/runtime/commandDispatcher.ts` does for the
 * human-dispatch `incident.ack` / `incident.escalate` handlers (see
 * `ackIncidentFromCommand` and the `incident.escalate` local handler there).
 * This module exists because agent tool calls go through
 * `src/features/agent/tools/loader.ts`'s `executeCommand` mutation directly
 * and bypass `commandDispatcher` entirely, so without this the agent path
 * performs zero TanStack Query invalidation and an already-open incident
 * timeline / banner won't refresh after an agent ack/escalate until remount
 * or window refocus.
 *
 * Deliberately scoped to Track C2 (`incident.ack` / `incident.escalate`)
 * only — this is NOT a general agent-wide invalidation framework. Do not add
 * entries for other commands here; a broader invalidation story needs its
 * own design pass.
 */
function invalidateIncidentQueries(args: Record<string, unknown>): void {
  const incidentId = args.incidentId;
  if (typeof incidentId === "string") {
    queryClient.invalidateQueries({ queryKey: queryKeys.incidentTimeline(incidentId) });
  } else {
    // No incidentId (or non-string shape) on the args — prefix-invalidate
    // every incident timeline query rather than skip invalidation entirely.
    queryClient.invalidateQueries({ queryKey: ["incidentTimeline"] });
  }
  // The full `activeIncident` key needs workspace/conversation ids the agent
  // path doesn't reliably have on hand — prefix-match on the root instead
  // (TanStack-native: an `invalidateQueries` queryKey is treated as a prefix
  // by default).
  queryClient.invalidateQueries({ queryKey: ["activeIncident"] });
}

/**
 * Two-entry map from commandId to its post-execution invalidation. Keep this
 * a two-entry map — it must not grow into a `commandDispatcher` clone.
 * Anything bigger than the two C2 incident commands goes through a real
 * design pass.
 */
const POST_EXECUTION_INVALIDATIONS: Readonly<
  Record<string, (args: Record<string, unknown>) => void>
> = {
  "incident.ack": invalidateIncidentQueries,
  "incident.escalate": invalidateIncidentQueries,
};

/**
 * Called from `loader.ts`'s `interpretResult` on the `SUCCESS` branch (the
 * single choke point covering both the one-shot agent tool path and the
 * post-confirmation-proof path, since `executeCommandWithProof` also flows
 * through `interpretResult`). No-op for any commandId not in the map above.
 */
export function invalidateAfterCommand(commandId: string, args: Record<string, unknown>): void {
  POST_EXECUTION_INVALIDATIONS[commandId]?.(args);
}
