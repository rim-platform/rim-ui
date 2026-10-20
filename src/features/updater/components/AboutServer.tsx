import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { isKnownServerFeature, serverFeatureLabel } from "../../../core/serverFeatures";
import { cn } from "../../../shared/ui/cn";
import { useServerHost } from "../../relay/state/serverOrigin";
import { NEWER_SERVER_API_MESSAGE, useServerInfo } from "../hooks/useServerInfo";

/**
 * The connected server, by the host it is known by, with its release and API versions under the client's;
 * nothing while it loads.
 */
export function AboutServerVersion() {
  const { info, unreachable } = useServerInfo();
  const host = useServerHost();
  if (unreachable) {
    return <p className="text-xs text-rim-text-faint">Server {host} unreachable</p>;
  }
  if (!info) return null;
  return (
    <p className="text-xs text-rim-text-faint">
      Server {host}, version {info.version}, API {info.apiVersion}
    </p>
  );
}

const STATE_WORD: Record<ServerFeatureState, string> = {
  [ServerFeatureState.ENABLED]: "On",
  [ServerFeatureState.DISABLED]: "Switched off",
  [ServerFeatureState.UNAVAILABLE]: "Not set up",
};

const STATE_DOT: Record<ServerFeatureState, string> = {
  [ServerFeatureState.ENABLED]: "bg-rim-success",
  [ServerFeatureState.DISABLED]: "bg-rim-text-faint",
  [ServerFeatureState.UNAVAILABLE]: "bg-rim-warm",
};

/**
 * The connected server's optional features with their state, and the reason of an unavailable
 * one; features this client does not know are left out. Nothing while loading, or for a server
 * that lists none.
 */
export function AboutServerFeatures() {
  const { info } = useServerInfo();
  const features = (info?.features ?? []).filter((f) => isKnownServerFeature(f.key));
  if (features.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-rim-text-faint">Server features</p>
      <ul aria-label="Server features" className="mt-1.5 space-y-1">
        {features.map((feature) => (
          <li key={feature.key} className="text-xs">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[feature.state])}
                aria-hidden
              />
              <span className="text-rim-text">{serverFeatureLabel(feature.key)}</span>
              <span className="text-rim-text-muted">{STATE_WORD[feature.state]}</span>
            </div>
            {feature.reason && (
              <p className="ml-3.5 mt-0.5 text-rim-text-faint">{feature.reason}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A banner when the server speaks a newer API than this client; nothing otherwise. */
export function AboutServerApiBanner() {
  const { newerApi } = useServerInfo();
  if (!newerApi) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-rim-warm/40 bg-rim-warm/10 px-3 py-2 text-sm text-rim-warm"
    >
      {NEWER_SERVER_API_MESSAGE}
    </p>
  );
}
