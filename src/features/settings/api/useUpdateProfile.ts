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
 * Why the server refused an avatar upload, in words for the person: how long to wait after a
 * 429, else the server's JSON `error` as a sentence, else the status.
 */
async function avatarRefusalMessage(res: Response): Promise<string> {
  let body: { error?: unknown; retryAfterSeconds?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not JSON: the status says what happened.
  }
  if (res.status === 429) {
    const header = Number(res.headers.get("Retry-After"));
    const seconds =
      typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : header || undefined;
    if (seconds !== undefined && seconds > 0) {
      const minutes = Math.ceil(seconds / 60);
      return `You can change your picture again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }
  }
  if (typeof body.error === "string" && body.error.trim()) {
    const text = body.error.trim();
    const sentence = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }
  return `Avatar upload failed: ${res.status} ${res.statusText}`;
}

/**
 * Upload an avatar image to the REST endpoint.
 * Returns the avatar URL path to use with updateMyProfile. A server with profile pictures
 * switched off refuses it with a `FeatureDisabledError`; any other refusal throws an `Error`
 * carrying the server's message.
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
    throw (await featureDisabledFromResponse(res)) ?? new Error(await avatarRefusalMessage(res));
  }

  const data = await res.json();
  return data.url ?? data.avatarUrl ?? data.path;
}
