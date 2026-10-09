import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  definePlugin,
  ErrorCode,
  HostRequestError,
  PluginError,
  type CommandContext,
  type Host,
  type PluginDefinition,
} from "../src/index.ts";
import { startTestHost, TEST_PRINCIPAL, type TestHostOptions } from "../src/testing.ts";

const ID = "dev.example.sdk-test";

function start(definition: Partial<PluginDefinition> = {}, options: TestHostOptions = {}) {
  return startTestHost(definePlugin({ id: ID, ...definition }), options);
}

function manifestFile(manifest: object): string {
  const path = join(mkdtempSync(join(tmpdir(), "rim-sdk-")), "rim-plugin.json");
  writeFileSync(path, JSON.stringify(manifest));
  return path;
}

describe("definePlugin", () => {
  it("rejects a definition without an id or with a command that cannot run", () => {
    expect(() => definePlugin({ id: "" })).toThrow(TypeError);
    expect(() => definePlugin({ id: ID, commands: { greet: {} as never } })).toThrow(/greet/);
  });
});

describe("handshake", () => {
  it("picks the newest version both sides speak", async () => {
    const onReady = vi.fn();
    const host = start({ onReady });
    const result = await host.handshake({ protocolVersion: 2, supportedVersions: [2, 1] });
    expect(result).toEqual({ accepted: true, protocolVersion: 1, pluginId: ID });
    const ready: Host = onReady.mock.calls[0][0];
    expect(ready.protocolVersion).toBe(1);
    expect(ready.hostVersion).toBe("0.0.0-test");
    expect(ready.principal).toEqual(TEST_PRINCIPAL);
    await host.shutdown();
  });

  it("refuses a host that speaks no version it knows, naming the one it speaks", async () => {
    const host = start({ onReady: () => expect.fail("must not become ready") });
    const result = await host.handshake({ protocolVersion: 2, supportedVersions: [2] });
    expect(result.accepted).toBe(false);
    expect(result.protocolVersion).toBe(1);
    expect(result.pluginId).toBe(ID);
    expect(result.error).toMatch(/speaks protocol 2.*speaks 1/);
    expect((await host.execute("anything")).error?.code).toBe(ErrorCode.INVALID_REQUEST);
    await host.shutdown();
  });

  it("refuses a host that started it under another id", async () => {
    const host = start();
    const result = await host.handshake({ pluginId: "dev.example.other" });
    expect(result.accepted).toBe(false);
    expect(result.error).toContain("dev.example.other");
    await host.shutdown();
  });

  it("refuses when rim-plugin.json names another plugin", async () => {
    const host = start({}, { manifestPath: manifestFile({ plugin_id: "dev.example.other" }) });
    const result = await host.handshake();
    expect(result.accepted).toBe(false);
    expect(result.error).toContain("dev.example.other");
    await host.shutdown();
  });

  it("ignores fields it does not know and keeps only principalId and displayName", async () => {
    const onReady = vi.fn();
    const host = start({ onReady });
    const principal = { ...TEST_PRINCIPAL, accountId: "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b" };
    const result = await host.handshake({ futureField: { nested: true }, principal });
    expect(result.accepted).toBe(true);
    expect(Object.keys(onReady.mock.calls[0][0].principal)).toEqual(["principalId", "displayName"]);
    await host.shutdown();
  });
});

describe("requests from the host", () => {
  it("answers heartbeats", async () => {
    const host = start();
    await host.handshake();
    expect(await host.heartbeat()).toEqual({ pong: true });
    await host.shutdown();
  });

  it("answers unknown methods with METHOD_NOT_FOUND and ignores unknown notifications", async () => {
    const host = start();
    await host.handshake();
    host.notify("rim.future.notice", { anything: 1 });
    const response = await host.request("rim.future.method", {});
    expect((response.error as { code: number }).code).toBe(ErrorCode.METHOD_NOT_FOUND);
    expect(await host.heartbeat()).toEqual({ pong: true });
    await host.shutdown();
  });

  it("refuses a command before the handshake", async () => {
    const host = start({ commands: { greet: { run: () => ({ payload: 1 }) } } });
    expect((await host.execute("greet")).error?.code).toBe(ErrorCode.INVALID_REQUEST);
    await host.shutdown();
  });
});

describe("commands", () => {
  it("runs a command with a frozen context and returns its output", async () => {
    let seen: CommandContext | undefined;
    const host = start({
      commands: {
        greet: {
          run(context) {
            seen = context;
            return { payload: `Hello, ${context.args.name}!`, message: "greeted" };
          },
        },
      },
    });
    await host.handshake();
    const answer = await host.request("rim.command.execute", {
      commandId: "greet",
      args: { name: "RIM" },
      invoker: { ...TEST_PRINCIPAL, email: "someone@example.com" },
      initiator: "user",
      confirmed: false,
      futureField: true,
    });
    expect(answer.result).toEqual({ payload: "Hello, RIM!", message: "greeted" });
    expect(seen?.invoker).toEqual(TEST_PRINCIPAL);
    expect(seen?.initiator).toBe("user");
    expect(seen?.confirmed).toBe(false);
    expect(() => {
      (seen as { confirmed: boolean }).confirmed = true;
    }).toThrow(TypeError);
    await host.shutdown();
  });

  it("sends no payload when a command returns nothing", async () => {
    const host = start({ commands: { noop: { run: () => {} } } });
    await host.handshake();
    expect(await host.execute("noop")).toEqual({ result: {} });
    await host.shutdown();
  });

  it("answers unknown commands and malformed params with INVALID_PARAMS", async () => {
    const host = start({ commands: { greet: { run: () => {} } } });
    await host.handshake();
    expect((await host.execute("rm_rf")).error?.code).toBe(ErrorCode.INVALID_PARAMS);
    for (const params of [
      { commandId: "greet", args: {}, invoker: null, initiator: "user", confirmed: "yes" },
      { commandId: "greet", args: {}, invoker: null, initiator: "robot", confirmed: false },
      { commandId: "greet", args: [], invoker: null, initiator: "user", confirmed: false },
      {
        commandId: "greet",
        args: {},
        invoker: { principalId: 7 },
        initiator: "user",
        confirmed: false,
      },
    ]) {
      const response = await host.request("rim.command.execute", params);
      expect((response.error as { code: number }).code).toBe(ErrorCode.INVALID_PARAMS);
    }
    await host.shutdown();
  });

  it("turns thrown errors into JSON-RPC errors", async () => {
    const host = start({
      commands: {
        typed: {
          run: () => {
            throw new PluginError("pod not found", { code: -32050, data: { pod: "web-1" } });
          },
        },
        plain: {
          run: async () => {
            throw new Error("kubectl failed");
          },
        },
        wrong: { run: () => "a bare string" as never },
      },
    });
    await host.handshake();
    expect((await host.execute("typed")).error).toEqual({
      code: -32050,
      message: "pod not found",
      data: { pod: "web-1" },
    });
    expect((await host.execute("plain")).error).toEqual({
      code: ErrorCode.PLUGIN_ERROR,
      message: "kubectl failed",
    });
    expect((await host.execute("wrong")).error?.code).toBe(ErrorCode.INTERNAL_ERROR);
    await host.shutdown();
  });
});

describe("dangerous commands", () => {
  it("run only when the user confirmed this run", async () => {
    const run = vi.fn((context: CommandContext) => ({ payload: context.confirmed }));
    const host = start({ commands: { wipe: { dangerous: true, run } } });
    await host.handshake();

    const unconfirmed = await host.execute("wipe");
    expect(unconfirmed.error?.code).toBe(ErrorCode.PLUGIN_ERROR);
    expect(unconfirmed.error?.data).toEqual({ reason: "confirmation_required" });

    const byAgent = await host.execute("wipe", {}, { initiator: "agent", confirmed: true });
    expect(byAgent.error?.data).toEqual({ reason: "confirmation_required" });
    expect(run).not.toHaveBeenCalled();

    expect(await host.execute("wipe", {}, { confirmed: true })).toEqual({
      result: { payload: true },
    });
    expect(run).toHaveBeenCalledTimes(1);
    await host.shutdown();
  });

  it("are dangerous when the manifest says so, even if the code does not", async () => {
    const run = vi.fn(() => {});
    const manifestPath = manifestFile({
      plugin_id: ID,
      commands: [{ id: "wipe", dangerous: true }],
    });
    const host = start({ commands: { wipe: { run } } }, { manifestPath });
    await host.handshake();
    expect((await host.execute("wipe")).error?.code).toBe(ErrorCode.PLUGIN_ERROR);
    expect(run).not.toHaveBeenCalled();
    await host.shutdown();
  });

  it("warn about commands missing from either side", async () => {
    const manifestPath = manifestFile({ plugin_id: ID, commands: [{ id: "declared" }] });
    const host = start({ commands: { handled: { run: () => {} } } }, { manifestPath });
    await host.handshake();
    expect(host.logs.map((l) => l.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("command declared, which has no handler"),
        expect.stringContaining("command handled is not in rim-plugin.json"),
      ]),
    );
    await host.shutdown();
  });
});

describe("signed-in user", () => {
  it("reports changes once each and ignores malformed ones", async () => {
    const onPrincipalChanged = vi.fn();
    const host = start({ onPrincipalChanged });
    await host.handshake();
    const other = { principalId: "rimp0_other", displayName: "Other" };

    host.notify("rim.principal.changed", { principal: TEST_PRINCIPAL });
    host.notify("rim.principal.changed", { principal: { principalId: 42 } });
    host.notify("rim.principal.changed", { principal: other });
    host.notify("rim.principal.changed", { principal: null });
    await host.heartbeat();

    expect(onPrincipalChanged.mock.calls.map((call) => call[0])).toEqual([other, null]);
    const lastHost: Host = onPrincipalChanged.mock.calls[1][1];
    expect(lastHost.principal).toBeNull();
    await host.shutdown();
  });

  it("passes on id switches and ignores malformed ones", async () => {
    const onPrincipalsRemapped = vi.fn();
    const host = start({ onPrincipalsRemapped });
    await host.handshake();
    const mapping = { from: "rimp0_old", to: "rimp1_new" };

    host.notify("rim.principals.remapped", { mappings: [mapping] });
    host.notify("rim.principals.remapped", { mappings: [{ from: "rimp0_old" }] });
    host.notify("rim.principals.remapped", { mappings: "rimp1_new" });
    host.notify("rim.principals.remapped", { mappings: [] });
    await host.heartbeat();

    expect(onPrincipalsRemapped.mock.calls.map((call) => call[0])).toEqual([[mapping]]);
    await host.shutdown();
  });
});

describe("panels", () => {
  it("send rim.ui.update_panel and resolve when the host accepts", async () => {
    const onRequest = vi.fn(() => ({ ok: true }));
    let host: Host | undefined;
    const testHost = start(
      { onReady: (h) => void (host = h) },
      { onRequest, grantedCapabilities: ["ui.panel"] },
    );
    await testHost.handshake();
    await host?.panels.set("main", { pods: 3 });
    await host?.panels.patch("main", { pods: 4 });
    expect(onRequest.mock.calls).toEqual([
      ["rim.ui.update_panel", { panel_id: "main", state: { pods: 3 }, patch: false }],
      ["rim.ui.update_panel", { panel_id: "main", state: { pods: 4 }, patch: true }],
    ]);
    await testHost.shutdown();
  });

  it("reject with CAPABILITY_DENIED when ui.panel is not granted", async () => {
    const onRequest = vi.fn();
    let host: Host | undefined;
    const testHost = start({ onReady: (h) => void (host = h) }, { onRequest });
    await testHost.handshake();
    const error = await host?.panels.set("main", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostRequestError);
    expect((error as HostRequestError).code).toBe(ErrorCode.CAPABILITY_DENIED);
    expect(onRequest).not.toHaveBeenCalled();
    await testHost.shutdown();
  });

  it("reject with the host's error code", async () => {
    let host: Host | undefined;
    const testHost = start(
      { onReady: (h) => void (host = h) },
      {
        grantedCapabilities: ["ui.panel"],
        onRequest: () => {
          throw { code: ErrorCode.INVALID_PARAMS, message: "missing required param: state" };
        },
      },
    );
    await testHost.handshake();
    const error = await host?.panels.set("main", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostRequestError);
    expect((error as HostRequestError).code).toBe(ErrorCode.INVALID_PARAMS);
    await testHost.shutdown();
  });

  it("reject a panel the manifest does not declare without asking the host", async () => {
    const onRequest = vi.fn();
    let host: Host | undefined;
    const manifestPath = manifestFile({ plugin_id: ID, panels: [{ id: "main" }] });
    const testHost = start({ onReady: (h) => void (host = h) }, { onRequest, manifestPath });
    await testHost.handshake();
    await expect(host?.panels.set("other", {})).rejects.toThrow(/not declared/);
    expect(onRequest).not.toHaveBeenCalled();
    await testHost.shutdown();
  });
});

describe("shutdown", () => {
  it("runs onShutdown and exits 0 on rim.shutdown", async () => {
    const onShutdown = vi.fn();
    const host = start({ onShutdown });
    await host.handshake();
    expect(await host.shutdown()).toBe(0);
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it("exits 0 when the host closes stdin", async () => {
    const onShutdown = vi.fn();
    const host = start({ onShutdown });
    await host.handshake();
    host.close();
    expect(await host.exited).toBe(0);
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it("fails requests still waiting for the host", async () => {
    let host: Host | undefined;
    const testHost = start(
      { onReady: (h) => void (host = h) },
      { onRequest: () => new Promise(() => {}), grantedCapabilities: ["ui.panel"] },
    );
    await testHost.handshake();
    const pending = host?.panels.set("main", {});
    await testHost.shutdown();
    await expect(pending).rejects.toBeInstanceOf(HostRequestError);
  });
});
