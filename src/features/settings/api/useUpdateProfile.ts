import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { getApiOrigin } from "../../../core/graphql/config";
import { authHeaders } from "../../../core/graphql/csrf";
import { UpdateMyProfileInput } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { featureDisabledFromResponse } from "../../../core/serverFeatures";

const UPDATE_MY_PROFILE = gql`
  mutation UpdateMyProfile($input: UpdateMyProfileInput!) {
    updateMyProfile(input: $input) {
      id
      username
      displayName
      avatarUrl
      statusText
      bio
    }
  }
`;

interface ProfileUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  statusText: string | null;
  bio: string | null;
}

/**
 * React Query mutation hook for updating the current user's profile.
 *
 * Accepts the four optional profile fields individually and wraps them
 * in the `UpdateMyProfileInput` object required by the GraphQL schema.
 * On success the `me` query and `serverMembers` cache are invalidated
 * so all consumers see fresh data.
 *
 * @example
 * ```tsx
 * const { mutate } = useUpdateProfileMutation();
 * mutate({ displayName: "Alice", statusText: "On call" });
 * ```
 */
export function useUpdateProfileMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: UpdateMyProfileInput) =>
      graphqlClient.request<{ updateMyProfile: ProfileUser }>(UPDATE_MY_PROFILE, { input: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.me });
      qc.invalidateQueries({ queryKey: ["serverMembers"] });
    },
  });
}

/**
 * Upload an avatar image to the REST endpoint.
 * Returns the avatar URL path to use with updateMyProfile. A server with profile pictures
 * switched off refuses it with a `FeatureDisabledError`.
 */
export async function uploadAvatar(file: Blob): Promise<string> {
  const uploadUrl = getApiOrigin() + "/api/files/avatar";

  const formData = new FormData();
  formData.append("file", file, "avatar.png");

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw (
      (await featureDisabledFromResponse(res)) ??
      new Error(`Avatar upload failed: ${res.status} ${res.statusText}`)
    );
  }

  const data = await res.json();
  return data.url ?? data.avatarUrl ?? data.path;
}
