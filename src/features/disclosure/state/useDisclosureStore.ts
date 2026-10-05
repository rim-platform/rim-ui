import { create } from "zustand";

import { graphqlClient } from "../../../core/graphql/client";
import { gql } from "graphql-request";
import { SkillTier } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";

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
   * Fetch the signed-in user's skill profile (one request at a time). Until
   * it succeeds every DisclosureGate renders nothing, i.e. gated surfaces
   * stay hidden; a failed fetch leaves the profile unloaded so the next gate
   * mount retries instead of pinning the user to BEGINNER.
   */
  loadProfile: () => Promise<void>;
  recordUsage: (featureId: string) => void;
  /** Forget the profile (e.g. on sign-out or account switch). */
  reset: () => void;
}

let profileRequest: Promise<void> | null = null;
// Bumped by reset() so a response for a previous session is ignored.
let profileGeneration = 0;

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
    const generation = profileGeneration;
    const request = graphqlClient
      .request<{
        mySkillProfile: { skillTier: SkillTier; featuresUsed: { featureId: string }[] };
      }>(MY_SKILL_PROFILE_QUERY)
      .then((data) => {
        if (generation !== profileGeneration) return;
        const profile = data.mySkillProfile;
        get().setProfile(
          profile.skillTier,
          profile.featuresUsed.map((f) => f.featureId),
        );
      })
      .catch(() => {
        // Stay unloaded (gates closed); a later loadProfile() retries.
      })
      .finally(() => {
        if (profileRequest === request) profileRequest = null;
      });
    profileRequest = request;
    return request;
  },

  reset: () => {
    profileGeneration++;
    profileRequest = null;
    set({ skillTier: SkillTier.BEGINNER, featuresUsed: new Set<string>(), isLoaded: false });
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

// The profile belongs to the signed-in user: drop it when the user changes.
useAuthStore.subscribe((state, prev) => {
  if (state.session?.userId !== prev.session?.userId) {
    useDisclosureStore.getState().reset();
  }
});
