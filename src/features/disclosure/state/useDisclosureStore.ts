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

const MY_SKILL_PROFILE_QUERY = gql`
  query MySkillProfile {
    mySkillProfile {
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
  /**
   * Fetch the user's skill profile once. Until it settles every
   * DisclosureGate renders nothing; a failed fetch falls back to BEGINNER so
   * gated surfaces stay hidden rather than the gate staying shut forever.
   */
  loadProfile: () => Promise<void>;
  recordUsage: (featureId: string) => void;
}

let profileRequest: Promise<void> | null = null;

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

  loadProfile: () => {
    if (get().isLoaded) return Promise.resolve();
    if (profileRequest) return profileRequest;
    profileRequest = graphqlClient
      .request<{
        mySkillProfile: { skillTier: SkillTier; featuresUsed: { featureId: string }[] };
      }>(MY_SKILL_PROFILE_QUERY)
      .then((data) => {
        const profile = data.mySkillProfile;
        get().setProfile(
          profile.skillTier,
          profile.featuresUsed.map((f) => f.featureId),
        );
      })
      .catch(() => {
        get().setProfile(SkillTier.BEGINNER, []);
      })
      .finally(() => {
        profileRequest = null;
      });
    return profileRequest;
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
