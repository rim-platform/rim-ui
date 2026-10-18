// Runs the template plugin as the host does: a separate process, started
// through its entrypoint's #! line, speaking frames over real stdin and stdout.
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { encodeFrame, FrameDecoder } from "../src/framing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(here, "../../../plugins/template-ts");
const BUNDLER = resolve(here, "../scripts/bundle-plugin.mjs");
const PRINCIPAL = {
  principalId: "rimp0_PWcag22GowE59KogGTaUReeoF_q4E5EVi28q83uaGBU",
  displayName: "Jakub",
};

type Frame = Record<string, unknown>;

function launch(pluginDir: string) {
  const manifest = JSON.parse(readFileSync(join(pluginDir, "rim-plugin.json"), "utf8"));
  const child = spawn(join(pluginDir, manifest.entrypoint), [], {
    cwd: pluginDir,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const decoder = new FrameDecoder();
  const responses = new Map<unknown, (frame: Frame) => void>();
  const early = new Map<unknown, Frame>();
  const logs: Frame[] = [];
  const settingsReads: Frame[] = [];
  const send = (frame: Frame) => child.stdin.write(encodeFrame(frame));
  child.stdout.on("data", (chunk: Uint8Array) => {
    for (const decoded of decoder.push(chunk)) {
      if (!decoded.ok) throw new Error(decoded.error);
      const frame = decoded.value as Frame;
      if (frame.method === "rim.log") logs.push(frame);
      else if (frame.method === "rim.settings.get") {
        settingsReads.push(frame);
        send({ jsonrpc: "2.0", id: frame.id, result: { values: { greeting: "Hi" } } });
      } else if (responses.has(frame.id)) responses.get(frame.id)?.(frame);
      else early.set(frame.id, frame);
    }
  });
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  const ask = (frame: Frame) =>
    new Promise<Frame>((done) => {
      if (early.has(frame.id)) return done(early.get(frame.id) as Frame);
      responses.set(frame.id, done);
      send(frame);
    });
  return { manifest, send, ask, logs, settingsReads, exited };
}

function execute(id: number, commandId: string, args: Frame, confirmed: boolean): Frame {
  return {
    jsonrpc: "2.0",
    id,
    method: "rim.command.execute",
    params: { commandId, args, invoker: PRINCIPAL, initiator: "user", confirmed },
  };
}

async function speaksV1(pluginDir: string) {
  const plugin = launch(pluginDir);
  const handshake = await plugin.ask({
    jsonrpc: "2.0",
    id: 1,
    method: "rim.handshake",
    params: {
      protocolVersion: 2,
      supportedVersions: [2, 1],
      pluginId: plugin.manifest.plugin_id,
      hostVersion: "0.1.0",
      grantedCapabilities: [],
      principal: PRINCIPAL,
    },
  });
  expect(handshake.result).toEqual({
    accepted: true,
    protocolVersion: 1,
    pluginId: "dev.example.template-ts",
  });

  expect((await plugin.ask({ jsonrpc: "2.0", id: -1, method: "rim.heartbeat" })).result).toEqual({
    pong: true,
  });
  // The plugin read its settings once ready, and a heartbeat later it has them.
  await vi.waitFor(() => expect(plugin.settingsReads).toHaveLength(1));
  expect(plugin.settingsReads[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "rim.settings.get" });
  await plugin.ask({ jsonrpc: "2.0", id: -2, method: "rim.heartbeat" });
  expect((await plugin.ask(execute(2, "greet", { name: "RIM" }, false))).result).toEqual({
    payload: "Hi, RIM!",
    message: "1 greeting so far",
  });
  plugin.send({
    jsonrpc: "2.0",
    method: "rim.settings.changed",
    params: { values: { greeting: "Howdy" } },
  });
  expect((await plugin.ask(execute(5, "greet", { name: "RIM" }, false))).result).toMatchObject({
    payload: "Howdy, RIM!",
  });
  const refused = await plugin.ask(execute(3, "reset_greetings", {}, false));
  expect(refused.error).toMatchObject({ code: -32002, data: { reason: "confirmation_required" } });
  expect((await plugin.ask(execute(4, "reset_greetings", {}, true))).result).toEqual({
    payload: { cleared: 2 },
    message: "Cleared 2 greetings",
  });

  plugin.send({ jsonrpc: "2.0", method: "rim.shutdown" });
  expect(await plugin.exited).toBe(0);
  expect(plugin.logs.every((log) => log.id === undefined)).toBe(true);
}

describe("template plugin over stdio", () => {
  it("speaks v1 from its TypeScript source", () => speaksV1(TEMPLATE_DIR), 20_000);

  it("speaks v1 once bundled into a single file", () => {
    const outDir = join(mkdtempSync(join(tmpdir(), "rim-bundle-")), "dev.example.template-ts");
    execFileSync(process.execPath, [BUNDLER, TEMPLATE_DIR, outDir]);
    const manifest = JSON.parse(readFileSync(join(outDir, "rim-plugin.json"), "utf8"));
    expect(manifest.entrypoint).toBe("main.mjs");
    return speaksV1(outDir);
  }, 30_000);
});
