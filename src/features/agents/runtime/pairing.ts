/**
 * Pairing: a program on this computer asks to connect, the person compares a code and approves or
 * refuses, and the program collects a token once. At most one request exists at a time.
 *
 * The steps that decide the state run without an `await` between reading and changing it, so
 * concurrent calls cannot both pass a check: two polls cannot both collect the token, and two
 * requests cannot both start.
 */

import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { randomToken, sha256Base64Url, sixDigitCode, type RandomFill } from "./agentCrypto";

const LIFETIME_S = 120;
const LIFETIME_MS = LIFETIME_S * 1000;
/** How long after a request ended as refused or expired a new one is turned away. */
const RETRY_WAIT_MS = 10_000;
const SECRET_BYTES = 32;
const TOKEN_PREFIX = "rimagent_";
const NAME_LIMIT = 64;

/** What the dialog shows for the request waiting for the person. */
export interface PendingView {
  requestId: string;
  name: string;
  code: string;
  /** When the request expires, on the clock of `now`. */
  expiresAt: number;
}

/** An HTTP status and the JSON body that goes with it. */
export interface PairAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** What pairing needs from the outside. */
export interface PairingDeps {
  now: () => number;
  random: RandomFill;
  /** Adds an agent to the store, once it has collected its token. */
  connect: (agent: ConnectedAgent) => void;
  /** Says what the dialog shows, `null` for nothing. */
  onPendingChanged: (view: PendingView | null) => void;
  setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

/** A running pairing. */
export interface Pairing {
  /** Starts a request for the program calling itself `rawName`. */
  request: (rawName: unknown) => Promise<PairAnswer>;
  /** Says how the request named in `body` stands, and hands over the token once, connecting the agent. */
  poll: (body: unknown) => Promise<PairAnswer>;
  /** Mints the token, for the program to collect. */
  approve: (requestId: string) => Promise<void>;
  refuse: (requestId: string) => void;
  /** Forgets everything, including a token not collected, and tells the UI. */
  reset: () => void;
  pending: () => PendingView | null;
}

type Phase = "pending" | "approving" | "approved" | "refused" | "expired";

interface PairRequest {
  view: PendingView;
  /** The SHA-256 of the poll secret. The secret itself is not kept. */
  secretHash: Promise<string>;
  phase: Phase;
  /** When this phase expires. */
  deadline: number;
  /** The plain token and its agent, only between approval and the poll that collects it. */
  approved: { token: string; agent: ConnectedAgent } | null;
}

const BAD_NAME: PairAnswer = { status: 400, body: { error: "bad_name" } };
const IN_PROGRESS: PairAnswer = { status: 409, body: { error: "pairing_in_progress" } };
const TRY_LATER: PairAnswer = { status: 429, body: { error: "try_later" } };
const UNKNOWN_REQUEST: PairAnswer = { status: 404, body: { error: "unknown_request" } };

function statusAnswer(status: string, extra: Record<string, unknown> = {}): PairAnswer {
  return { status: 200, body: { status, ...extra } };
}

/**
 * Cleans the name a program claims for itself: removes control and format characters, which
 * include the bidirectional marks, collapses whitespace, trims and cuts to 64 characters.
 *
 * @returns The name, or `null` when it is not a string or nothing is left.
 */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/gu, " ").replace(/\p{C}/gu, "").replace(/\s+/gu, " ").trim();
  const name = Array.from(collapsed).slice(0, NAME_LIMIT).join("").trim();
  return name === "" ? null : name;
}

/**
 * Creates a pairing.
 *
 * @param deps - The clock, the randomness, the store and the UI it works with.
 * @returns The running pairing.
 */
export function createPairing(deps: PairingDeps): Pairing {
  const { now, random, connect, onPendingChanged } = deps;
  let current: PairRequest | null = null;
  let retryAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stopTimer() {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  }

  function arm() {
    stopTimer();
    if (!current || current.phase === "expired") return;
    timer = deps.setTimeout(
      () => {
        timer = null;
        settle();
        arm();
      },
      Math.max(0, current.deadline - now()),
    );
  }

  /** Moves a request past its deadline to expired. A refused one has already started its wait. */
  function settle() {
    const request = current;
    if (!request || request.phase === "expired" || now() < request.deadline) return;
    const { phase, deadline } = request;
    request.phase = "expired";
    request.approved = null;
    if (phase !== "refused") retryAt = deadline + RETRY_WAIT_MS;
    if (phase === "pending") onPendingChanged(null);
  }

  function forget() {
    current = null;
    stopTimer();
  }

  return {
    async request(rawName) {
      const name = cleanName(rawName);
      if (name === null) return BAD_NAME;
      settle();
      // A person's refusal blocks only for the wait: the program may be gone and never poll it.
      if (current && current.phase !== "expired" && current.phase !== "refused") return IN_PROGRESS;
      if (now() < retryAt) return TRY_LATER;
      const pollSecret = randomToken(SECRET_BYTES, random);
      const view: PendingView = {
        requestId: randomToken(SECRET_BYTES, random),
        name,
        code: sixDigitCode(random),
        expiresAt: now() + LIFETIME_MS,
      };
      current = {
        view,
        secretHash: sha256Base64Url(pollSecret),
        phase: "pending",
        deadline: view.expiresAt,
        approved: null,
      };
      arm();
      onPendingChanged(view);
      return {
        status: 200,
        body: {
          requestId: view.requestId,
          pollSecret,
          code: view.code,
          expiresIn: LIFETIME_S,
        },
      };
    },

    async poll(body) {
      const { requestId, pollSecret } = (typeof body === "object" && body !== null ? body : {}) as {
        requestId?: unknown;
        pollSecret?: unknown;
      };
      const given = await sha256Base64Url(typeof pollSecret === "string" ? pollSecret : "");
      const request = current;
      if (!request || request.view.requestId !== requestId) return UNKNOWN_REQUEST;
      if ((await request.secretHash) !== given || current !== request) return UNKNOWN_REQUEST;
      settle();
      switch (request.phase) {
        case "pending":
        case "approving":
          return statusAnswer("pending");
        case "refused":
          forget();
          return statusAnswer("refused");
        case "expired":
          forget();
          return statusAnswer("expired");
        case "approved": {
          const { token, agent } = request.approved!;
          connect(agent);
          forget();
          return statusAnswer("approved", { token });
        }
      }
    },

    async approve(requestId) {
      settle();
      const request = current;
      if (!request || request.view.requestId !== requestId || request.phase !== "pending") return;
      request.phase = "approving";
      onPendingChanged(null);
      const token = TOKEN_PREFIX + randomToken(SECRET_BYTES, random);
      const tokenHash = await sha256Base64Url(token);
      if (current !== request || request.phase !== "approving") return;
      request.phase = "approved";
      request.approved = {
        token,
        agent: {
          id: crypto.randomUUID(),
          name: request.view.name,
          tokenHash,
          pairedAt: new Date(now()).toISOString(),
        },
      };
      request.deadline = now() + LIFETIME_MS;
      arm();
    },

    refuse(requestId) {
      settle();
      const request = current;
      if (!request || request.view.requestId !== requestId || request.phase !== "pending") return;
      request.phase = "refused";
      retryAt = now() + RETRY_WAIT_MS;
      onPendingChanged(null);
    },

    reset() {
      forget();
      retryAt = 0;
      onPendingChanged(null);
    },

    pending() {
      settle();
      return current?.phase === "pending" ? current.view : null;
    },
  };
}
