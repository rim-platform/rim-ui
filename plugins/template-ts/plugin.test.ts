// Tests the template against the SDK's in-memory host: no RIM app needed.
// Outside this repository, import from "@rim/plugin-sdk/testing".
import { describe, expect, it } from "vitest";

import { startTestHost } from "../../sdk/plugin-sdk/src/testing.ts";
import { createPlugin } from "./plugin.ts";

describe("template plugin", () => {
  it("greets the signed-in user and counts greetings", async () => {
    const host = startTestHost(createPlugin(), {
      manifestPath: `${import.meta.dirname}/rim-plugin.json`,
    });
    expect((await host.handshake()).accepted).toBe(true);
    expect(await host.execute("greet")).toEqual({
      result: { payload: "Hello, Test User!", message: "1 greeting so far" },
    });
    expect(await host.execute("greet", { name: "RIM" })).toEqual({
      result: { payload: "Hello, RIM!", message: "2 greetings so far" },
    });
    expect((await host.execute("greet", { name: 7 })).error?.message).toBe("name must be a string");
    await host.shutdown();
  });

  it("resets the count only after the user confirms", async () => {
    const host = startTestHost(createPlugin(), {
      manifestPath: `${import.meta.dirname}/rim-plugin.json`,
    });
    await host.handshake();
    await host.execute("greet");
    expect((await host.execute("reset_greetings")).error?.data).toEqual({
      reason: "confirmation_required",
    });
    expect(await host.execute("reset_greetings", {}, { confirmed: true })).toEqual({
      result: { payload: { cleared: 1 }, message: "Cleared 1 greetings" },
    });
    await host.shutdown();
  });
});
