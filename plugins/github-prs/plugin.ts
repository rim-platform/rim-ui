// The GitHub Pull Requests plugin: a WebSandboxed plugin that keeps up to 10
// public repositories in the host's store and shows their open pull requests
// in its panel. It talks only to api.github.com, without a token, so it
// refreshes at most every 2 minutes and says when GitHub refuses.

import {
  definePlugin,
  ErrorCode,
  HostRequestError,
  PluginError,
  type Host,
} from "@rim-platform/plugin-sdk";

import { fetchPulls, GitHubError, normalizeRepo, type Pull } from "./github.ts";

export const PLUGIN_ID = "chat.rim.github-prs";
export const PANEL_ID = "prs";
export const MAX_REPOS = 10;
/** The shortest time between two fetches of the list, to stay under GitHub's hourly limit. */
export const REFRESH_FLOOR_MS = 2 * 60 * 1000;
/** How often the plugin refreshes on its own while it runs. */
export const AUTO_REFRESH_MS = 5 * 60 * 1000;
const STORAGE_KEY = "repos";

/** One repository in the panel. */
export interface RepoState {
  repo: string;
  pulls: Pull[];
  error: string | null;
}

/** What the panel shows; the plugin publishes it whole with `rim.ui.update_panel`. */
export interface PanelState {
  repos: RepoState[];
  maxRepos: number;
  fetchedAt: string | null;
  loading: boolean;
  /** A line for the person: GitHub refused, or the list was fetched a moment ago. */
  notice: string | null;
  signedIn: boolean;
}

export interface PluginOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

/** A fresh plugin. Tests pass a fake `fetch` and clock. */
export function createPlugin(options: PluginOptions = {}) {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  let repos: RepoState[] = [];
  let signedIn = false;
  let fetchedAt: number | null = null;
  let rateLimitedUntil = 0;
  let loading = false;
  let notice: string | null = null;
  let panelDenied = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // Commands wait for the saved list, so one that arrives right after the
  // handshake or a sign-in does not race with loading it.
  let loaded: Promise<void> = Promise.resolve();

  const state = (): PanelState => ({
    repos,
    maxRepos: MAX_REPOS,
    fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
    loading,
    notice,
    signedIn,
  });

  async function publish(host: Host): Promise<void> {
    if (panelDenied) return;
    try {
      await host.panels.set(PANEL_ID, state());
    } catch (error) {
      if (error instanceof HostRequestError && error.code === ErrorCode.CAPABILITY_DENIED) {
        panelDenied = true;
        host.log.warn("the panel needs the ui.panel permission");
        return;
      }
      host.log.warn(`could not update the panel: ${(error as Error).message}`);
    }
  }

  /** The signed-in user's repositories from the host's store; none when nobody is signed in. */
  async function load(host: Host): Promise<void> {
    signedIn = host.principal !== null;
    fetchedAt = null;
    notice = null;
    if (!signedIn) {
      repos = [];
      return;
    }
    try {
      const stored = await host.storage.get(STORAGE_KEY);
      const names = Array.isArray(stored)
        ? stored.map(normalizeRepo).filter((r): r is string => r !== null)
        : [];
      repos = names.slice(0, MAX_REPOS).map((repo) => ({ repo, pulls: [], error: null }));
    } catch (error) {
      repos = [];
      host.log.warn(`could not read the saved repositories: ${(error as Error).message}`);
    }
  }

  async function save(host: Host): Promise<void> {
    await host.storage.set(
      STORAGE_KEY,
      repos.map((r) => r.repo),
    );
  }

  /** Fetch `targets`, stopping at the first refusal of the hourly limit. */
  async function fetchRepos(host: Host, targets: RepoState[]): Promise<void> {
    if (now() < rateLimitedUntil) return;
    loading = true;
    await publish(host);
    for (const target of targets) {
      try {
        target.pulls = await fetchPulls(target.repo, fetchImpl);
        target.error = null;
      } catch (error) {
        const refusal = error instanceof GitHubError ? error : new GitHubError(String(error));
        if (refusal.rateLimitedUntil !== null) {
          rateLimitedUntil = refusal.rateLimitedUntil;
          notice = refusal.message;
          break;
        }
        target.error = refusal.message;
      }
    }
    loading = false;
  }

  /** Fetch every repository, unless the list was fetched under 2 minutes ago or GitHub said wait. */
  async function refresh(host: Host): Promise<string> {
    if (repos.length === 0) {
      await publish(host);
      return "No repositories yet: add one in the panel.";
    }
    if (now() < rateLimitedUntil) {
      await publish(host);
      return notice ?? "GitHub refused; try again later.";
    }
    if (fetchedAt !== null && now() - fetchedAt < REFRESH_FLOOR_MS) {
      notice =
        "Fetched less than 2 minutes ago. GitHub allows 60 requests an hour without a token.";
      await publish(host);
      return notice;
    }
    notice = null;
    fetchedAt = now();
    await fetchRepos(host, repos);
    await publish(host);
    const open = repos.reduce((sum, r) => sum + r.pulls.length, 0);
    return (
      notice ??
      `${open} open pull request${open === 1 ? "" : "s"} in ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`
    );
  }

  function repoArgument(args: Readonly<Record<string, unknown>>): string {
    const repo = normalizeRepo(args.repo);
    if (!repo) {
      throw new PluginError("repo must be a repository as owner/name, such as rust-lang/rust", {
        code: ErrorCode.INVALID_PARAMS,
      });
    }
    return repo;
  }

  function requireSignIn(): void {
    if (!signedIn) throw new PluginError("Sign in to keep a list of repositories.");
  }

  return definePlugin({
    id: PLUGIN_ID,
    commands: {
      refresh: {
        async run({ host }) {
          await loaded;
          const message = await refresh(host);
          return { payload: state(), message };
        },
      },
      add_repo: {
        async run({ host, args }) {
          await loaded;
          requireSignIn();
          const repo = repoArgument(args);
          if (repos.some((r) => r.repo.toLowerCase() === repo.toLowerCase())) {
            return { payload: state(), message: `${repo} is already in the list` };
          }
          if (repos.length >= MAX_REPOS) {
            throw new PluginError(
              `The list holds at most ${MAX_REPOS} repositories; remove one first.`,
            );
          }
          const added: RepoState = { repo, pulls: [], error: null };
          repos = [...repos, added];
          await save(host);
          await fetchRepos(host, [added]);
          await publish(host);
          return { payload: state(), message: added.error ?? notice ?? `Added ${repo}` };
        },
      },
      remove_repo: {
        async run({ host, args }) {
          await loaded;
          requireSignIn();
          const repo = repoArgument(args);
          repos = repos.filter((r) => r.repo.toLowerCase() !== repo.toLowerCase());
          await save(host);
          await publish(host);
          return { payload: state(), message: `Removed ${repo}` };
        },
      },
    },
    async onReady(host) {
      loaded = load(host);
      await loaded;
      await refresh(host);
      timer = setInterval(() => void refresh(host), AUTO_REFRESH_MS);
    },
    async onPrincipalChanged(_principal, host) {
      loaded = load(host);
      await loaded;
      await refresh(host);
    },
    onShutdown() {
      if (timer !== null) clearInterval(timer);
    },
  });
}
