// The GitHub REST API calls of the plugin: open pull requests of a public
// repository, without a token, and what GitHub's refusals mean for a person.

/** One open pull request, as the panel shows it. */
export interface Pull {
  number: number;
  title: string;
  url: string;
  author: string;
  /** Only ever an avatars.githubusercontent.com URL, the one image origin the plugin lists. */
  avatarUrl: string | null;
  createdAt: string;
  draft: boolean;
}

/** GitHub said no; `rateLimitedUntil` is set when the hourly limit is used up. */
export class GitHubError extends Error {
  readonly rateLimitedUntil: number | null;

  constructor(message: string, rateLimitedUntil: number | null = null) {
    super(message);
    this.name = "GitHubError";
    this.rateLimitedUntil = rateLimitedUntil;
  }
}

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const AVATARS = "https://avatars.githubusercontent.com/";

/** `owner/name` trimmed, or null when it is not a repository name. */
export function normalizeRepo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const repo = value
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\/+$/, "");
  return REPO.test(repo) && !repo.endsWith(".git") ? repo : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The pull requests in a `GET /repos/{owner}/{repo}/pulls` answer. */
export function parsePulls(body: unknown): Pull[] {
  if (!Array.isArray(body))
    throw new GitHubError("GitHub sent something other than a list of pull requests.");
  return body.filter(isRecord).map((pull) => {
    const user = isRecord(pull.user) ? pull.user : {};
    const avatar =
      typeof user.avatar_url === "string" && user.avatar_url.startsWith(AVATARS)
        ? user.avatar_url
        : null;
    return {
      number: typeof pull.number === "number" ? pull.number : 0,
      title: typeof pull.title === "string" ? pull.title : "(untitled)",
      url: typeof pull.html_url === "string" ? pull.html_url : "",
      author: typeof user.login === "string" ? user.login : "unknown",
      avatarUrl: avatar,
      createdAt: typeof pull.created_at === "string" ? pull.created_at : "",
      draft: pull.draft === true,
    };
  });
}

function clock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Fetch the open pull requests of `repo`. */
export async function fetchPulls(repo: string, fetchImpl: typeof fetch): Promise<Pull[]> {
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${repo}/pulls?state=open&per_page=30`,
      {
        headers: { Accept: "application/vnd.github+json" },
      },
    );
  } catch {
    throw new GitHubError("GitHub could not be reached.");
  }
  if (response.ok) return parsePulls(await response.json());
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (
    (response.status === 403 || response.status === 429) &&
    (remaining === "0" || response.status === 429)
  ) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const until = Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60 * 60 * 1000;
    throw new GitHubError(
      `GitHub refused: the 60 requests an hour it allows without a token are used up. Try again after ${clock(until)}.`,
      until,
    );
  }
  if (response.status === 404) throw new GitHubError(`${repo} was not found, or it is private.`);
  throw new GitHubError(`GitHub answered ${response.status} for ${repo}.`);
}
