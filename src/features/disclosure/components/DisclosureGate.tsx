import { useEffect } from "react";
import type { ReactNode } from "react";

import { useDisclosureStore, type SkillTier } from "../state/useDisclosureStore";

const TIER_RANK: Record<SkillTier, number> = {
  BEGINNER: 0,
  INTERMEDIATE: 1,
  ADVANCED: 2,
};

interface DisclosureGateProps {
  minTier: SkillTier;
  children: ReactNode;
  fallback?: ReactNode;
}

export function DisclosureGate({ minTier, children, fallback = null }: DisclosureGateProps) {
  const skillTier = useDisclosureStore((s) => s.skillTier);
  const isLoaded = useDisclosureStore((s) => s.isLoaded);
  const loadProfile = useDisclosureStore((s) => s.loadProfile);

  useEffect(() => {
    if (!isLoaded) void loadProfile();
  }, [isLoaded, loadProfile]);

  // While the profile is loading, render nothing to prevent flash
  if (!isLoaded) return null;

  if (TIER_RANK[skillTier] >= TIER_RANK[minTier]) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
