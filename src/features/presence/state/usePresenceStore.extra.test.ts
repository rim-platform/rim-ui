import { describe, it, expect, beforeEach } from "vitest";
import { usePresenceStore } from "./usePresenceStore";

describe("usePresenceStore (extra coverage)", () => {
  beforeEach(() => {
    usePresenceStore.setState({ presenceMap: {} });
  });

  it("starts with empty presenceMap", () => {
    expect(usePresenceStore.getState().presenceMap).toEqual({});
  });

  it("setPresence adds a single user presence", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("ONLINE");
  });

  it("setPresence updates existing presence", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setPresence("user-1", "AWAY");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("AWAY");
  });

  it("setPresence does not affect other users", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setPresence("user-2", "OFFLINE");

    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("ONLINE");
    expect(usePresenceStore.getState().presenceMap["user-2"]).toBe("OFFLINE");
  });

  it("setBulk sets multiple presence entries at once", () => {
    usePresenceStore.getState().setBulk([
      { userId: "user-1", status: "ONLINE" },
      { userId: "user-2", status: "AWAY" },
      { userId: "user-3", status: "OFFLINE" },
    ]);

    const map = usePresenceStore.getState().presenceMap;
    expect(map["user-1"]).toBe("ONLINE");
    expect(map["user-2"]).toBe("AWAY");
    expect(map["user-3"]).toBe("OFFLINE");
  });

  it("setBulk merges with existing data", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setBulk([
      { userId: "user-2", status: "AWAY" },
    ]);

    const map = usePresenceStore.getState().presenceMap;
    expect(map["user-1"]).toBe("ONLINE");
    expect(map["user-2"]).toBe("AWAY");
  });

  it("setBulk overwrites existing entries for same user", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setBulk([
      { userId: "user-1", status: "OFFLINE" },
    ]);

    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("OFFLINE");
  });

  it("setBulk with empty array does not clear existing data", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    usePresenceStore.getState().setBulk([]);

    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("ONLINE");
  });

  it("handles transition from ONLINE to AWAY to OFFLINE", () => {
    usePresenceStore.getState().setPresence("user-1", "ONLINE");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("ONLINE");

    usePresenceStore.getState().setPresence("user-1", "AWAY");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("AWAY");

    usePresenceStore.getState().setPresence("user-1", "OFFLINE");
    expect(usePresenceStore.getState().presenceMap["user-1"]).toBe("OFFLINE");
  });
});
