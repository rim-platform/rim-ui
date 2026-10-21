import { beforeEach, describe, expect, it } from "vitest";

import { rememberHandles, useKnownHandles } from "./useKnownHandles";

describe("useKnownHandles", () => {
  beforeEach(() => useKnownHandles.setState({ byUser: {} }));

  it("keeps the handles people carry and what is known when one comes without", () => {
    rememberHandles([
      { id: "u-1", handle: "@ada:elsewhere.example" },
      { id: "u-2", handle: null },
      null,
      { id: "u-3", handle: "not a handle" },
    ]);
    expect(useKnownHandles.getState().byUser).toEqual({ "u-1": "@ada:elsewhere.example" });

    rememberHandles([{ id: "u-1" }, { id: "u-2", handle: "@bob:rim-platform.org" }]);
    expect(useKnownHandles.getState().byUser).toEqual({
      "u-1": "@ada:elsewhere.example",
      "u-2": "@bob:rim-platform.org",
    });
  });

  it("leaves the state as it is when nothing changes", () => {
    rememberHandles([{ id: "u-1", handle: "@ada:elsewhere.example" }]);
    const before = useKnownHandles.getState().byUser;
    rememberHandles([{ id: "u-1", handle: "@ada:elsewhere.example" }]);
    expect(useKnownHandles.getState().byUser).toBe(before);
  });
});
