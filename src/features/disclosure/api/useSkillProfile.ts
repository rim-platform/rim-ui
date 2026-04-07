import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { SkillTier, type SkillProfileGql } from "../../../core/graphql/generated/schema-types";

// --- Re-exports for backward compatibility ---

export { SkillTier };
export type SkillProfile = SkillProfileGql;

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

const OVERRIDE_SKILL_TIER_MUTATION = gql`
  mutation OverrideSkillTier($tier: SkillTier!) {
    overrideSkillTier(tier: $tier) {
      userId
      skillTier
      featuresUsed {
        featureId
        firstUsedAt
      }
    }
  }
`;

export const skillProfileQueryKey = ["skillProfile"] as const;

export function useSkillProfile() {
  return useQuery({
    queryKey: skillProfileQueryKey,
    queryFn: () =>
      graphqlClient.request<{ mySkillProfile: SkillProfile }>(MY_SKILL_PROFILE_QUERY),
    select: (data) => data.mySkillProfile,
  });
}

export function useRecordFeatureUsage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (featureId: string) =>
      graphqlClient.request<{ recordFeatureUsage: SkillProfile }>(
        RECORD_FEATURE_USAGE_MUTATION,
        { featureId },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillProfileQueryKey });
    },
  });
}

export function useOverrideSkillTier() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (tier: SkillTier) =>
      graphqlClient.request<{ overrideSkillTier: SkillProfile }>(
        OVERRIDE_SKILL_TIER_MUTATION,
        { tier },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skillProfileQueryKey });
    },
  });
}
