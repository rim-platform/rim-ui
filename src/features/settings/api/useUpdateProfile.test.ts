/**
 * Tests for `useUpdateProfileMutation` — the React Query hook that wraps
 * the `updateMyProfile(input: UpdateMyProfileInput!)` GraphQL mutation.
 *
 * Why these tests exist:
 *   1. Lock in the input-object shape `{ input: { ... } }` rather than flat
 *      args, so the wrapping cannot silently regress.
 *   2. Confirm the returned `User` shape is surfaced unchanged through
 *      mutation `data` so callers can read `displayName`, `avatarUrl`, etc.
 *   3. Confirm partial input is honored — only the fields the caller passes
 *      are sent. The hook does not synthesize undefined keys.
 *   4. Confirm errors surface through the standard React Query `error` slot.
 *
 * Mocking style mirrors `useSignupWithInviteMutation.test.ts`: the
 * `getGraphqlEndpoint` config is pinned, MSW intercepts the GraphQL POST,
 * and the harness uses `TestProviders` so React Query has a client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { TestProviders } from "../../../test/utils";
import { useUpdateProfileMutation } from "./useUpdateProfile";

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

interface CapturedRequest {
  operationName: string;
  variables: Record<string, unknown>;
}

/**
 * Install an MSW handler that captures the next `UpdateMyProfile` mutation
 * request body and replies with `responseData`. Returns the captured-request
 * box; tests read `captured.value` after awaiting `mutateAsync`.
 */
function captureUpdateMyProfile(responseData: unknown) {
  const box: { value: CapturedRequest | null } = { value: null };

  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as {
        operationName?: string;
        variables?: Record<string, unknown>;
      };
      if (body.operationName === "UpdateMyProfile") {
        box.value = {
          operationName: body.operationName,
          variables: body.variables ?? {},
        };
        return HttpResponse.json({ data: responseData });
      }
    }),
  );

  return box;
}

describe("useUpdateProfileMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps the mutation variables in `{ input: { ... } }` (input-object shape)", async () => {
    const captured = captureUpdateMyProfile({
      updateMyProfile: {
        id: "user-1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        statusText: null,
        bio: null,
      },
    });

    const { result } = renderHook(() => useUpdateProfileMutation(), {
      wrapper: TestProviders,
    });

    await act(async () => {
      await result.current.mutateAsync({
        displayName: "Alice",
        statusText: "On call",
      });
    });

    expect(captured.value).not.toBeNull();
    expect(captured.value!.variables).toEqual({
      input: { displayName: "Alice", statusText: "On call" },
    });
    // Sanity: variables are NOT flat-spread at the top level.
    expect(captured.value!.variables).not.toHaveProperty("displayName");
    expect(captured.value!.variables).not.toHaveProperty("statusText");
  });

  it("surfaces the returned User on success", async () => {
    captureUpdateMyProfile({
      updateMyProfile: {
        id: "user-2",
        username: "bob",
        displayName: "Bob",
        avatarUrl: "/avatars/bob.png",
        statusText: "Heads down",
        bio: "Backend, mostly.",
      },
    });

    const { result } = renderHook(() => useUpdateProfileMutation(), {
      wrapper: TestProviders,
    });

    let response:
      | { updateMyProfile: { id: string; displayName: string | null; avatarUrl: string | null } }
      | undefined;

    await act(async () => {
      response = await result.current.mutateAsync({ displayName: "Bob" });
    });

    expect(response?.updateMyProfile.id).toBe("user-2");
    expect(response?.updateMyProfile.displayName).toBe("Bob");
    expect(response?.updateMyProfile.avatarUrl).toBe("/avatars/bob.png");

    // React Query exposes the same data on `result.current.data`.
    await waitFor(() => {
      expect(result.current.data?.updateMyProfile.id).toBe("user-2");
    });
  });

  it("partial input — only `avatarUrl` set — sends exactly that field inside `input`", async () => {
    const captured = captureUpdateMyProfile({
      updateMyProfile: {
        id: "user-3",
        username: "carol",
        displayName: null,
        avatarUrl: "/avatars/carol.png",
        statusText: null,
        bio: null,
      },
    });

    const { result } = renderHook(() => useUpdateProfileMutation(), {
      wrapper: TestProviders,
    });

    await act(async () => {
      await result.current.mutateAsync({ avatarUrl: "/avatars/carol.png" });
    });

    expect(captured.value).not.toBeNull();
    // `input` contains exactly the field the caller supplied. This does not
    // assert "no extra undefined keys" because GraphQL serialization may
    // omit undefineds anyway; instead, assert what was sent by deep equality.
    expect(captured.value!.variables).toEqual({
      input: { avatarUrl: "/avatars/carol.png" },
    });
  });

  it("surfaces a server validation error through the `error` slot", async () => {
    server.use(
      http.post("*/api", async ({ request }) => {
        const body = (await request.json()) as { operationName?: string };
        if (body.operationName === "UpdateMyProfile") {
          return HttpResponse.json({
            data: null,
            errors: [
              {
                message: "displayName must be 1-80 chars",
                extensions: { code: "VALIDATION" },
              },
            ],
          });
        }
      }),
    );

    const { result } = renderHook(() => useUpdateProfileMutation(), {
      wrapper: TestProviders,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ displayName: "" });
      } catch {
        // graphql-request throws on errors[]; React Query also exposes via `error`.
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeTruthy();
    // The thrown error from graphql-request includes the server message somewhere
    // in its serialized form. Assert message presence via JSON to stay tolerant
    // of graphql-request's internal error shape.
    expect(JSON.stringify(result.current.error)).toContain("displayName must be 1-80 chars");
  });
});
