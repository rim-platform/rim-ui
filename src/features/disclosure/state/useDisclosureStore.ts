import { create } from "zustand";

import { graphqlClient } from "../../../core/graphql/client";
import { gql } from "graphql-request";
import { SkillTier } from "../../../core/graphql/generated/schema-types";

export { SkillTier };

const RECORD_FEATURE_USAGE_MUTATION = gql`
  mutation RecordFeatureUsage($featureId: String!) {
    recordFeatureUsage(featureId: $featureId) {
      userId
      skillTier
      featuresUsed {
        featureId
        firstUsedAt
      }
    }
  }
`;

interface DisclosureState {
  skillTier: SkillTier;
  featuresUsed: Set<string>;
  isLoaded: boolean;

  setProfile: (tier: SkillTier, features: string[]) => void;
  recordUsage: (featureId: string) => void;
}

export const useDisclosureStore = create<DisclosureState>()((set, get) => ({
  skillTier: SkillTier.BEGINNER,
  featuresUsed: new Set<string>(),
  isLoaded: false,

  setProfile: (tier, features) => {
    set({
      skillTier: tier,
      featuresUsed: new Set(features),
      isLoaded: true,
    });
  },

  recordUsage: (featureId) => {
    const state = get();

    // Idempotent — skip if already recorded
    if (state.featuresUsed.has(featureId)) return;

    // Optimistic update
    const next = new Set(state.featuresUsed);
    next.add(featureId);
    set({ featuresUsed: next });

    // Fire mutation in background — update tier from server response
    graphqlClient
      .request<{
        recordFeatureUsage: {
          skillTier: SkillTier;
          featuresUsed: { featureId: string }[];
        };
      }>(RECORD_FEATURE_USAGE_MUTATION, { featureId })
      .then((data) => {
        const profile = data.recordFeatureUsage;
        set({
          skillTier: profile.skillTier,
          featuresUsed: new Set(profile.featuresUsed.map((f) => f.featureId)),
        });
      })
      .catch(() => {
        // Mutation failed — revert optimistic add
        const current = get().featuresUsed;
        const reverted = new Set(current);
        reverted.delete(featureId);
        set({ featuresUsed: reverted });
      });
  },
}));
