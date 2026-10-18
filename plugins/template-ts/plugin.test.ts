// Tests the template against the SDK's in-memory host: no RIM app needed.
import { describe, expect, it, vi } from "vitest";
import { startTestHost } from "@rim-platform/plugin-sdk/testing";

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

  it("greets with the greeting the user saved, and follows every change", async () => {
    const host = startTestHost(createPlugin(), {
      manifestPath: `${import.meta.dirname}/rim-plugin.json`,
      settings: { greeting: "Hi" },
    });
    await host.handshake();
    // The plugin reads its settings once it is ready.
    await vi.waitFor(() =>
      expect(host.frames).toContainEqual(expect.objectContaining({ method: "rim.settings.get" })),
    );
    await host.heartbeat();
    expect((await host.execute("greet")).result?.payload).toBe("Hi, Test User!");

    host.changeSettings({ greeting: "Howdy" });
    expect((await host.execute("greet")).result?.payload).toBe("Howdy, Test User!");
    // A cleared setting is missing from the new set: back to the default.
    host.changeSettings({});
    expect((await host.execute("greet")).result?.payload).toBe("Hello, Test User!");
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
