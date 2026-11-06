import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { GROUPS_LOADING_AT_ONCE, useLoadQueue } from "./loadQueue";

const started = (queue: ReturnType<typeof useLoadQueue>, keys: string[]) =>
  keys.filter((key) => queue.isStarted(key));

describe("useLoadQueue", () => {
  const keys = ["a", "b", "c", "d", "e", "f"];

  it("starts at most four at once, and the next as one answers", () => {
    expect(GROUPS_LOADING_AT_ONCE).toBe(4);
    const { result } = renderHook(() => useLoadQueue());
    act(() => keys.forEach((key) => result.current.request(key)));
    expect(started(result.current, keys)).toEqual(["a", "b", "c", "d"]);

    act(() => result.current.settle("b"));
    expect(started(result.current, keys)).toEqual(["a", "b", "c", "d", "e"]);
    act(() => result.current.settle("b"));
    expect(started(result.current, keys)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not queue a group twice, and keeps a started group started", () => {
    const { result } = renderHook(() => useLoadQueue(1));
    act(() => {
      result.current.request("a");
      result.current.request("a");
      result.current.request("b");
    });
    act(() => result.current.settle("a"));
    expect(started(result.current, ["a", "b"])).toEqual(["a", "b"]);
    act(() => result.current.settle("b"));
    expect(started(result.current, ["a", "b"])).toEqual(["a", "b"]);
  });
});
