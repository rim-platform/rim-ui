import { useRef } from "react";

import { useDisclosureStore } from "../state/useDisclosureStore";

/**
 * Records a feature usage event once per component mount.
 * Uses a ref to prevent duplicate calls across re-renders.
 */
export function useRecordFeature(featureId: string): void {
  const fired = useRef(false);

  if (!fired.current) {
    fired.current = true;
    useDisclosureStore.getState().recordUsage(featureId);
  }
}
