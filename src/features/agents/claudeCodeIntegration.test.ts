// @vitest-environment node
/**
 * Runs the Claude Code plugin's `pair.sh` against a fake bridge on an ephemeral port and a fake
 * `claude` on `PATH`. Every run goes through one helper that checks the output is a single line
 * and holds none of the secrets the fake bridge hands out.
 */
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const PLUGIN = join(ROOT, "integrations/claude-code");
const SCRIPT = join(PLUGIN, "scripts/pair.sh");

const REQUEST_ID = "req_AbCdEf0123456789_secretid";
const POLL_SECRET = "poll_AbCdEf0123456789_secretpoll";
const TOKEN = `rimagent_${"A1b2C3d4E5".repeat(4)}xyz`;
const SECRETS = [REQUEST_ID, POLL_SECRET, TOKEN];

const FAKE_CLAUDE = `#!/bin/sh
echo "$*" >> "$FAKE_CLAUDE_LOG"
echo "fake claude: $*"
echo "fake claude: $*" >&2
case "$1 $2" in
  "mcp get") exit "\${FAKE_CLAUDE_GET_EXIT:-1}" ;;
  "mcp remove") exit "\${FAKE_CLAUDE_REMOVE_EXIT:-0}" ;;
  "mcp add") exit "\${FAKE_CLAUDE_ADD_EXIT:-0}" ;;
esac
exit 0
`;

interface Reply {
  status: number;
  body?: Record<string, unknown>;
}
type Handler = (path: string, body: string) => Reply;

interface Result {
  stdout: string;
  stderr: string;
  code: number;
}

let dir: string;
let runtime: string;
let calls: string;
let server: Server;
let baseUrl: string;
let handler: Handler;
let requests: { path: string; body: string }[];

const paired: Reply = {
  status: 200,
  body: { requestId: REQUEST_ID, pollSecret: POLL_SECRET, code: "482917", expiresIn: 120 },
};
const approved: Reply = { status: 200, body: { status: "approved", token: TOKEN } };
const pending: Reply = { status: 200, body: { status: "pending" } };

function byPath(pair: Reply, poll: Reply): Handler {
  return (path) => (path === "/pair" ? pair : poll);
}

const stateFile = () => join(runtime, "rim-claude-code/pairing");
const claudeCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);

/** Runs `pair.sh` and checks that its output is one line without any secret. */
function run(args: string[], env: Record<string, string> = {}): Promise<Result> {
  const clean = { ...process.env };
  for (const name of [
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) {
    delete clean[name];
  }
  return new Promise((done) => {
    execFile(
      SCRIPT,
      args,
      {
        cwd: dir,
        env: {
          ...clean,
          PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
          HOME: join(dir, "home"),
          XDG_RUNTIME_DIR: runtime,
          RIM_BRIDGE_URL: baseUrl,
          FAKE_CLAUDE_LOG: calls,
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        for (const secret of SECRETS) {
          expect(stdout).not.toContain(secret);
          expect(stderr).not.toContain(secret);
        }
        expect(stdout).not.toContain("fake claude");
        expect(stderr).toBe("");
        expect(stdout.endsWith("\n") && stdout.trim().split("\n").length === 1).toBe(true);
        done({ stdout: stdout.trim(), stderr, code });
      },
    );
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rim-cc-"));
  runtime = join(dir, "run");
  calls = join(dir, "claude-calls");
  mkdirSync(runtime, { mode: 0o700 });
  mkdirSync(join(dir, "home"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/claude"), FAKE_CLAUDE, { mode: 0o755 });
  requests = [];
  handler = byPath(paired, approved);
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", body });
      const reply = handler(req.url ?? "", body);
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("pair.sh", () => {
  it("pairs, adds RIM to Claude Code with the full token and removes its state", async () => {
    const start = await run(["start"]);
    expect(start).toMatchObject({ stdout: "CODE: 482 917", code: 0 });
    expect(requests[0]).toEqual({ path: "/pair", body: '{"name":"Claude Code"}' });

    const wait = await run(["wait"]);
    expect(wait.stdout).toBe(
      "CONNECTED: RIM is set up. Restart Claude Code or run /mcp to use it.",
    );
    expect(requests[1].path).toBe("/pair/poll");
    expect(JSON.parse(requests[1].body)).toEqual({
      requestId: REQUEST_ID,
      pollSecret: POLL_SECRET,
    });
    expect(claudeCalls()).toEqual([
      "mcp get rim",
      `mcp add --transport http --scope user rim ${baseUrl}/mcp --header Authorization: Bearer ${TOKEN}`,
    ]);
    expect(existsSync(stateFile())).toBe(false);
  });

  it("keeps the state private while pairing is in progress", async () => {
    await run(["start"]);
    expect(statSync(stateFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(runtime, "rim-claude-code")).mode & 0o777).toBe(0o700);
    await run(["wait"]);
    expect(existsSync(stateFile())).toBe(false);
  });

  it("leaves no temporary files behind", async () => {
    await run(["start"]);
    await run(["wait"]);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(runtime)).toEqual(["rim-claude-code"]);
  });

  it("refuses an address that is not on this computer, and contacts nothing", async () => {
    const result = await run(["start"], { RIM_BRIDGE_URL: "http://example.invalid:47821" });
    expect(result.stdout).toBe("FAILED: RIM is only reached on this computer.");
    expect(result.code).toBe(1);
  });

  describe("start", () => {
    const rows: [number, string][] = [
      [423, "LOCKED: RIM is locked. Unlock it in the desktop app, then try again."],
      [409, "IN_PROGRESS: RIM is already asking about another connection. Answer that first."],
      [429, "TRY_LATER: Wait ten seconds, then try again."],
      [403, "REFUSED_BY_BRIDGE: Something changed this request on its way to RIM."],
    ];
    for (const [status, line] of rows) {
      it(`answers ${status}`, async () => {
        handler = () => ({ status, body: { error: "x" } });
        expect(await run(["start"])).toMatchObject({ stdout: line, code: 0 });
        expect(existsSync(stateFile())).toBe(false);
      });
    }

    it("fails on an answer it does not know", async () => {
      handler = () => ({ status: 500 });
      expect(await run(["start"])).toMatchObject({
        stdout: "FAILED: RIM gave an answer this script doesn't understand.",
        code: 1,
      });
    });

    it("says RIM is not listening when the connection is refused", async () => {
      const closed = createServer();
      await new Promise<void>((ok) => closed.listen(0, "127.0.0.1", ok));
      const port = (closed.address() as AddressInfo).port;
      await new Promise((ok) => closed.close(ok));
      const result = await run(["start"], { RIM_BRIDGE_URL: `http://127.0.0.1:${port}` });
      expect(result).toMatchObject({
        stdout:
          "NOT_LISTENING: RIM isn't listening. Open the desktop app, then turn on Settings > Agents > Let agents on this computer connect.",
        code: 0,
      });
    });

    it("stops when RIM is already set up, unless asked to replace it", async () => {
      const env = { FAKE_CLAUDE_GET_EXIT: "0" };
      const first = await run(["start"], env);
      expect(first.stdout).toBe(
        "ALREADY_CONNECTED: RIM is already set up in Claude Code, though it may have stopped working if it was disconnected in RIM.",
      );
      expect(requests).toEqual([]);
      expect((await run(["start", "--replace"], env)).stdout).toBe("CODE: 482 917");
      expect(claudeCalls()).toEqual(["mcp get rim"]);
    });
  });

  describe("wait", () => {
    it("says to start first when there is no state", async () => {
      expect((await run(["wait"])).stdout).toBe("NOT_STARTED: Run start first.");
    });

    const rows: [string, Reply, string][] = [
      [
        "refused",
        { status: 200, body: { status: "refused" } },
        "REFUSED: You chose not to connect. Nothing was changed.",
      ],
      [
        "expired",
        { status: 200, body: { status: "expired" } },
        "EXPIRED: The request ran out. Nothing was changed.",
      ],
      [
        "unknown request",
        { status: 404, body: { error: "unknown_request" } },
        "EXPIRED: The request ran out. Nothing was changed.",
      ],
      [
        "locked",
        { status: 423, body: { error: "locked" } },
        "LOCKED_OR_CLOSED: RIM closed or locked before this finished. Nothing was changed.",
      ],
    ];
    for (const [name, reply, line] of rows) {
      it(`ends on ${name}`, async () => {
        handler = byPath(paired, reply);
        await run(["start"]);
        expect(await run(["wait"])).toMatchObject({ stdout: line, code: 0 });
        expect(existsSync(stateFile())).toBe(false);
        expect(claudeCalls()).toEqual(["mcp get rim"]);
      });
    }

    it("ends when RIM is closed", async () => {
      await run(["start"]);
      await new Promise((ok) => server.close(ok));
      server = createServer();
      const result = await run(["wait"]);
      expect(result.stdout).toBe(
        "LOCKED_OR_CLOSED: RIM closed or locked before this finished. Nothing was changed.",
      );
      expect(existsSync(stateFile())).toBe(false);
    });

    it("fails on an answer it does not know", async () => {
      handler = byPath(paired, { status: 200, body: { status: "weird" } });
      await run(["start"]);
      expect(await run(["wait"])).toMatchObject({
        stdout: "FAILED: RIM gave an answer this script doesn't understand.",
        code: 1,
      });
      expect(existsSync(stateFile())).toBe(false);
    });

    it("keeps the state while pending, and a second wait finishes", async () => {
      handler = byPath(paired, pending);
      await run(["start"]);
      const first = await run(["wait"], { RIM_PAIR_WAIT_SECONDS: "0" });
      expect(first.stdout).toBe("PENDING: Still waiting for you to answer in RIM.");
      expect(statSync(stateFile()).mode & 0o777).toBe(0o600);
      handler = byPath(paired, approved);
      expect((await run(["wait"])).stdout).toMatch(/^CONNECTED:/);
      expect(existsSync(stateFile())).toBe(false);
    });

    it("polls again while pending", async () => {
      let polls = 0;
      handler = (path) => (path === "/pair" ? paired : ++polls < 2 ? pending : approved);
      await run(["start"]);
      const result = await run(["wait"], { RIM_PAIR_WAIT_SECONDS: "10" });
      expect(result.stdout).toMatch(/^CONNECTED:/);
      expect(polls).toBe(2);
    });

    it("removes the old entry first when start was given --replace", async () => {
      const env = { FAKE_CLAUDE_GET_EXIT: "0" };
      await run(["start", "--replace"], env);
      expect((await run(["wait"], env)).stdout).toBe(
        "CONNECTED: RIM is set up. Restart Claude Code or run /mcp to use it. The connection it replaced still works until you press Disconnect on the older entry in RIM's Settings > Agents.",
      );
      expect(claudeCalls()).toEqual([
        "mcp remove --scope user rim",
        `mcp add --transport http --scope user rim ${baseUrl}/mcp --header Authorization: Bearer ${TOKEN}`,
      ]);
    });

    it("says so when Claude Code could not save the entry", async () => {
      await run(["start"]);
      const result = await run(["wait"], { FAKE_CLAUDE_ADD_EXIT: "1" });
      expect(result).toMatchObject({
        stdout:
          "COULD_NOT_ADD: RIM approved this, but Claude Code could not save it. Press Disconnect in RIM's Settings > Agents, then try again.",
        code: 1,
      });
      expect(existsSync(stateFile())).toBe(false);
    });
  });

  describe("values that fail their pattern", () => {
    const failed = {
      stdout: "FAILED: RIM gave an answer this script doesn't understand.",
      code: 1,
    };

    it("rejects a token with shell syntax", async () => {
      handler = byPath(paired, {
        status: 200,
        body: { status: "approved", token: "rimagent_$(touch x)" },
      });
      await run(["start"]);
      expect(await run(["wait"])).toMatchObject(failed);
      expect(existsSync(join(dir, "x"))).toBe(false);
      expect(claudeCalls()).toEqual(["mcp get rim"]);
      expect(existsSync(stateFile())).toBe(false);
    });

    it("rejects a token of the wrong length", async () => {
      handler = byPath(paired, { status: 200, body: { status: "approved", token: `${TOKEN}A` } });
      await run(["start"]);
      expect(await run(["wait"])).toMatchObject(failed);
      expect(claudeCalls()).toEqual(["mcp get rim"]);
    });

    it("rejects a request id with a quote", async () => {
      handler = byPath({ status: 200, body: { ...paired.body, requestId: 'a"b' } }, approved);
      expect(await run(["start"])).toMatchObject(failed);
      expect(existsSync(stateFile())).toBe(false);
    });

    it("rejects a request id with shell syntax", async () => {
      handler = byPath(
        { status: 200, body: { ...paired.body, requestId: "a$(touch x)" } },
        approved,
      );
      expect(await run(["start"])).toMatchObject(failed);
      expect(existsSync(join(dir, "x"))).toBe(false);
    });

    it("rejects a code of seven digits", async () => {
      handler = byPath({ status: 200, body: { ...paired.body, code: "1234567" } }, approved);
      expect(await run(["start"])).toMatchObject(failed);
      expect(existsSync(stateFile())).toBe(false);
    });
  });

  describe("status", () => {
    it("says RIM is set up, dropping what Claude Code prints, which holds the token", async () => {
      const result = await run(["status"], { FAKE_CLAUDE_GET_EXIT: "0" });
      expect(result.stdout).toBe(
        "SET_UP: RIM is set up in Claude Code. Run /mcp to see whether it can connect.",
      );
    });

    it("says when it is not", async () => {
      const result = await run(["status"], { FAKE_CLAUDE_GET_EXIT: "1" });
      expect(result.stdout).toBe("NOT_SET_UP: RIM isn't set up in Claude Code.");
    });
  });

  describe("disconnect", () => {
    it("removes the entry", async () => {
      const result = await run(["disconnect"]);
      expect(result.stdout).toBe(
        "REMOVED: RIM is removed from Claude Code. Press Disconnect in RIM's Settings > Agents to end its access.",
      );
      expect(claudeCalls()).toEqual(["mcp remove --scope user rim"]);
    });

    it("says when nothing was set up", async () => {
      const result = await run(["disconnect"], { FAKE_CLAUDE_REMOVE_EXIT: "1" });
      expect(result.stdout).toBe("NOT_SET_UP: RIM isn't set up in Claude Code.");
    });
  });

  it("does not use a configured proxy", async () => {
    let contacted = false;
    const proxy = createServer((_req, res) => {
      contacted = true;
      res.writeHead(500).end();
    });
    await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const env = { http_proxy: url, all_proxy: url, HTTP_PROXY: url, ALL_PROXY: url };
      expect((await run(["start"], env)).stdout).toBe("CODE: 482 917");
      expect((await run(["wait"], env)).stdout).toMatch(/^CONNECTED:/);
      expect(contacted).toBe(false);
    } finally {
      await new Promise((ok) => proxy.close(ok));
    }
  });
});

describe("plugin files", () => {
  const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

  it("has a marketplace whose plugin source exists", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");
    expect(marketplace.name).toBe("rim-platform");
    const entry = marketplace.plugins[0];
    expect(entry.name).toBe("rim");
    expect(existsSync(join(ROOT, entry.source, ".claude-plugin/plugin.json"))).toBe(true);
  });

  it("has a plugin manifest that matches the marketplace entry", () => {
    const manifest = readJson("integrations/claude-code/.claude-plugin/plugin.json");
    const entry = readJson(".claude-plugin/marketplace.json").plugins[0];
    expect(manifest).toMatchObject({
      name: "rim",
      description: entry.description,
      license: "Apache-2.0",
    });
  });

  it("has an executable script and a skill that points at it", () => {
    if (process.platform !== "win32") expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
    const skill = readFileSync(join(PLUGIN, "skills/connect-rim/SKILL.md"), "utf8");
    expect(skill).toContain("name: connect-rim");
    expect(skill).toContain("allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/pair.sh *)");
  });

  it("never traces the script", () => {
    expect(readFileSync(SCRIPT, "utf8")).not.toMatch(/set -\w*x|\bset -o xtrace/);
  });
});
