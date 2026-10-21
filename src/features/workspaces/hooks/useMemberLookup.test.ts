import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";

vi.mock("../api/useCurrentUser", () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock("../api/useServerMembers", () => ({
  useServerMembers: vi.fn(),
}));

import { useMemberLookup } from "./useMemberLookup";
import { useCurrentUser } from "../api/useCurrentUser";
import { useServerMembers } from "../api/useServerMembers";
import { useKnownHandles } from "../state/useKnownHandles";

describe("useMemberLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a resolve function", () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: undefined } as ReturnType<
      typeof useCurrentUser
    >);
    vi.mocked(useServerMembers).mockReturnValue({ data: undefined } as ReturnType<
      typeof useServerMembers
    >);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    expect(typeof result.current.resolve).toBe("function");
  });

  it("resolve returns fallback for unknown userId", () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: undefined } as ReturnType<
      typeof useCurrentUser
    >);
    vi.mocked(useServerMembers).mockReturnValue({ data: undefined } as ReturnType<
      typeof useServerMembers
    >);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    const info = result.current.resolve("unknown-user-id-xxx");
    // userId.slice(0, 8) of "unknown-user-id-xxx" = "unknown-"
    expect(info.displayName).toBe("unknown-");
    expect(info.isCurrentUser).toBe(false);
  });

  it("resolve returns current user info with isCurrentUser true", () => {
    vi.mocked(useCurrentUser).mockReturnValue({
      data: {
        id: "me-id",
        username: "me",
        displayName: "Me User",
        avatarUrl: "https://avatar.com/me.jpg",
        statusText: "Busy",
        bio: "Hello",
      },
    } as ReturnType<typeof useCurrentUser>);
    vi.mocked(useServerMembers).mockReturnValue({ data: undefined } as ReturnType<
      typeof useServerMembers
    >);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    const info = result.current.resolve("me-id");
    expect(info.displayName).toBe("Me User");
    expect(info.username).toBe("me");
    expect(info.isCurrentUser).toBe(true);
    expect(info.avatarUrl).toBe("https://avatar.com/me.jpg");
    expect(info.statusText).toBe("Busy");
  });

  it("resolve returns server member info", () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: undefined } as ReturnType<
      typeof useCurrentUser
    >);
    vi.mocked(useServerMembers).mockReturnValue({
      data: [
        {
          userId: "user-1",
          username: "alice",
          memberRole: ServerMemberRoleGql.MODERATOR,
          joinedAt: "2025-01-01T00:00:00Z",
          avatarUrl: null,
          statusText: null,
          bio: null,
          displayName: "Alice",
        },
      ],
    } as ReturnType<typeof useServerMembers>);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    const info = result.current.resolve("user-1");
    expect(info.displayName).toBe("Alice");
    expect(info.username).toBe("alice");
    expect(info.role).toBe(ServerMemberRoleGql.MODERATOR);
    expect(info.isCurrentUser).toBe(false);
  });

  it("prefers current user entry but enriches with member data", () => {
    vi.mocked(useCurrentUser).mockReturnValue({
      data: {
        id: "me-id",
        username: "me",
        displayName: "Me",
        avatarUrl: null,
        statusText: null,
        bio: null,
      },
    } as ReturnType<typeof useCurrentUser>);
    vi.mocked(useServerMembers).mockReturnValue({
      data: [
        {
          userId: "me-id",
          username: "me",
          memberRole: ServerMemberRoleGql.OWNER,
          joinedAt: "2024-01-01T00:00:00Z",
          avatarUrl: "https://avatar.com/new.jpg",
          statusText: "Updated status",
          bio: "Updated bio",
          displayName: "New Display",
        },
      ],
    } as ReturnType<typeof useServerMembers>);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    const info = result.current.resolve("me-id");
    expect(info.isCurrentUser).toBe(true);
    expect(info.role).toBe(ServerMemberRoleGql.OWNER);
    expect(info.avatarUrl).toBe("https://avatar.com/new.jpg");
    expect(info.statusText).toBe("Updated status");
    expect(info.displayName).toBe("New Display");
  });

  it("uses username as displayName fallback", () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: undefined } as ReturnType<
      typeof useCurrentUser
    >);
    vi.mocked(useServerMembers).mockReturnValue({
      data: [
        {
          userId: "user-1",
          username: "bob",
          memberRole: ServerMemberRoleGql.MEMBER,
          joinedAt: "2025-01-01T00:00:00Z",
          avatarUrl: null,
          statusText: null,
          bio: null,
          displayName: null,
        },
      ],
    } as ReturnType<typeof useServerMembers>);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    const info = result.current.resolve("user-1");
    expect(info.displayName).toBe("bob");
  });

  it("exposes a map of all members", () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: undefined } as ReturnType<
      typeof useCurrentUser
    >);
    vi.mocked(useServerMembers).mockReturnValue({
      data: [
        {
          userId: "user-1",
          username: "alice",
          memberRole: ServerMemberRoleGql.MODERATOR,
          joinedAt: "2025-01-01T00:00:00Z",
          avatarUrl: null,
          statusText: null,
          bio: null,
          displayName: "Alice",
        },
        {
          userId: "user-2",
          username: "bob",
          memberRole: ServerMemberRoleGql.MEMBER,
          joinedAt: "2025-01-01T00:00:00Z",
          avatarUrl: null,
          statusText: null,
          bio: null,
          displayName: "Bob",
        },
      ],
    } as ReturnType<typeof useServerMembers>);

    const { result } = renderHook(() => useMemberLookup("ws-1"));
    expect(result.current.map.size).toBe(2);
    expect(result.current.map.has("user-1")).toBe(true);
    expect(result.current.map.has("user-2")).toBe(true);
  });

  it("reads handles against the viewer's own domain and never names anyone by an r_ name", () => {
    useKnownHandles.setState({
      byUser: { "u-bob": "@bob:home.example", "u-ada": "@ada:elsewhere.example" },
    });
    vi.mocked(useCurrentUser).mockReturnValue({
      data: {
        id: "me-id",
        username: "kuba",
        displayName: "Kuba",
        avatarUrl: null,
        statusText: null,
        bio: null,
        principalId: null,
        handle: "@kuba:home.example",
      },
    } as ReturnType<typeof useCurrentUser>);
    const member = (userId: string, username: string, displayName: string | null) => ({
      userId,
      username,
      displayName,
      memberRole: ServerMemberRoleGql.MEMBER,
      joinedAt: "2026-01-01T00:00:00Z",
      avatarUrl: null,
      statusText: null,
      bio: null,
    });
    vi.mocked(useServerMembers).mockReturnValue({
      data: [
        member("u-bob", "bob", null),
        member("u-ada", "r_aaaaaa", null),
        member("u-zed", "r_zzzzzz", null),
      ],
    } as ReturnType<typeof useServerMembers>);

    try {
      const { result } = renderHook(() => useMemberLookup("ws-1"));
      expect(result.current.ownDomain).toBe("home.example");
      expect(result.current.resolve("me-id").handleView).toEqual({
        shown: "@kuba",
        copied: "@kuba:home.example",
      });
      expect(result.current.resolve("u-bob").handleView?.shown).toBe("@bob");
      expect(result.current.resolve("u-ada").displayName).toBe("ada:elsewhere.example");
      expect(result.current.resolve("u-ada").handleView?.shown).toBe("@ada:elsewhere.example");
      expect(result.current.resolve("u-zed").displayName).toBe("u-zed");
      expect(result.current.resolve("u-zed").handleView).toBeNull();
    } finally {
      useKnownHandles.setState({ byUser: {} });
    }
  });
});
