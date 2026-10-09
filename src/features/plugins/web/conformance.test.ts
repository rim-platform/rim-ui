// @vitest-environment node
// The template plugin's browser build, run as a plugin frame would run it (over
// `portTransport` on a real MessageChannel, with `rimPluginPort` and
// `rimPluginManifest` set), against the web host's session code, through every
// v1 message. Every message the host sends must match the protocol schema.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error the shared build options are a plain JavaScript module
import {
  browserBuildOptions,
  withoutHashbang,
} from "../../../../sdk/plugin-sdk/scripts/browser-build.mjs";
import { PluginSession, type SessionPort } from "./pluginSession";
import { RpcError } from "./rpc";
import { hostMessageDef, schemaProblems } from "./testing/protocolSchema";

const TEMPLATE = join(import.meta.dirname, "../../../../plugins/template-ts");
const PRINCIPAL = {
  principalId: "rimp0_PWcag22GowE59KogGTaUReeoF_q4E5EVi28q83uaGBU",
  displayName: "Jakub",
};

async function buildTemplate(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "rim-web-conformance-"));
  const outfile = join(dir, "main.mjs");
  await build(browserBuildOptions(join(TEMPLATE, "main.ts"), outfile));
  const code = withoutHashbang(readFileSync(outfile, "utf8")) as string;
  expect(code).not.toMatch(/["'`]node:/);
  writeFileSync(outfile, code);
  return outfile;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).rimPluginPort;
  delete (globalThis as Record<string, unknown>).rimPluginManifest;
});

describe("the template's browser build over a port", () => {
  it("speaks every v1 message with the web host's session", async () => {
    const entry = await buildTemplate();
    const channel = new MessageChannel();
    const sent: Record<string, unknown>[] = [];
    const hostPort: SessionPort = {
      postMessage(text: string) {
        sent.push(JSON.parse(text) as Record<string, unknown>);
        channel.port1.postMessage(text);
      },
      get onmessage() {
        return channel.port1.onmessage as SessionPort["onmessage"];
      },
      set onmessage(listener) {
        channel.port1.onmessage = listener as typeof channel.port1.onmessage;
      },
      close: () => channel.port1.close(),
    };
    const logs: string[] = [];
    let stopped: string | null = null;
    const session = new PluginSession(
      hostPort,
      {
        pluginId: "dev.example.template-ts",
        hostVersion: "0.1.0",
        grantedCapabilities: [],
        principal: PRINCIPAL,
        mappings: [],
        isHidden: () => false,
      },
      {
        log: (level, message) => logs.push(`${level}: ${message}`),
        updatePanel: () => ({}),
        storageGet: async () => null,
        storageSet: async () => {},
        stopped: (reason) => {
          stopped = reason;
        },
      },
    );

    // As the frame shell does, before it imports the entry module.
    Object.assign(globalThis, {
      rimPluginPort: channel.port2,
      rimPluginManifest: readFileSync(join(TEMPLATE, "rim-plugin.json"), "utf8"),
    });
    // The module awaits run(), so it settles only once the plugin stopped.
    const running = import(pathToFileURL(entry).href);

    await session.handshake();
    expect(session.running).toBe(true);

    await session.heartbeat();
    expect(
      await session.execute({
        commandId: "greet",
        args: { name: "RIM" },
        invoker: PRINCIPAL,
        initiator: "user",
        confirmed: false,
      }),
    ).toEqual({
      payload: "Hello, RIM!",
      message: "1 greeting so far",
    });
    await expect(
      session.execute({
        commandId: "reset_greetings",
        args: {},
        invoker: PRINCIPAL,
        initiator: "user",
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: -32002, data: { reason: "confirmation_required" } });
    expect(
      await session.execute({
        commandId: "reset_greetings",
        args: {},
        invoker: PRINCIPAL,
        initiator: "user",
        confirmed: true,
      }),
    ).toEqual({ payload: { cleared: 1 }, message: "Cleared 1 greetings" });
    const unknown = session.execute({
      commandId: "nope",
      args: {},
      invoker: null,
      initiator: "agent",
      confirmed: false,
    });
    await expect(unknown).rejects.toBeInstanceOf(RpcError);
    await expect(unknown).rejects.toMatchObject({ code: -32602 });

    session.setPrincipal(null);
    session.setMappings([
      { from: PRINCIPAL.principalId, to: "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo" },
    ]);
    await session.heartbeat();
    expect(logs).toContain("info: signed out");
    expect(logs.some((line) => line.startsWith("info: ready on protocol v1"))).toBe(true);

    await session.shutdown(50);
    await running;
    expect(stopped).toBeNull();

    const methods = sent.map((m) => m.method ?? "response");
    expect(methods).toEqual([
      "rim.handshake",
      "rim.heartbeat",
      "rim.command.execute",
      "rim.command.execute",
      "rim.command.execute",
      "rim.command.execute",
      "rim.principal.changed",
      "rim.principals.remapped",
      "rim.heartbeat",
      "rim.shutdown",
    ]);
    for (const message of sent) {
      expect(schemaProblems(hostMessageDef(message), message)).toEqual([]);
    }
  }, 30_000);
});
