import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePresenceStore } from "../../../presence/state/usePresenceStore";
import { HiddenPresenceContext } from "./hiddenPresence";
import { useAuthorPresence } from "./useAuthorPresence";

afterEach(() => usePresenceStore.setState({ presenceMap: {} }));

describe("useAuthorPresence", () => {
  it("reads an author's presence, unless the timeline hides theirs", () => {
    usePresenceStore.getState().setPresence("u-alice", "ONLINE");
    usePresenceStore.getState().setPresence("u-bob", "AWAY");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HiddenPresenceContext.Provider value="u-alice">{children}</HiddenPresenceContext.Provider>
    );
    expect(
      renderHook(() => useAuthorPresence("u-alice", "ONLINE"), { wrapper }).result.current,
    ).toBeNull();
    expect(renderHook(() => useAuthorPresence("u-bob", null), { wrapper }).result.current).toBe(
      "AWAY",
    );
    expect(renderHook(() => useAuthorPresence("u-alice", null)).result.current).toBe("ONLINE");
  });
});
