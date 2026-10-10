import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  isModeratorRole,
  useCanModerate,
  useIsGuest,
  useIsOwner,
  useMyServerRole,
} from "./useMyServerRole";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMyServerRole", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("returns undefined while loading", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useMyServerRole("srv-1"), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it("returns the viewer's role once loaded", async () => {
    requestMock.mockResolvedValue({
      server: { id: "srv-1", name: "Acme", viewerRole: ServerMemberRoleGql.MODERATOR },
    });
    const { result } = renderHook(() => useMyServerRole("srv-1"), { wrapper });
    await waitFor(() => expect(result.current).toBe(ServerMemberRoleGql.MODERATOR));
  });
});

describe("useIsOwner", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it.each([
    [ServerMemberRoleGql.OWNER, true],
    [ServerMemberRoleGql.MODERATOR, false],
    [ServerMemberRoleGql.GUEST, false],
  ])("role %s -> isOwner %s", async (role, expected) => {
    requestMock.mockResolvedValue({ server: { id: "srv-1", name: "Acme", viewerRole: role } });
    const { result } = renderHook(() => useIsOwner("srv-1"), { wrapper });
    await waitFor(() => expect(result.current).toBe(expected));
  });
});

describe("useCanModerate", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it.each([
    [ServerMemberRoleGql.OWNER, true],
    [ServerMemberRoleGql.MODERATOR, true],
  ])("role %s -> canModerate %s", async (role, expected) => {
    requestMock.mockResolvedValue({ server: { id: "srv-1", name: "Acme", viewerRole: role } });
    const { result } = renderHook(() => useCanModerate("srv-1"), { wrapper });
    await waitFor(() => expect(result.current).toBe(expected));
  });

  it("is false for a guest once the role has loaded", async () => {
    requestMock.mockResolvedValue({
      server: { id: "srv-1", name: "Acme", viewerRole: ServerMemberRoleGql.GUEST },
    });
    const { result } = renderHook(
      () => ({ role: useMyServerRole("srv-1"), canModerate: useCanModerate("srv-1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.role).toBe(ServerMemberRoleGql.GUEST));
    expect(result.current.canModerate).toBe(false);
  });

  it("isModeratorRole is false while the role is unknown", () => {
    expect(isModeratorRole(undefined)).toBe(false);
  });
});

describe("useIsGuest", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it.each([
    [ServerMemberRoleGql.OWNER, false],
    [ServerMemberRoleGql.MODERATOR, false],
    [ServerMemberRoleGql.MEMBER, false],
    [ServerMemberRoleGql.GUEST, true],
  ])("role %s -> isGuest %s", async (role, expected) => {
    requestMock.mockResolvedValue({ server: { id: "srv-1", name: "Acme", viewerRole: role } });
    const { result } = renderHook(
      () => ({ role: useMyServerRole("srv-1"), isGuest: useIsGuest("srv-1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.role).toBe(role));
    expect(result.current.isGuest).toBe(expected);
  });

  it("is false while the role is loading, so nothing flickers away for members", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useIsGuest("srv-1"), { wrapper });
    expect(result.current).toBe(false);
  });
});
