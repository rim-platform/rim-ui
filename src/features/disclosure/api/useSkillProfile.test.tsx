import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useDisclosureStore } from "../state/useDisclosureStore";
import {
  SkillTier,
  skillProfileQueryKey,
  useOverrideSkillTier,
  useRecordFeatureUsage,
  useSkillProfile,
} from "./useSkillProfile";

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const serverProfile = {
  userId: "me",
  skillTier: SkillTier.ADVANCED,
  featuresUsed: [{ featureId: "macros", firstUsedAt: "2026-01-01T00:00:00Z" }],
};

describe("skill profile hooks", () => {
  beforeEach(() => {
    requestMock.mockReset();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    useDisclosureStore.setState({
      skillTier: SkillTier.BEGINNER,
      featuresUsed: new Set(),
      isLoaded: true,
    });
  });

  it("useSkillProfile selects the profile from the response", async () => {
    requestMock.mockResolvedValue({ mySkillProfile: serverProfile });
    const { result } = renderHook(() => useSkillProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(serverProfile);
    expect(requestMock.mock.calls[0][0]).toContain("query MySkillProfile");
  });

  it("useRecordFeatureUsage sends the feature id and invalidates the profile", async () => {
    requestMock.mockResolvedValue({ recordFeatureUsage: serverProfile });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRecordFeatureUsage(), { wrapper });

    await act(() => result.current.mutateAsync("macros"));

    expect(requestMock.mock.calls[0][0]).toContain("mutation RecordFeatureUsage");
    expect(requestMock.mock.calls[0][1]).toEqual({ featureId: "macros" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: skillProfileQueryKey });
  });

  it("useOverrideSkillTier sends the tier, applies it to the gates and invalidates", async () => {
    requestMock.mockResolvedValue({ overrideSkillTier: serverProfile });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useOverrideSkillTier(), { wrapper });

    await act(() => result.current.mutateAsync(SkillTier.ADVANCED));

    expect(requestMock.mock.calls[0][0]).toContain("mutation OverrideSkillTier");
    expect(requestMock.mock.calls[0][1]).toEqual({ tier: SkillTier.ADVANCED });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: skillProfileQueryKey });
    expect(useDisclosureStore.getState().skillTier).toBe(SkillTier.ADVANCED);
    expect(useDisclosureStore.getState().featuresUsed.has("macros")).toBe(true);
  });

  it("useOverrideSkillTier leaves the tier alone when the server rejects it", async () => {
    requestMock.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHook(() => useOverrideSkillTier(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(SkillTier.ADVANCED)).rejects.toThrow("forbidden");
    });
    expect(useDisclosureStore.getState().skillTier).toBe(SkillTier.BEGINNER);
  });
});
