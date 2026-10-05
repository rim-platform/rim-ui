import { describe, it, expect, vi, beforeEach } from "vitest";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import { SkillTier, useDisclosureStore } from "./useDisclosureStore";

function profile(tier: SkillTier, features: string[]) {
  return { skillTier: tier, featuresUsed: features.map((featureId) => ({ featureId })) };
}

beforeEach(() => {
  requestMock.mockReset();
  useDisclosureStore.setState({
    skillTier: SkillTier.BEGINNER,
    featuresUsed: new Set(),
    isLoaded: false,
  });
});

describe("useDisclosureStore profile loading", () => {
  it("starts unloaded at BEGINNER", () => {
    const state = useDisclosureStore.getState();
    expect(state.isLoaded).toBe(false);
    expect(state.skillTier).toBe(SkillTier.BEGINNER);
  });

  it("setProfile stores the tier and features and marks the profile loaded", () => {
    useDisclosureStore.getState().setProfile(SkillTier.ADVANCED, ["threads", "macros"]);
    const state = useDisclosureStore.getState();
    expect(state.isLoaded).toBe(true);
    expect(state.skillTier).toBe(SkillTier.ADVANCED);
    expect([...state.featuresUsed]).toEqual(["threads", "macros"]);
  });

  it("loads the server profile once, even when asked concurrently", async () => {
    requestMock.mockResolvedValue({ mySkillProfile: profile(SkillTier.INTERMEDIATE, ["search"]) });

    const { loadProfile } = useDisclosureStore.getState();
    await Promise.all([loadProfile(), loadProfile()]);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toContain("query MySkillProfile");
    const state = useDisclosureStore.getState();
    expect(state.isLoaded).toBe(true);
    expect(state.skillTier).toBe(SkillTier.INTERMEDIATE);
    expect(state.featuresUsed.has("search")).toBe(true);
  });

  it("does not refetch once loaded", async () => {
    useDisclosureStore.getState().setProfile(SkillTier.ADVANCED, []);
    await useDisclosureStore.getState().loadProfile();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("stays unloaded when the fetch fails, and retries on the next load", async () => {
    requestMock.mockRejectedValueOnce(new Error("offline"));
    await useDisclosureStore.getState().loadProfile();
    expect(useDisclosureStore.getState().isLoaded).toBe(false);

    requestMock.mockResolvedValueOnce({ mySkillProfile: profile(SkillTier.ADVANCED, []) });
    await useDisclosureStore.getState().loadProfile();
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(useDisclosureStore.getState().isLoaded).toBe(true);
    expect(useDisclosureStore.getState().skillTier).toBe(SkillTier.ADVANCED);
  });

  it("forgets the profile when the signed-in user changes", () => {
    useAuthStore.setState({ session: { userId: "alice" } });
    useDisclosureStore.getState().setProfile(SkillTier.ADVANCED, ["macros"]);

    useAuthStore.setState({ session: { userId: "bob" } });

    const state = useDisclosureStore.getState();
    expect(state.isLoaded).toBe(false);
    expect(state.skillTier).toBe(SkillTier.BEGINNER);
    expect(state.featuresUsed.size).toBe(0);
  });

  it("ignores a profile response that arrives after the user changed", async () => {
    let resolve: (value: unknown) => void = () => {};
    requestMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    useAuthStore.setState({ session: { userId: "alice" } });
    const pending = useDisclosureStore.getState().loadProfile();

    useAuthStore.setState({ session: { userId: "bob" } });
    resolve({ mySkillProfile: profile(SkillTier.ADVANCED, []) });
    await pending;

    expect(useDisclosureStore.getState().isLoaded).toBe(false);
    expect(useDisclosureStore.getState().skillTier).toBe(SkillTier.BEGINNER);
  });
});

describe("useDisclosureStore.recordUsage", () => {
  it("adds the feature optimistically and sends recordFeatureUsage", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    useDisclosureStore.getState().recordUsage("threads");

    expect(useDisclosureStore.getState().featuresUsed.has("threads")).toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toContain("mutation RecordFeatureUsage");
    expect(requestMock.mock.calls[0][1]).toEqual({ featureId: "threads" });
  });

  it("is idempotent for an already-used feature", () => {
    useDisclosureStore.getState().setProfile(SkillTier.BEGINNER, ["threads"]);
    useDisclosureStore.getState().recordUsage("threads");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("adopts the tier and features the server returns (promotion)", async () => {
    requestMock.mockResolvedValue({
      recordFeatureUsage: profile(SkillTier.INTERMEDIATE, ["threads", "search", "macros"]),
    });
    useDisclosureStore.getState().setProfile(SkillTier.BEGINNER, ["search"]);
    useDisclosureStore.getState().recordUsage("threads");

    await vi.waitFor(() =>
      expect(useDisclosureStore.getState().skillTier).toBe(SkillTier.INTERMEDIATE),
    );
    expect([...useDisclosureStore.getState().featuresUsed].sort()).toEqual([
      "macros",
      "search",
      "threads",
    ]);
  });

  it("reverts the optimistic add when the mutation fails", async () => {
    requestMock.mockRejectedValue(new Error("offline"));
    useDisclosureStore.getState().recordUsage("threads");
    expect(useDisclosureStore.getState().featuresUsed.has("threads")).toBe(true);

    await vi.waitFor(() =>
      expect(useDisclosureStore.getState().featuresUsed.has("threads")).toBe(false),
    );
  });
});
