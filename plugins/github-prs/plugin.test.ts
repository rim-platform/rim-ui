// Tests the pull request plugin over a MessageChannel, as its frame runs, with
// a pretend GitHub and the host's store: no RIM app and no network needed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startTestHost, validateManifest } from "@rim-platform/plugin-sdk/testing";

import { createPlugin, MAX_REPOS, PANEL_ID, REFRESH_FLOOR_MS, type PanelState } from "./plugin.ts";

const MANIFEST = `${import.meta.dirname}/rim-plugin.json`;
const T0 = Date.parse("2026-10-09T12:00:00Z");

interface FakeGitHub {
  fetch: typeof fetch;
  requests: string[];
  /** Answer the next requests with GitHub's hourly-limit refusal. */
  limit: () => void;
}

function fakeGitHub(): FakeGitHub {
  const requests: string[] = [];
  let limited = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    expect(init?.headers).toEqual({ Accept: "application/vnd.github+json" });
    if (limited) {
      return new Response("{}", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String((T0 + 3_600_000) / 1000),
        },
      });
    }
    const repo = /repos\/([^/]+\/[^/]+)\/pulls/.exec(url)?.[1] ?? "";
    if (repo === "acme/private") return new Response("{}", { status: 404 });
    return Response.json([
      {
        number: 7,
        title: `Fix ${repo}`,
        html_url: `https://github.com/${repo}/pull/7`,
        created_at: "2026-10-09T10:00:00Z",
        draft: repo.endsWith("-draft"),
        user: { login: "ada", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
      },
      {
        number: 8,
        title: "Sneaky",
        user: { login: "eve", avatar_url: "https://evil.example/x.png" },
      },
    ]);
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    requests,
    limit: () => {
      limited = true;
    },
  };
}

function start(stored: unknown = null, principal?: null) {
  const github = fakeGitHub();
  const clock = { now: T0 };
  const store = new Map<string, unknown>([["repos", stored]]);
  const panels: PanelState[] = [];
  const host = startTestHost(createPlugin({ fetch: github.fetch, now: () => clock.now }), {
    transport: "port",
    manifestPath: MANIFEST,
    grantedCapabilities: ["ui.panel", "network.fetch"],
    ...(principal === null ? { principal: null } : {}),
    onRequest(method, params) {
      const p = params as { key: string; value?: unknown; panel_id: string; state: PanelState };
      if (method === "rim.storage.get") return { value: store.get(p.key) ?? null };
      if (method === "rim.storage.set") {
        store.set(p.key, p.value);
        return { ok: true };
      }
      if (method === "rim.ui.update_panel" && p.panel_id === PANEL_ID) panels.push(p.state);
      return { ok: true };
    },
  });
  return { host, github, clock, store, panels, panel: () => panels.at(-1) as PanelState };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((done) => setTimeout(done, 5));
  expect(check()).toBe(true);
}

describe("github-prs plugin", () => {
  it("has a manifest the host installs once bundled", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    expect(() =>
      validateManifest(
        { ...manifest, entrypoint: "main.mjs" },
        { forbiddenOrigins: ["https://rim.example"] },
      ),
    ).not.toThrow();
  });

  it("loads the saved repositories and lists their open pull requests on start", async () => {
    const t = start(["rust-lang/rust", "acme/private"]);
    expect((await t.host.handshake()).accepted).toBe(true);
    await until(() => t.panels.some((p) => !p.loading && p.fetchedAt !== null));
    const state = t.panel();
    expect(state.repos.map((r) => [r.repo, r.pulls.length, r.error])).toEqual([
      ["rust-lang/rust", 2, null],
      ["acme/private", 0, "acme/private was not found, or it is private."],
    ]);
    expect(state.repos[0].pulls[0]).toEqual({
      number: 7,
      title: "Fix rust-lang/rust",
      url: "https://github.com/rust-lang/rust/pull/7",
      author: "ada",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      createdAt: "2026-10-09T10:00:00Z",
      draft: false,
    });
    // An avatar from anywhere but the listed image origin is dropped.
    expect(state.repos[0].pulls[1].avatarUrl).toBeNull();
    expect(t.github.requests).toEqual([
      "https://api.github.com/repos/rust-lang/rust/pulls?state=open&per_page=30",
      "https://api.github.com/repos/acme/private/pulls?state=open&per_page=30",
    ]);
    await t.host.shutdown();
  });

  it("refreshes at most every 2 minutes", async () => {
    const t = start(["rust-lang/rust"]);
    await t.host.handshake();
    await until(() => t.github.requests.length === 1 && !t.panel()?.loading);
    const early = await t.host.execute("refresh");
    expect(early.result?.message).toBe(
      "Fetched less than 2 minutes ago. GitHub allows 60 requests an hour without a token.",
    );
    expect(t.github.requests).toHaveLength(1);
    t.clock.now += REFRESH_FLOOR_MS;
    expect((await t.host.execute("refresh")).result?.message).toBe(
      "2 open pull requests in 1 repository",
    );
    expect(t.github.requests).toHaveLength(2);
    await t.host.shutdown();
  });

  it("says when GitHub refuses and stops asking until the limit resets", async () => {
    const t = start(["rust-lang/rust", "tokio-rs/tokio"]);
    t.github.limit();
    await t.host.handshake();
    await until(() => t.panel()?.notice !== null && t.panel()?.notice !== undefined);
    expect(t.panel().notice).toMatch(
      /^GitHub refused: the 60 requests an hour it allows without a token are used up\./,
    );
    expect(t.github.requests).toHaveLength(1);
    t.clock.now += REFRESH_FLOOR_MS;
    expect((await t.host.execute("refresh")).result?.message).toMatch(/^GitHub refused/);
    expect(t.github.requests).toHaveLength(1);
    await t.host.shutdown();
  });

  it("adds and removes repositories, keeps them in the store, and holds at most 10", async () => {
    const t = start();
    await t.host.handshake();
    const added = await t.host.execute("add_repo", { repo: "https://github.com/rust-lang/rust/" });
    expect(added.result?.message).toBe("Added rust-lang/rust");
    expect(t.store.get("repos")).toEqual(["rust-lang/rust"]);
    expect(t.panel().repos[0].pulls).toHaveLength(2);
    expect((await t.host.execute("add_repo", { repo: "rust-lang/rust" })).result?.message).toBe(
      "rust-lang/rust is already in the list",
    );
    expect((await t.host.execute("add_repo", { repo: "not a repo" })).error).toMatchObject({
      code: -32602,
    });

    for (let i = 1; i < MAX_REPOS; i++)
      await t.host.execute("add_repo", { repo: `acme/repo-${i}` });
    expect(t.store.get("repos")).toHaveLength(MAX_REPOS);
    expect((await t.host.execute("add_repo", { repo: "acme/one-too-many" })).error?.message).toBe(
      "The list holds at most 10 repositories; remove one first.",
    );

    expect((await t.host.execute("remove_repo", { repo: "RUST-LANG/rust" })).result?.message).toBe(
      "Removed RUST-LANG/rust",
    );
    expect(t.store.get("repos")).not.toContain("rust-lang/rust");
    await t.host.shutdown();
  });

  it("keeps no list while nobody is signed in", async () => {
    const t = start(["rust-lang/rust"], null);
    await t.host.handshake();
    await until(() => t.panels.length > 0);
    expect(t.panel()).toMatchObject({ signedIn: false, repos: [] });
    expect((await t.host.execute("add_repo", { repo: "rust-lang/rust" })).error?.message).toBe(
      "Sign in to keep a list of repositories.",
    );
    expect(t.github.requests).toHaveLength(0);
    await t.host.shutdown();
  });
});
