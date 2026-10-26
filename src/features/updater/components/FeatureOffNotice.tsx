import { Lock } from "lucide-react";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import {
  featureOffMessage,
  featureUnavailableMessage,
  type ServerFeatureKey,
} from "../../../core/serverFeatures";
import type { ServerFeatureView } from "../hooks/useServerFeature";

interface FeatureOffNoticeProps {
  feature: ServerFeatureKey;
  view: ServerFeatureView;
  /**
   * Replaces the "switched off" sentence; the reason of an unavailable feature still follows
   * unless hidden.
   */
  message?: string;
  /**
   * Leaves out an unavailable feature's reason, for a surface whose message already says what
   * to do.
   */
  hideReason?: boolean;
}

/**
 * What stands in place of a surface whose feature the server does not run: "switched off" when
 * the operator disabled it, "not set up" with the reason when its configuration is missing.
 */
export function FeatureOffNotice({
  feature,
  view,
  message,
  hideReason = false,
}: FeatureOffNoticeProps) {
  const unavailable = view.state === ServerFeatureState.UNAVAILABLE;
  const sentence =
    message ?? (unavailable ? featureUnavailableMessage(feature) : featureOffMessage(feature));
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text-muted"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rim-text-faint" aria-hidden />
      <div>
        <p>{sentence}.</p>
        {unavailable && view.reason && !hideReason && (
          <p className="mt-0.5 text-rim-text-faint">{view.reason}</p>
        )}
      </div>
    </div>
  );
}
