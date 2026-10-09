import { describe, expect, it, vi } from "vitest";

describe("browserDeviceKeysSupported", () => {
  it("is true with WebCrypto Ed25519 and IndexedDB, and probes once", async () => {
    vi.resetModules();
    await import("fake-indexeddb/auto");
    const generate = vi.spyOn(crypto.subtle, "generateKey");
    const { browserDeviceKeysSupported } = await import("./ed25519");
    expect(await browserDeviceKeysSupported()).toBe(true);
    expect(await browserDeviceKeysSupported()).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    generate.mockRestore();
  });

  it("is false when the browser has no Ed25519", async () => {
    vi.resetModules();
    const generate = vi
      .spyOn(crypto.subtle, "generateKey")
      .mockRejectedValue(new DOMException("unsupported", "NotSupportedError"));
    const { browserDeviceKeysSupported } = await import("./ed25519");
    expect(await browserDeviceKeysSupported()).toBe(false);
    generate.mockRestore();
  });
});
