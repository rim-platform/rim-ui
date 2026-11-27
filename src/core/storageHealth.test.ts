import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";
import { reportStorageFailure, storageFailed, useStorageHealthStore } from "./storageHealth";

describe("storage health", () => {
  beforeEach(() => {
    useStorageHealthStore.setState({ failures: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps and logs the first failure of each store, once", () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    expect(storageFailed("account")).toBe(false);

    reportStorageFailure("account", new DOMException("cannot open", "UnknownError"));
    reportStorageFailure("account", new Error("later"));

    expect(useStorageHealthStore.getState().failures).toEqual({
      account: "UnknownError: cannot open",
    });
    expect(storageFailed("account")).toBe(true);
    expect(storageFailed("relay")).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[RIM:storage] the",
      "account",
      "store can't save on this device:",
      "UnknownError: cannot open",
    );
  });

  it("keeps each store apart, and takes what is not an Error as text", () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    reportStorageFailure("account", new Error("a"));
    reportStorageFailure("relay", "blocked");
    expect(useStorageHealthStore.getState().failures).toEqual({
      account: "Error: a",
      relay: "blocked",
    });
    expect(storageFailed("relay")).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
