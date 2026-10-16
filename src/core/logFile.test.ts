import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: sent.warn, error: sent.error }));

import { forwardConsoleToLogFile, logLine } from "./logFile";

describe("logLine", () => {
  it("keeps plain text, scalars and an error's name and message", () => {
    expect(logLine(["[RIM:cache] sync failed:", new TypeError("boom"), 3, null])).toBe(
      "[RIM:cache] sync failed: TypeError: boom 3 null",
    );
  });

  it("names an object by its kind instead of printing it", () => {
    expect(logLine(["vars:", { text: "hello there" }, ["a"]])).toBe("vars: [Object] [Array]");
  });

  it("cuts the JSON a GraphQL client error quotes", () => {
    const err = new Error(
      'Forbidden: {"response":{"errors":[]},"request":{"variables":{"text":"secret plans"}}}',
    );
    expect(logLine([err])).toBe("Error: Forbidden: {…}");
  });

  it("drops a URL's query and fragment", () => {
    expect(logLine(["GET https://rim.example.org/api/files/1?token=abc#x failed"])).toBe(
      "GET https://rim.example.org/api/files/1?… failed",
    );
    expect(logLine(["wss://rim.example.org/api/ws?ticket=t1 closed"])).toBe(
      "wss://rim.example.org/api/ws?… closed",
    );
  });

  it("redacts token-like runs but keeps ids", () => {
    const id = "0199f2c4-7a1b-7c3d-8e4f-123456789abc";
    expect(logLine([`csrf ${"Ab3_".repeat(10)} for ${id}`])).toBe(`csrf [redacted] for ${id}`);
  });

  it("withholds a plugin's own output", () => {
    expect(logLine(["[plugin:acme.notes] the note says hello"])).toBe(
      "[plugin:acme.notes] output withheld",
    );
  });

  it("caps a long line", () => {
    const line = logLine(["word ".repeat(400)]);
    expect(line).toHaveLength(1001);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("forwardConsoleToLogFile", () => {
  const original = { warn: console.warn, error: console.error };
  const printed = { warn: vi.fn(), error: vi.fn() };
  let stop: () => void;

  beforeEach(() => {
    sent.warn.mockReset().mockResolvedValue(undefined);
    sent.error.mockReset().mockResolvedValue(undefined);
    printed.warn.mockReset();
    printed.error.mockReset();
    console.warn = printed.warn;
    console.error = printed.error;
    stop = forwardConsoleToLogFile();
  });

  afterEach(() => {
    stop();
    console.warn = original.warn;
    console.error = original.error;
  });

  it("copies warnings and errors into the log file and still prints them", () => {
    console.warn("[RIM:relay] slow", { body: "x" });
    console.error("[RIM:Surface] crashed", new Error("bad"));

    expect(sent.warn).toHaveBeenCalledWith("[RIM:relay] slow [Object]");
    expect(sent.error).toHaveBeenCalledWith("[RIM:Surface] crashed Error: bad");
    expect(printed.warn).toHaveBeenCalledWith("[RIM:relay] slow", { body: "x" });
    expect(printed.error).toHaveBeenCalledOnce();
  });

  it("logs uncaught errors and unhandled rejections", () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new RangeError("out of range") }));
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: new Error("lost") });
    window.dispatchEvent(rejection);

    expect(sent.error).toHaveBeenCalledWith("Uncaught RangeError: out of range");
    expect(sent.error).toHaveBeenCalledWith("Unhandled rejection Error: lost");
  });

  it("keeps working when the log file cannot be written", async () => {
    sent.error.mockRejectedValue(new Error("no plugin"));
    expect(() => console.error("still printed")).not.toThrow();
    await Promise.resolve();
    expect(sent.error).toHaveBeenCalledOnce();
  });

  it("does not loop when writing the log file itself logs", () => {
    sent.warn.mockImplementation(async (line: string) => {
      console.warn("nested", line);
    });
    console.warn("outer");
    expect(sent.warn).toHaveBeenCalledOnce();
  });

  it("restores the console when stopped", () => {
    stop();
    console.warn("after stop");
    expect(sent.warn).not.toHaveBeenCalled();
    stop = () => undefined;
  });
});
