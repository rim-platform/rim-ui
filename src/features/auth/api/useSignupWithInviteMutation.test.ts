import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { server } from "../../../test/mocks/server";
import { mockGraphQLMutation } from "../../../test/mocks/graphql";
import { TestProviders } from "../../../test/utils";
import { useSignupWithInviteMutation } from "./useSignupWithInviteMutation";

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

describe("useSignupWithInviteMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls mutation with workspace invite token and returns userId + serverId", async () => {
    server.use(
      mockGraphQLMutation("SignupWithInvite", {
        signupWithInvite: {
          userId: "user-abc",
          serverId: "server-xyz",
        },
      }),
    );

    const { result } = renderHook(() => useSignupWithInviteMutation(), {
      wrapper: TestProviders,
    });

    let response: { signupWithInvite: { userId: string; serverId: string | null } } | undefined;

    await act(async () => {
      response = await result.current.mutateAsync({
        username: "alice",
        password: "password123",
        workspaceInviteToken: "ws-token",
      });
    });

    expect(response?.signupWithInvite.userId).toBe("user-abc");
    expect(response?.signupWithInvite.serverId).toBe("server-xyz");
  });

  it("calls mutation with instance invite token and returns null serverId", async () => {
    server.use(
      mockGraphQLMutation("SignupWithInvite", {
        signupWithInvite: {
          userId: "user-def",
          serverId: null,
        },
      }),
    );

    const { result } = renderHook(() => useSignupWithInviteMutation(), {
      wrapper: TestProviders,
    });

    let response: { signupWithInvite: { userId: string; serverId: string | null } } | undefined;

    await act(async () => {
      response = await result.current.mutateAsync({
        username: "bob",
        password: "password123",
        instanceInviteToken: "instance-token",
      });
    });

    expect(response?.signupWithInvite.userId).toBe("user-def");
    expect(response?.signupWithInvite.serverId).toBeNull();
  });

  it("calls mutation without any token for open registration", async () => {
    server.use(
      mockGraphQLMutation("SignupWithInvite", {
        signupWithInvite: {
          userId: "user-open",
          serverId: null,
        },
      }),
    );

    const { result } = renderHook(() => useSignupWithInviteMutation(), {
      wrapper: TestProviders,
    });

    let response: { signupWithInvite: { userId: string; serverId: string | null } } | undefined;

    await act(async () => {
      // No token fields — open registration path
      response = await result.current.mutateAsync({
        username: "carol",
        password: "password123",
      });
    });

    expect(response?.signupWithInvite.userId).toBe("user-open");
  });
});
