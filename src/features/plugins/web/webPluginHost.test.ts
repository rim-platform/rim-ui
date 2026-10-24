// The web plugin host with a fake frame and a real MessageChannel: the plugin
// end of the port runs either the spec's plugin written without the SDK or a
// scripted plugin, and the host's frames, session, gates and limits are checked.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex, writeBundle, type BundleFile } from "./bundle";
import { BrowserPluginStore } from "./browserPluginStore";
import { hostMessageDef, schemaProblems } from "./testing/protocolSchema";
import { HELLO_WEB_MAIN, HELLO_WEB_MANIFEST } from "./testing/helloWeb";
import {
  SAFE_START_MESSAGE,
  WebCommandError,
  WebPluginHost,
  type ChatHandler,
  type FrameHandle,
  type HostEnvironment,
  type HostServices,
  type InstalledWebPlugin,
  type WindowMessage,
} from "./webPluginHost";
import type { SessionPort } from "./pluginSession";
import { RpcError } from "./rpc";
import { unlockTestVault } from "../../../test/accountVault";

const realImmediate = setImmediate;

/** Let messages on the real MessageChannel arrive. */
async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => realImmediate(resolve));
}

const encoder = new TextEncoder();
const PRINCIPAL = {
  principalId: "rimp0_PWcag22GowE59KogGTaUReeoF_q4E5EVi28q83uaGBU",
  displayName: "Jakub",
};

class FakeFrame implements FrameHandle {
  readonly title: string;
  readonly inits: { message: Record<string, unknown>; origin: string; transfer: unknown[] }[] = [];
  private readonly loadListeners: (() => void)[] = [];
  removed = false;
  readonly window = {
    postMessage: (message: unknown, origin: string, transfer: unknown[] = []) => {
      this.inits.push({ message: message as Record<string, unknown>, origin, transfer });
    },
  };

  constructor(title: string) {
    this.title = title;
  }

  onLoad(listener: () => void): void {
    this.loadListeners.push(listener);
  }

  load(): void {
    for (const listener of this.loadListeners) listener();
  }

  remove(): void {
    this.removed = true;
  }

  /** The plugin end of the port, transferred with the init message. */
  get port(): MessagePort {
    return this.inits[0].transfer[0] as MessagePort;
  }
}

function testEnvironment() {
  const frames: FakeFrame[] = [];
  const listeners = new Set<(message: WindowMessage) => void>();
  const sent: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const state = { hidden: false };
  const env: HostEnvironment = {
    shellUrl: "/plugin-frame/v1/index.html",
    hostVersion: "0.1.0",
    createFrame(title) {
      const frame = new FakeFrame(title);
      frames.push(frame);
      return frame;
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    createChannel() {
      const channel = new MessageChannel();
      const host: SessionPort = {
        postMessage(text: string) {
          sent.push(JSON.parse(text) as Record<string, unknown>);
          channel.port1.postMessage(text);
        },
        get onmessage() {
          return channel.port1.onmessage as SessionPort["onmessage"];
        },
        set onmessage(listener) {
          channel.port1.onmessage = listener;
        },
        close: () => channel.port1.close(),
      };
      return { host, plugin: channel.port2 };
    },
    isHidden: () => state.hidden,
    log: (_id, level, message) => logs.push(`${level}: ${message}`),
  };
  const post = (frame: FakeFrame, data: unknown, origin = "null") => {
    for (const listener of listeners) listener({ origin, source: frame.window, data });
  };
  return { env, frames, sent, logs, state, post };
}

function file(path: string, text: string): BundleFile {
  return { path, bytes: encoder.encode(text) };
}

function webManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    manifest_version: 1,
    plugin_id: "dev.example.scripted",
    display_name: "Scripted",
    version: "0.1.0",
    description: "A test plugin.",
    runtime_kind: "WebSandboxed",
    entrypoint: "main.mjs",
    capabilities: ["ui.notify"],
    commands: [
      { id: "echo", title: "Echo", description: "Echoes." },
      { id: "wipe", title: "Wipe", description: "Wipes.", dangerous: true },
      {
        id: "secret",
        title: "Secret",
        description: "Needs a key.",
        required_capabilities: ["ui.notify"],
      },
      { id: "slow", title: "Slow", description: "Never answers." },
    ],
    panels: [{ id: "main", title: "Main" }],
    ...overrides,
  });
}

function testServices(
  manifestText: string,
  files: BundleFile[] = [file("main.mjs", "export {};\n")],
) {
  const starting: [string, boolean][] = [];
  const store = new Map<string, unknown>();
  /** What `pluginSettings` answers, and the plugin ids it was asked for. */
  const settings = {
    read: (): Promise<Record<string, unknown>> => Promise.resolve({}),
    asked: [] as string[],
  };
  const services: HostServices = {
    loadFiles: async () => ({
      manifestText,
      files: [...files, file("rim-plugin.json", manifestText)].sort((a, b) =>
        a.path < b.path ? -1 : 1,
      ),
    }),
    setStarting: async (id, value) => {
      starting.push([id, value]);
    },
    storageGet: async (_id, key) => store.get(key) ?? null,
    storageSet: async (_id, key, value) => {
      store.set(key, value);
    },
    pluginSettings: (id) => {
      settings.asked.push(id);
      return settings.read();
    },
  };
  return { services, starting, store, settings };
}

function installed(overrides: Partial<InstalledWebPlugin> = {}): InstalledWebPlugin {
  return {
    pluginId: "dev.example.scripted",
    displayName: "Scripted",
    enabled: true,
    starting: false,
    approvedCapabilities: [],
    commands: [
      { id: "echo", dangerous: false, required_capabilities: [] },
      { id: "wipe", dangerous: true, required_capabilities: [] },
      {
        id: "secret",
        dangerous: false,
        required_capabilities: ["ui.notify"],
      },
      { id: "slow", dangerous: false, required_capabilities: [] },
    ],
    ...overrides,
  };
}

/** A plugin on the far end of the port that answers as a script says. */
function scriptedPlugin(
  port: MessagePort,
  options: {
    handshake?: boolean;
    heartbeat?: boolean;
    command?: (params: Record<string, unknown>) => unknown;
  } = {},
) {
  const received: Record<string, unknown>[] = [];
  const answers = new Map<unknown, Record<string, unknown>>();
  const send = (message: object) =>
    port.postMessage(JSON.stringify({ jsonrpc: "2.0", ...message }));
  port.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as Record<string, unknown>;
    received.push(message);
    if (message.method === undefined) {
      answers.set(message.id, message);
      return;
    }
    if (message.method === "rim.handshake" && options.handshake !== false) {
      send({
        id: message.id,
        result: { accepted: true, protocolVersion: 1, pluginId: "dev.example.scripted" },
      });
    } else if (message.method === "rim.heartbeat" && options.heartbeat !== false) {
      send({ id: message.id, result: {} });
    } else if (message.method === "rim.command.execute") {
      const params = message.params as Record<string, unknown>;
      if (params.commandId === "slow") return;
      try {
        send({
          id: message.id,
          result: options.command ? options.command(params) : { payload: params.args },
        });
      } catch (error) {
        send({ id: message.id, error: { code: -32002, message: (error as Error).message } });
      }
    }
  };
  let nextId = 1;
  return {
    received,
    send,
    raw: (data: unknown) => port.postMessage(data),
    /** Send a request to the host and wait for its answer. */
    async call(method: string, params?: unknown) {
      const id = `p-${nextId++}`;
      send({ id, method, params });
      for (let i = 0; i < 20 && !answers.has(id); i++) await flush(1);
      return answers.get(id) as Record<string, unknown>;
    },
  };
}

async function startScripted(
  options: Parameters<typeof scriptedPlugin>[1] = {},
  plugin: Partial<InstalledWebPlugin> = {},
  manifest = webManifest(),
  chat: ChatHandler | null = null,
) {
  const t = testEnvironment();
  const s = testServices(manifest);
  const host = new WebPluginHost();
  host.configure(t.env, s.services, ["https://api.rim.example/api"], chat);
  host.setPrincipal(PRINCIPAL);
  host.reconcile([installed(plugin)]);
  await flush();
  const frame = t.frames[0];
  frame.load();
  const remote = scriptedPlugin(frame.port, options);
  await flush();
  return { ...t, ...s, host, frame, remote };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// The stores these tests use are sealed under the unlocked account.
beforeEach(() => unlockTestVault());

describe("web plugin frames", () => {
  it("creates the frame, sends the init on the first load, and runs the spec's plugin", async () => {
    const t = testEnvironment();
    const s = testServices(HELLO_WEB_MANIFEST, [file("main.mjs", HELLO_WEB_MAIN)]);
    const host = new WebPluginHost();
    host.configure(t.env, s.services);
    host.setPrincipal(PRINCIPAL);
    host.reconcile([
      installed({
        pluginId: "dev.example.hello-web",
        displayName: "Hello Web",
        commands: [{ id: "greet", dangerous: false }],
      }),
    ]);
    await flush();
    expect(t.frames).toHaveLength(1);
    expect(t.frames[0].title).toBe("Plugin: Hello Web");
    expect(s.starting).toEqual([["dev.example.hello-web", true]]);

    t.frames[0].load();
    const init = t.frames[0].inits[0];
    expect(init.origin).toBe("*");
    expect(init.message).toMatchObject({
      type: "rim.frame.init",
      v: 1,
      kind: "plugin",
      pluginId: "dev.example.hello-web",
      manifest: HELLO_WEB_MANIFEST,
      policy: { origins: [] },
    });
    // The frame shell would run the module with the port; run it here the same way.
    new Function("globalThis", HELLO_WEB_MAIN)({ rimPluginPort: t.frames[0].port });
    await flush();
    expect(host.status("dev.example.hello-web").health).toBe("running");
    expect(s.starting).toEqual([
      ["dev.example.hello-web", true],
      ["dev.example.hello-web", false],
    ]);
    expect(await host.execute({ pluginId: "dev", commandId: "example.hello-web.greet" })).toEqual({
      payload: "Hello, Jakub!",
    });

    host.setPrincipal(null);
    host.setMappings([{ from: PRINCIPAL.principalId, to: "rimp1_x" }]);
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    host.reconcile([]);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(t.frames[0].removed).toBe(true);

    for (const message of t.sent)
      expect(schemaProblems(hostMessageDef(message), message)).toEqual([]);
    expect(t.sent.map((m) => m.method)).toEqual([
      "rim.handshake",
      "rim.command.execute",
      "rim.principal.changed",
      "rim.principals.remapped",
      "rim.settings.changed",
      "rim.heartbeat",
      "rim.shutdown",
    ]);
  });

  it("gives the frame its granted origins, never RIM's own", async () => {
    const manifest = webManifest({
      capabilities: ["ui.notify", "network.fetch"],
      network_origins: ["https://api.github.com"],
    });
    const granted = await startScripted({}, { approvedCapabilities: ["network.fetch"] }, manifest);
    expect(granted.frame.inits[0].message.policy).toEqual({ origins: ["https://api.github.com"] });

    const withheld = await startScripted({}, { approvedCapabilities: [] }, manifest);
    expect(withheld.frame.inits[0].message.policy).toEqual({ origins: [] });

    const t = testEnvironment();
    const own = webManifest({
      capabilities: ["ui.notify", "network.fetch"],
      network_origins: ["https://api.rim.example"],
    });
    const host = new WebPluginHost();
    host.configure(t.env, testServices(own).services, ["https://api.rim.example/api"]);
    host.reconcile([installed({ approvedCapabilities: ["network.fetch"] })]);
    await flush();
    expect(t.frames).toHaveLength(0);
    expect(host.status("dev.example.scripted").error).toContain("RIM's own origin");
  });

  it("stops a plugin that does not answer the handshake within 10 seconds of the init", async () => {
    const t = await startScripted({ handshake: false });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(t.host.status("dev.example.scripted").health).toBe("starting");
    await vi.advanceTimersByTimeAsync(1);
    expect(t.host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: "the plugin did not answer the handshake within 10s",
    });
    expect(t.frame.removed).toBe(true);
    expect(t.starting.at(-1)).toEqual(["dev.example.scripted", false]);
  });

  it("stops a plugin whose entry fails to load, on rim.frame.error from its own window", async () => {
    const t = await startScripted({ handshake: false });
    t.post(
      t.frame,
      { type: "rim.frame.error", v: 1, message: "SyntaxError: x" },
      "https://evil.example",
    );
    expect(t.host.status("dev.example.scripted").health).toBe("starting");
    t.post(t.frame, { type: "rim.frame.error", v: 1, message: "SyntaxError: x" });
    expect(t.host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: "the plugin failed to load: SyntaxError: x",
    });
  });

  it("removes a frame that loads a second time and does not restart it", async () => {
    const t = await startScripted();
    expect(t.host.status("dev.example.scripted").health).toBe("running");
    t.frame.load();
    expect(t.host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: "the plugin navigated its frame",
    });
    expect(t.frame.removed).toBe(true);
    t.host.reconcile([installed()]);
    await flush();
    expect(t.frames).toHaveLength(1);
    // Turned off and on, it starts again.
    t.host.reconcile([installed({ enabled: false })]);
    t.host.reconcile([installed()]);
    await flush();
    expect(t.frames).toHaveLength(2);
  });

  it("drops a message that is not a string and ends the connection past 4 MiB", async () => {
    const t = await startScripted();
    t.remote.raw({ jsonrpc: "2.0", method: "rim.log" });
    t.remote.raw("not json");
    await flush();
    expect(t.logs).toContain("warn: dropped a message that is not a string of JSON");
    expect(t.logs).toContain("warn: dropped a message that is not JSON");
    expect(t.host.status("dev.example.scripted").health).toBe("running");

    t.remote.raw(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "rim.log",
        params: { level: "info", message: "x".repeat(4 * 1024 * 1024) },
      }),
    );
    await flush();
    expect(t.host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: "the plugin sent a message over 4 MiB",
    });
  });

  it("denies calls without their capability and answers unknown ones with METHOD_NOT_FOUND", async () => {
    const t = await startScripted();
    const panel = await t.remote.call("rim.ui.update_panel", { panel_id: "main", state: {} });
    expect(panel.error).toEqual({ code: -32000, message: "capability denied: ui.panel" });
    for (const method of [
      "rim.fs.read_file",
      "rim.process.spawn",
      "rim.network.http_request",
      "rim.chat.list_messages",
      "rim.chat.post_message",
    ]) {
      expect((await t.remote.call(method, {})).error).toMatchObject({ code: -32000 });
    }
    expect((await t.remote.call("rim.kube.config")).error).toEqual({
      code: -32601,
      message: "method not found: rim.kube.config",
    });
    expect((await t.remote.call("rim.log", { level: "info", message: "hi" })).result).toEqual({
      ok: true,
    });
    expect(t.logs).toContain("info: hi");
  });

  it("hands chat calls to the message service with the start-time grants", async () => {
    const calls: unknown[][] = [];
    const chat: ChatHandler = async (...args) => {
      calls.push(args);
      return { messages: [], hasOlder: false };
    };
    const t = await startScripted({}, { approvedCapabilities: ["chat.read"] }, webManifest(), chat);
    expect(
      (await t.remote.call("rim.chat.list_messages", { conversationId: "c-1" })).result,
    ).toEqual({ messages: [], hasOlder: false });
    expect(calls).toEqual([
      ["dev.example.scripted", "rim.chat.list_messages", { conversationId: "c-1" }, ["chat.read"]],
    ]);
    // Posting needs chat.write, which the gate checks before the service.
    expect(
      (await t.remote.call("rim.chat.post_message", { conversationId: "c-1", body: "hi" })).error,
    ).toEqual({ code: -32000, message: "capability denied: chat.write" });
    expect(calls).toHaveLength(1);
  });

  it("refuses chat calls with only an encrypted grant, before the message service", async () => {
    const chat = vi.fn<ChatHandler>(async () => ({}));
    const t = await startScripted(
      {},
      { approvedCapabilities: ["chat.read.encrypted", "chat.write.encrypted"] },
      webManifest(),
      chat,
    );
    for (const method of [
      "rim.chat.list_messages",
      "rim.chat.get_message",
      "rim.chat.search_messages",
      "rim.chat.post_message",
    ]) {
      expect((await t.remote.call(method, {})).error).toMatchObject({ code: -32000 });
    }
    expect(chat).not.toHaveBeenCalled();
  });

  it("relays panel state with ui.panel, for the plugin's own panels only", async () => {
    const t = await startScripted({}, { approvedCapabilities: ["ui.panel"] });
    const changes: unknown[] = [];
    t.host.relay.subscribe((change) => changes.push(change));
    expect(
      (await t.remote.call("rim.ui.update_panel", { panel_id: "main", state: { a: 1 } })).result,
    ).toEqual({
      panel_id: "main",
      state: { a: 1 },
    });
    expect(
      (
        await t.remote.call("rim.ui.update_panel", {
          panel_id: "main",
          state: { b: 2 },
          patch: true,
        })
      ).result,
    ).toEqual({
      panel_id: "main",
      state: { a: 1, b: 2 },
    });
    expect(
      (await t.remote.call("rim.ui.update_panel", { panel_id: "other", state: {} })).error,
    ).toMatchObject({ code: -32000 });
    expect(t.host.relay.getState("dev.example.scripted", "main")).toEqual({ a: 1, b: 2 });
    t.host.reconcile([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(changes.at(-1)).toEqual({
      pluginId: "dev.example.scripted",
      panelId: "main",
      state: null,
    });
  });

  it("limits storage to 120 calls a minute, messages to 600, and stops a plugin past 1,200", async () => {
    const t = await startScripted();
    for (let i = 0; i < 120; i++)
      t.remote.send({ id: i, method: "rim.storage.get", params: { key: "k" } });
    await flush(10);
    expect((await t.remote.call("rim.storage.get", { key: "k" })).error).toEqual({
      code: -32001,
      message: "rate limit exceeded for capability: storage",
    });
    for (let i = 0; i < 480; i++)
      t.remote.send({ method: "rim.log", params: { level: "debug", message: "n" } });
    await flush(10);
    expect(
      (await t.remote.call("rim.log", { level: "info", message: "over" })).error,
    ).toMatchObject({ code: -32001 });
    expect(t.logs.filter((l) => l.startsWith("warn: more than 120 log lines"))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await t.remote.call("rim.storage.get", { key: "k" })).result).toEqual({ value: null });
    for (let i = 0; i < 1_201; i++) t.remote.send({ method: "rim.unknown" });
    await flush(20);
    expect(t.host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: "the plugin flooded the host with messages",
    });
  });

  it("removes a plugin after two missed heartbeats, and sends none while the page is hidden", async () => {
    const t = await startScripted({ heartbeat: false });
    t.state.hidden = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.sent.filter((m) => m.method === "rim.heartbeat")).toHaveLength(0);
    t.state.hidden = false;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(t.host.status("dev.example.scripted").health).toBe("running");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.sent.filter((m) => m.method === "rim.heartbeat")).toHaveLength(2);
    expect(t.host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: "the plugin is not responding",
    });
  });

  it("answers requests for one second after rim.shutdown, then removes the frame", async () => {
    const t = await startScripted();
    t.host.reconcile([installed({ enabled: false })]);
    await flush();
    expect(t.remote.received.at(-1)).toEqual({ jsonrpc: "2.0", method: "rim.shutdown" });
    expect(
      (await t.remote.call("rim.storage.set", { key: "draft", value: "kept" })).result,
    ).toEqual({ ok: true });
    expect(t.store.get("draft")).toBe("kept");
    expect(t.frame.removed).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.frame.removed).toBe(true);
    expect(t.host.status("dev.example.scripted").health).toBe("stopped");
  });

  it("restarts a running plugin when its approved capabilities change", async () => {
    const t = await startScripted();
    t.host.reconcile([installed({ approvedCapabilities: ["ui.panel"] })]);
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(t.frames).toHaveLength(2);
    expect(t.frame.removed).toBe(true);
  });
});

describe("settings", () => {
  it("answers rim.settings.get with the port's own plugin's settings, whatever the params say", async () => {
    const t = await startScripted();
    t.settings.read = async () => ({ namespace: "prod", refresh_seconds: 30 });
    const answer = await t.remote.call("rim.settings.get", { pluginId: "dev.example.other" });
    expect(answer.result).toEqual({ values: { namespace: "prod", refresh_seconds: 30 } });
    expect(schemaProblems("SettingsGetResponse", answer)).toEqual([]);
    expect(t.settings.asked).toEqual(["dev.example.scripted"]);
    expect((await t.remote.call("rim.settings.get")).result).toEqual({
      values: { namespace: "prod", refresh_seconds: 30 },
    });
  });

  it("sends the whole set after a save and after every principal change", async () => {
    const t = await startScripted();
    t.settings.read = async () => ({ namespace: "staging" });
    t.host.settingsChanged("dev.example.scripted");
    t.host.settingsChanged("dev.example.not-running");
    await flush();
    expect(t.remote.received.at(-1)).toEqual({
      jsonrpc: "2.0",
      method: "rim.settings.changed",
      params: { values: { namespace: "staging" } },
    });

    t.settings.read = async () => ({ namespace: "default" });
    t.host.setPrincipal(null);
    await flush();
    expect(t.remote.received.slice(-2).map((m) => m.method)).toEqual([
      "rim.principal.changed",
      "rim.settings.changed",
    ]);
    expect(t.remote.received.at(-1)?.params).toEqual({ values: { namespace: "default" } });
    t.host.setPrincipal(null);
    await flush();
    expect(t.remote.received.filter((m) => m.method === "rim.settings.changed")).toHaveLength(2);
    for (const message of t.sent)
      expect(schemaProblems(hostMessageDef(message), message)).toEqual([]);
  });

  it("says why when a secret cannot be read, and sends no change meanwhile", async () => {
    const t = await startScripted();
    t.settings.read = async () => {
      throw new RpcError(-32603, "the vault is locked", { reason: "secretsLocked" });
    };
    expect((await t.remote.call("rim.settings.get")).error).toEqual({
      code: -32603,
      message: "the vault is locked",
      data: { reason: "secretsLocked" },
    });
    const before = t.remote.received.length;
    t.host.settingsChanged("dev.example.scripted");
    await flush();
    expect(t.remote.received).toHaveLength(before);
    expect(t.logs).toContain("warn: settings not sent: the vault is locked");
  });

  it("reads one set at a time, so no older set reaches the plugin after a newer one", async () => {
    const t = await startScripted();
    const reads: ((values: Record<string, unknown>) => void)[] = [];
    t.settings.read = () => new Promise((resolve) => reads.push(resolve));
    t.host.settingsChanged("dev.example.scripted");
    t.remote.send({ id: "get-1", method: "rim.settings.get" });
    await flush();
    // The second read starts only once the first set was sent.
    expect(reads).toHaveLength(1);
    reads[0]({ v: 1 });
    await flush();
    expect(reads).toHaveLength(2);
    reads[1]({ v: 2 });
    await flush();
    const settings = t.remote.received.filter(
      (m) => m.method === "rim.settings.changed" || m.id === "get-1",
    );
    expect(settings).toEqual([
      { jsonrpc: "2.0", method: "rim.settings.changed", params: { values: { v: 1 } } },
      { jsonrpc: "2.0", id: "get-1", result: { values: { v: 2 } } },
    ]);
  });
});

describe("command gates", () => {
  async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(WebCommandError);
    return error as WebCommandError;
  }

  it("run in the desktop's order and answer like its PluginCommandError", async () => {
    const t = await startScripted({
      command: (p) => {
        if (p.commandId === "echo" && (p.args as { fail?: boolean }).fail)
          throw new Error("it broke");
        return { payload: p, message: "done" };
      },
    });
    const run = (request: Parameters<WebPluginHost["execute"]>[0]) => t.host.execute(request);

    expect(
      (await refusal(run({ pluginId: "dev.example.scripted", commandId: "echo", args: [] }))).kind,
    ).toBe("INVALID_ARGS");
    expect((await refusal(run({ pluginId: "dev.example.scripted", commandId: "nope" }))).kind).toBe(
      "UNKNOWN_COMMAND",
    );
    expect((await refusal(run({ pluginId: "dev.example.missing", commandId: "echo" }))).kind).toBe(
      "PLUGIN_NOT_FOUND",
    );
    expect(
      (
        await refusal(
          run({
            pluginId: "dev.example.scripted",
            commandId: "echo",
            callerPluginId: "dev.example.other",
          }),
        )
      ).message,
    ).toBe("plugin dev.example.other may not run commands of plugin dev.example.scripted");
    expect((await refusal(run({ pluginId: "dev.example.scripted", commandId: "wipe" }))).kind).toBe(
      "CONFIRMATION_REQUIRED",
    );
    expect(
      (
        await refusal(
          run({
            pluginId: "dev.example.scripted",
            commandId: "wipe",
            confirmed: true,
            initiator: "agent",
          }),
        )
      ).kind,
    ).toBe("CONFIRMATION_REQUIRED");
    expect(
      (await refusal(run({ pluginId: "dev.example.scripted", commandId: "secret" }))).kind,
    ).toBe("CAPABILITY_DENIED");

    const confirmed = (await run({
      pluginId: "dev.example.scripted",
      commandId: "wipe",
      confirmed: true,
    })) as {
      payload: Record<string, unknown>;
    };
    expect(confirmed.payload).toMatchObject({
      commandId: "wipe",
      confirmed: true,
      initiator: "user",
      invoker: PRINCIPAL,
    });
    const plain = (await run({
      pluginId: "dev",
      commandId: "example.scripted.echo",
      confirmed: true,
      initiator: "agent",
    })) as {
      payload: Record<string, unknown>;
      message: string;
    };
    expect(plain.payload).toMatchObject({
      commandId: "echo",
      confirmed: false,
      initiator: "agent",
      args: {},
    });
    expect(plain.message).toBe("done");

    const failed = await refusal(
      run({ pluginId: "dev.example.scripted", commandId: "echo", args: { fail: true } }),
    );
    expect(failed.kind).toBe("PLUGIN_ERROR");
    expect(failed.message).toBe("plugin error: it broke");
    expect(failed.data).toEqual({ code: -32002, data: null });

    const slow = refusal(run({ pluginId: "dev.example.scripted", commandId: "slow" }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await slow).kind).toBe("TIMED_OUT");

    t.host.reconcile([installed({ enabled: false })]);
    expect((await refusal(run({ pluginId: "dev.example.scripted", commandId: "echo" }))).kind).toBe(
      "PLUGIN_NOT_RUNNING",
    );
  });
});

describe("safe start", () => {
  it("does not start a plugin whose starting marker the page left behind", async () => {
    const t = testEnvironment();
    const host = new WebPluginHost();
    host.configure(t.env, testServices(webManifest()).services);
    host.reconcile([installed({ starting: true })]);
    await flush();
    expect(t.frames).toHaveLength(0);
    expect(host.status("dev.example.scripted")).toEqual({
      health: "crashed",
      error: SAFE_START_MESSAGE,
    });
    // Its own marker, set while it starts the plugin, does not block it.
    host.reconcile([installed({ enabled: false })]);
    host.reconcile([installed({ starting: false })]);
    await flush();
    host.reconcile([installed({ starting: true })]);
    await flush();
    expect(t.frames).toHaveLength(1);
  });
});

describe("browser plugin storage", () => {
  async function storeWith(account: string | null) {
    const store = new BrowserPluginStore();
    store.setAccount(account);
    return store;
  }

  it("scopes values by plugin and account, and refuses without a sign-in", async () => {
    vi.useRealTimers();
    const a = await storeWith("rimp0_storage-a");
    await a.storageSet("dev.example.one", "repos", ["x/y"]);
    expect(await a.storageGet("dev.example.one", "repos")).toEqual(["x/y"]);
    expect(await a.storageGet("dev.example.two", "repos")).toBeNull();
    expect(
      await (await storeWith("rimp0_storage-b")).storageGet("dev.example.one", "repos"),
    ).toBeNull();
    await a.storageSet("dev.example.one", "repos", null);
    expect(await a.storageGet("dev.example.one", "repos")).toBeNull();
    const nobody = await storeWith(null);
    await expect(nobody.storageGet("dev.example.one", "repos")).rejects.toMatchObject({
      code: -32602,
      message: "nobody is signed in",
    });
    await expect(a.storageSet("dev.example.one", "bad/key", 1)).rejects.toMatchObject({
      code: -32602,
    });
  });

  it("refuses a set past 1 MiB with reason quota", async () => {
    vi.useRealTimers();
    const store = await storeWith("rimp0_storage-quota");
    await store.storageSet("dev.example.one", "a", "x".repeat(1024 * 1024 - 10));
    await expect(store.storageSet("dev.example.one", "b", "0123456789")).rejects.toMatchObject({
      code: -32602,
      data: { reason: "quota" },
    });
    expect(await store.storageGet("dev.example.one", "b")).toBeNull();
  });

  it("installs a bundle for the account, hashes it again at start, and deletes its storage on uninstall", async () => {
    vi.useRealTimers();
    const store = await storeWith("rimp0_storage-install");
    const bytes = writeBundle([
      file("rim-plugin.json", HELLO_WEB_MANIFEST),
      file("main.mjs", HELLO_WEB_MAIN),
    ]);
    const sha256 = "5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85";
    await store.installBundle({
      bytes,
      sha256,
      source: { kind: "link", url: "https://example.com/hello.rimbundle", sha256 },
      replace: false,
    });
    const [listed] = await store.list();
    expect(listed).toMatchObject({
      plugin_id: "dev.example.hello-web",
      enabled: false,
      runtime_kind: "WebSandboxed",
    });
    await expect(
      store.installBundle({
        bytes,
        sha256,
        source: { kind: "link", url: "https://example.com/h", sha256 },
        replace: false,
      }),
    ).rejects.toThrow("already installed");
    expect((await store.loadFiles("dev.example.hello-web")).manifestText).toBe(HELLO_WEB_MANIFEST);
    await store.storageSet("dev.example.hello-web", "k", 1);
    await store.uninstall("dev.example.hello-web");
    expect(await store.list()).toEqual([]);
    expect(await store.storageGet("dev.example.hello-web", "k")).toBeNull();
  });
  it("audits grants, revocations and encrypted reads, and keeps the history through an update", async () => {
    vi.useRealTimers();
    const store = await storeWith("rimp0_storage-audit");
    const manifest = webManifest({
      capabilities: ["chat.read", "chat.read.encrypted", "ui.notify"],
    });
    const bytes = writeBundle([file("rim-plugin.json", manifest), file("main.mjs", "")]);
    const sha256 = await sha256Hex(bytes);
    const source = { kind: "link" as const, url: "https://example.com/s.rimbundle", sha256 };
    await store.installBundle({ bytes, sha256, source, replace: false });
    const id = "dev.example.scripted";

    await store.approveCapabilities(id, ["chat.read", "chat.read.encrypted"]);
    await store.approveCapabilities(id, ["chat.read"]);
    await store.enable(id);
    await store.recordEncryptedReads(id, 3);
    await store.recordEncryptedReads(id, 2);
    await store.revokeCapability(id, "chat.read.encrypted");
    await store.revokeCapability(id, "chat.read.encrypted");

    const [info] = await store.list();
    expect(info.enabled).toBe(false);
    expect(info.approved_capabilities).toEqual(["chat.read"]);
    expect(info.audit?.grants.map((g) => [g.capability, g.action])).toEqual([
      ["chat.read", "granted"],
      ["chat.read.encrypted", "granted"],
      ["chat.read.encrypted", "revoked"],
    ]);
    expect(info.audit?.grants[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Object.values(info.audit?.encrypted_reads ?? {})).toEqual([5]);

    await store.installBundle({ bytes, sha256, source, replace: true, keepApprovals: true });
    const [updated] = await store.list();
    expect(updated.audit).toEqual(info.audit);
    await store.uninstall(id);
  });
  it("keeps network.fetch through an update only while the plugin lists the same sites", async () => {
    vi.useRealTimers();
    const store = await storeWith("rimp0_storage-sites");
    const id = "dev.example.scripted";
    const install = async (origins: string[], replace: boolean) => {
      const manifest = webManifest({
        capabilities: ["ui.notify", "network.fetch"],
        network_origins: origins,
      });
      const bytes = writeBundle([file("rim-plugin.json", manifest), file("main.mjs", "")]);
      const sha256 = await sha256Hex(bytes);
      const source = { kind: "link" as const, url: "https://example.com/n.rimbundle", sha256 };
      await store.installBundle({ bytes, sha256, source, replace, keepApprovals: replace });
      const [info] = await store.list();
      return info.approved_capabilities;
    };

    await install(["https://api.github.com", "https://avatars.githubusercontent.com"], false);
    await store.approveCapabilities(id, ["ui.notify", "network.fetch"]);
    expect(
      await install(["https://avatars.githubusercontent.com", "https://api.github.com"], true),
    ).toEqual(["ui.notify", "network.fetch"]);
    expect(await install(["https://evil.example"], true)).toEqual(["ui.notify"]);
    await store.uninstall(id);
  });
});
