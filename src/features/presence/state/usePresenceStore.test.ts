import { describe, it, expect, beforeEach } from "vitest";
import { usePresenceStore } from "./usePresenceStore";
import type { PresenceStatus } from "./usePresenceStore";

describe("usePresenceStore", () => {
  beforeEach(() => {
    usePresenceStore.setState({ presenceMap: {}, selfId: null });
  });

  it("keeps the viewer's own status over the server's list and events", () => {
    const store = usePresenceStore.getState();
    store.setSelf("me", "ONLINE");
    store.setBulk([
      { userId: "me", status: "OFFLINE" },
      { userId: "bob", status: "ONLINE" },
    ]);
    store.setPresence("me", "OFFLINE");

    expect(usePresenceStore.getState().presenceMap).toMatchObject({ me: "ONLINE", bob: "ONLINE" });
  });

  it("starts with empty presence map", () => {
    expect(usePresenceStore.getState().presenceMap).toEqual({});
  });

  it("sets a user presence", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("ONLINE");
  });

  it("updates an existing user presence", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setPresence("user-1", "AWAY");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("AWAY");
  });

  it("tracks multiple users", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setPresence("user-2", "OFFLINE");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("ONLINE");
    expect(usePresenceStore.getState().presenceMap["user-2"]).toBe("OFFLINE");
  });

  it("sets presence in bulk", () => {
    const entries: { userId: string; status: PresenceStatus }[] = [
      { userId: "user-1", status: "ONLINE" },
      { userId: "user-2", status: "AWAY" },
      { userId: "user-3", status: "OFFLINE" },
    ];
    usePresenceStore.getState().setBulk(entries);
    const map = usePresenceStore.getState().presenceMap;
    expect(map["user-1"]).toBe("ONLINE");
    expect(map["user-2"]).toBe("AWAY");
    expect(map["user-3"]).toBe("OFFLINE");
  });

  it("bulk set merges with existing data", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setBulk([{ userId: "user-2", status: "AWAY" }]);
    const map = usePresenceStore.getState().presenceMap;
    expect(map["user-1"]).toBe("ONLINE");
    expect(map["user-2"]).toBe("AWAY");
  });

  it("bulk set overwrites existing entries", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setBulk([{ userId: "user-1", status: "OFFLINE" }]);
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("OFFLINE");
  });
});
