// The frame shell (public/plugin-frame/v1/shell.js) in jsdom: it narrows the
// policy before any plugin byte runs, takes only the parent's first init, and
// renders a panel with its relative URLs pointing at the panel's own files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHELL = readFileSync(
  join(import.meta.dirname, "../../../../public/plugin-frame/v1/shell.js"),
  "utf8",
);
const encoder = new TextEncoder();

interface Harness {
  parent: { postMessage: ReturnType<typeof vi.fn> };
  frameGlobal: Record<string, unknown>;
  windowEvents: string[];
  blobs: { type: string; metaCount: number; blob: Blob }[];
  deliver: (data: unknown, from?: unknown, ports?: unknown[]) => void;
}

/** Run a fresh copy of the shell against jsdom's document, with its own window and globals. */
function startShell(): Harness {
  const listeners: ((event: unknown) => void)[] = [];
  const parent = { postMessage: vi.fn() };
  const windowEvents: string[] = [];
  const frameWindow = {
    parent,
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.push(listener),
    dispatchEvent: (event: Event) => {
      windowEvents.push(event.type);
      return true;
    },
  };
  const frameGlobal: Record<string, unknown> = {};
  const blobs: Harness["blobs"] = [];
  const fakeUrl = {
    createObjectURL: (blob: Blob) => {
      blobs.push({
        type: blob.type,
        metaCount: document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
          .length,
        blob,
      });
      return `blob:test/${blobs.length}`;
    },
  };
  new Function("window", "globalThis", "URL", SHELL)(frameWindow, frameGlobal, fakeUrl);
  return {
    parent,
    frameGlobal,
    windowEvents,
    blobs,
    deliver: (data, from = parent, ports = []) => {
      for (const listener of listeners) listener({ source: from, data, ports });
    },
  };
}

const BASELINE =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'" data-rim-shell="">';

function file(path: string, text: string) {
  return { path, type: "", bytes: encoder.encode(text).buffer };
}

function policyMetas(): string[] {
  return Array.from(
    document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'),
  ).map((m) => m.getAttribute("content") ?? "");
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.head.innerHTML = BASELINE;
  document.body.innerHTML = "";
});

afterEach(() => {
  document.documentElement.removeAttribute("lang");
});

describe("frame shell: plugin frames", () => {
  const manifest = JSON.stringify({ plugin_id: "dev.example.p", entrypoint: "main.mjs" });
  const init = (origins: string[]) => ({
    type: "rim.frame.init",
    v: 1,
    kind: "plugin",
    pluginId: "dev.example.p",
    manifest,
    policy: { origins },
    files: [file("main.mjs", "export {};")],
  });

  it("appends the plugin's policy before it imports the entry, then reports a failed import", async () => {
    const shell = startShell();
    const port = { postMessage: vi.fn() };
    shell.deliver(init(["https://api.github.com", "wss://stream.example.com:8443"]), shell.parent, [
      port,
    ]);
    expect(policyMetas()).toEqual([
      "default-src 'none'",
      "connect-src https://api.github.com wss://stream.example.com:8443; img-src 'self' blob: data: https://api.github.com wss://stream.example.com:8443",
    ]);
    // The entry's blob URL was made only after the policy was in place.
    expect(shell.blobs).toMatchObject([{ type: "text/javascript", metaCount: 2 }]);
    expect(shell.frameGlobal.rimPluginPort).toBe(port);
    expect(shell.frameGlobal.rimPluginManifest).toBe(manifest);
    const descriptor = Object.getOwnPropertyDescriptor(shell.frameGlobal, "rimPluginPort");
    expect(descriptor).toMatchObject({ writable: false, configurable: false });
    await settle();
    // jsdom cannot import a blob: URL, which stands in for an entry that throws.
    expect(shell.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rim.frame.error", v: 1 }),
      "*",
    );
  });

  it("closes the network without network.fetch", () => {
    const shell = startShell();
    shell.deliver(init([]), shell.parent, [{ postMessage: vi.fn() }]);
    expect(policyMetas()[1]).toBe("connect-src 'none'; img-src 'self' blob: data:");
  });

  it("ignores messages not from its parent and every init after the first", () => {
    const shell = startShell();
    shell.deliver(init(["https://evil.example"]), { postMessage: vi.fn() }, [{}]);
    expect(policyMetas()).toHaveLength(1);
    expect(shell.frameGlobal.rimPluginPort).toBeUndefined();
    const port = { postMessage: vi.fn() };
    shell.deliver(init([]), shell.parent, [port]);
    shell.deliver(init(["https://evil.example"]), shell.parent, [{}]);
    expect(policyMetas()).toHaveLength(2);
    expect(shell.frameGlobal.rimPluginPort).toBe(port);
  });

  it("refuses an origin that is not https:// or wss://", () => {
    const shell = startShell();
    shell.deliver(init(["http://api.example.com"]), shell.parent, [{}]);
    expect(shell.frameGlobal.rimPluginPort).toBeUndefined();
    expect(shell.parent.postMessage).toHaveBeenCalledWith(
      { type: "rim.frame.error", v: 1, message: "the host sent an invalid origin" },
      "*",
    );
  });
});

describe("frame shell: panel frames", () => {
  const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="refresh" content="0; url=https://evil.example">
    <base href="https://evil.example/">
    <link rel="stylesheet" href="style.css">
    <script src="./lib/first.js"></script>
  </head>
  <body class="panel">
    <img src="img/logo.png"><img src="https://avatars.githubusercontent.com/u/1"><img src="missing.png">
    <script>window.order = (window.order || []).concat("inline");</script>
    <script src="app.js?v=2"></script>
    <script type="application/json" id="data">{"a":1}</script>
  </body>
</html>`;

  const panelInit = {
    type: "rim.frame.init",
    v: 1,
    kind: "panel",
    pluginId: "dev.example.p",
    panelId: "main",
    policy: { origins: ["https://avatars.githubusercontent.com"] },
    files: [
      file("index.html", INDEX),
      file("style.css", "body{}"),
      file("lib/first.js", "1"),
      file("app.js", "2"),
      file("img/logo.png", "png"),
    ],
  };

  it("rewrites relative URLs to the panel's files, runs scripts in order, then fires the load events", async () => {
    const shell = startShell();
    const contentLoaded = vi.fn();
    document.addEventListener("DOMContentLoaded", contentLoaded);
    shell.deliver(panelInit);

    expect(policyMetas()[1]).toContain(
      "img-src 'self' blob: data: https://avatars.githubusercontent.com",
    );
    expect(document.querySelector("meta[http-equiv=refresh]")).toBeNull();
    expect(document.querySelector("base")).toBeNull();
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.body.className).toBe("panel");
    expect(document.querySelector("link")?.getAttribute("href")).toMatch(/^blob:test\//);

    const images = Array.from(document.querySelectorAll("img")).map((img) =>
      img.getAttribute("src"),
    );
    expect(images[0]).toMatch(/^blob:test\//);
    expect(images[1]).toBe("https://avatars.githubusercontent.com/u/1");
    expect(images[2]).toBeNull();

    const scripts = Array.from(document.querySelectorAll("script:not([data-rim-shell])")).filter(
      (s) => s.getAttribute("type") !== "application/json",
    ) as HTMLScriptElement[];
    expect(scripts).toHaveLength(3);
    expect(
      scripts.every((s) => s.async === false && /^blob:test\//.test(s.getAttribute("src") ?? "")),
    ).toBe(true);
    // In document order: first.js (head), the inline script, then app.js.
    const sources = await Promise.all(
      scripts.map((s) =>
        shell.blobs[Number((s.getAttribute("src") ?? "").split("/")[1]) - 1].blob.text(),
      ),
    );
    expect(sources).toEqual(["1", 'window.order = (window.order || []).concat("inline");', "2"]);
    expect(document.getElementById("data")?.textContent).toBe('{"a":1}');

    expect(contentLoaded).not.toHaveBeenCalled();
    for (const script of scripts) script.dispatchEvent(new Event("load"));
    expect(contentLoaded).toHaveBeenCalledTimes(1);
    expect(shell.windowEvents).toEqual(["load"]);
    expect(shell.parent.postMessage).toHaveBeenCalledWith({ type: "rim.frame.ready", v: 1 }, "*");
    document.removeEventListener("DOMContentLoaded", contentLoaded);
  });

  it("reports a panel without index.html", () => {
    const shell = startShell();
    shell.deliver({ ...panelInit, files: [file("app.js", "1")] });
    expect(shell.parent.postMessage).toHaveBeenCalledWith(
      { type: "rim.frame.error", v: 1, message: "the panel has no index.html" },
      "*",
    );
  });
});
