import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { UpdateMyProfileInput } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

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
      graphqlClient.request<{ updateMyProfile: ProfileUser }>(
        UPDATE_MY_PROFILE,
        { input: vars },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.me });
      qc.invalidateQueries({ queryKey: ["serverMembers"] });
    },
  });
}

const CSRF_COOKIE = "rim_csrf";
const CSRF_HEADER = "x-csrf-token";

function getCsrfToken(): string | undefined {
  const row = document.cookie
    .split("; ")
    .find((r) => r.startsWith(`${CSRF_COOKIE}=`));
  return row ? decodeURIComponent(row.split("=")[1]) : undefined;
}

/**
 * Upload an avatar image to the REST endpoint.
 * Returns the avatar URL path to use with updateMyProfile.
 */
export async function uploadAvatar(file: Blob): Promise<string> {
  const baseUrl = import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api";
  const uploadUrl = baseUrl.replace(/\/api$/, "") + "/api/files/avatar";

  const formData = new FormData();
  formData.append("file", file, "avatar.png");

  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) headers[CSRF_HEADER] = csrf;

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    throw new Error(`Avatar upload failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.url ?? data.avatarUrl ?? data.path;
}
