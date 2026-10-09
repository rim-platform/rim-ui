// The SDK over a MessagePort, as a WebSandboxed plugin's frame talks to the
// host: the same plugins and assertions as over stdio, the store a web host
// keeps, and run() finding the port and manifest a frame shell provides.
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";

import { createPlugin } from "../../../plugins/template-ts/plugin.ts";
import {
  definePlugin,
  ErrorCode,
  HostRequestError,
  portTransport,
  type PortLike,
} from "../src/index.ts";
import { startTestHost } from "../src/testing.ts";

const TEMPLATE_MANIFEST = `${import.meta.dirname}/../../../plugins/template-ts/rim-plugin.json`;

describe("the test host over a port", () => {
  it("runs the template plugin with the same answers as over stdio", async () => {
    const host = startTestHost(createPlugin(), {
      transport: "port",
      manifestPath: TEMPLATE_MANIFEST,
    });
    expect((await host.handshake()).accepted).toBe(true);
    expect(await host.execute("greet")).toEqual({
      result: { payload: "Hello, Test User!", message: "1 greeting so far" },
    });
    expect((await host.execute("reset_greetings")).error?.data).toEqual({
      reason: "confirmation_required",
    });
    expect(await host.execute("reset_greetings", {}, { confirmed: true })).toEqual({
      result: { payload: { cleared: 1 }, message: "Cleared 1 greetings" },
    });
    expect(await host.heartbeat()).toEqual({ pong: true });
    expect(await host.shutdown()).toBe(0);
  });

  it("gives a plugin the host's store, and METHOD_NOT_FOUND where there is none", async () => {
    const store = new Map<string, unknown>();
    let seen: unknown = "unset";
    const plugin = definePlugin({
      id: "dev.example.store",
      commands: {
        remember: {
          async run({ host, args }) {
            await host.storage.set("name", args.name);
            seen = await host.storage.get("name");
            return { payload: seen };
          },
        },
      },
    });
    const host = startTestHost(plugin, {
      transport: "port",
      onRequest(method, params) {
        const p = params as { key: string; value?: unknown };
        if (method === "rim.storage.set") {
          store.set(p.key, p.value);
          return { ok: true };
        }
        if (method === "rim.storage.get") return { value: store.get(p.key) ?? null };
        throw { code: ErrorCode.METHOD_NOT_FOUND, message: `method not found: ${method}` };
      },
    });
    await host.handshake();
    expect(await host.execute("remember", { name: "Ada" })).toEqual({ result: { payload: "Ada" } });
    await host.shutdown();

    const local = startTestHost(plugin);
    await local.handshake();
    const refused = await local.execute("remember", { name: "Ada" });
    expect(refused.error?.code).toBe(ErrorCode.PLUGIN_ERROR);
    expect(refused.error?.message).toContain(`(${ErrorCode.METHOD_NOT_FOUND})`);
    await local.shutdown();
  });
});

describe("run() in a plugin frame", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).rimPluginPort;
    delete (globalThis as Record<string, unknown>).rimPluginManifest;
  });

  function frameGlobals(port: unknown, manifest: object) {
    Object.assign(globalThis, { rimPluginPort: port, rimPluginManifest: JSON.stringify(manifest) });
  }

  /** Send a request and resolve with the answer carrying its id, skipping log lines. */
  function ask(port: import("node:worker_threads").MessagePort, message: { id: number }) {
    return new Promise<Record<string, unknown>>((resolve) => {
      const listener = (data: string) => {
        const frame = JSON.parse(data) as Record<string, unknown>;
        if (frame.id !== message.id) return;
        port.off("message", listener);
        resolve(frame);
      };
      port.on("message", listener);
      port.postMessage(JSON.stringify(message));
    });
  }

  const handshake = (pluginId: string) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "rim.handshake",
    params: {
      protocolVersion: 1,
      supportedVersions: [1],
      pluginId,
      hostVersion: "0.0.0-test",
      grantedCapabilities: [],
      principal: null,
    },
  });

  it("talks over rimPluginPort and checks rimPluginManifest", async () => {
    const channel = new MessageChannel();
    frameGlobals(channel.port2, { plugin_id: "dev.example.framed", commands: [] });
    const done = definePlugin({ id: "dev.example.framed" }).run();
    const answer = await ask(channel.port1, handshake("dev.example.framed"));
    expect(answer.result).toEqual({
      accepted: true,
      protocolVersion: 1,
      pluginId: "dev.example.framed",
    });
    channel.port1.postMessage(JSON.stringify({ jsonrpc: "2.0", method: "rim.shutdown" }));
    await done;
    channel.port1.close();
  });

  it("refuses the handshake when the frame's manifest names another plugin", async () => {
    const channel = new MessageChannel();
    frameGlobals(channel.port2, { plugin_id: "dev.example.other" });
    const done = definePlugin({ id: "dev.example.framed" }).run();
    const answer = await ask(channel.port1, handshake("dev.example.framed"));
    expect((answer.result as { accepted: boolean }).accepted).toBe(false);
    channel.port1.postMessage(JSON.stringify({ jsonrpc: "2.0", method: "rim.shutdown" }));
    await done;
    channel.port1.close();
  });
});

describe("portTransport", () => {
  it("passes strings, turns anything else into an empty message, and ends on a message over 4 MiB", async () => {
    const channel = new MessageChannel();
    const transport = portTransport(channel.port2 as unknown as PortLike);
    channel.port1.postMessage("one");
    channel.port1.postMessage({ not: "a string" });
    channel.port1.postMessage("x".repeat(4 * 1024 * 1024 + 1));
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const message of transport.messages) seen.push(message);
      })(),
    ).rejects.toThrow("over the");
    expect(seen).toEqual(["one", ""]);
    expect(() => transport.send("y".repeat(4 * 1024 * 1024 + 1))).toThrow();
    transport.close();
    channel.port1.close();
  });

  it("is what HostRequestError wraps a refused call in", () => {
    expect(new HostRequestError("rim.storage.get", { code: -32601, message: "no" }).code).toBe(
      -32601,
    );
  });
});
