/**
 * The proof-of-work a relay in `pow` registration mode asks of a key-only signup, on this
 * platform: on every core on the Tauri side (`relay_solve_pow`), in a dedicated worker in the
 * web app. Both find the smallest counter, so they send the same nonce. A search stops when its
 * signal aborts.
 */

import { isTauri } from "@tauri-apps/api/core";

import { keyCommand } from "../../key-identity/api/keyBackend";
import { relayCrypto } from "../crypto/relayCrypto";
import type { ServerRegistration } from "../crypto/serverStatements";
import { directTransport } from "../direct/directTransport";
import type { PowAnswer, PowJob } from "./powSearch";

export type { PowJob } from "./powSearch";

/** A search the person cancelled. */
export class PowCancelled extends Error {
  constructor() {
    super("The proof-of-work was cancelled.");
    this.name = "PowCancelled";
  }
}

/** A server's id and how it takes new accounts, from its verified discovery document. */
export interface RelayRegistration extends ServerRegistration {
  serverId: string;
}

/** Fetch and verify the discovery document at `origin` and read its registration. */
export async function readRegistration(origin: string): Promise<RelayRegistration> {
  const document = await directTransport().discovery(origin);
  const verified = await relayCrypto().verifyDiscovery(document, origin);
  return { serverId: verified.head.serverId, ...verified.descriptor.registration };
}

async function solveOnDesktop(job: PowJob, signal?: AbortSignal): Promise<string> {
  const jobId = crypto.randomUUID();
  const cancel = () => void keyCommand<null>("relay_cancel_pow", { jobId }).catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const nonce = await keyCommand<string | null>("relay_solve_pow", { jobId, ...job });
    if (nonce === null || signal?.aborted) throw new PowCancelled();
    return nonce;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** Makes the web app's search worker. */
export type PowWorkerFactory = () => Worker;

const defaultWorker: PowWorkerFactory = () =>
  new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });

function solveInWorker(
  job: PowJob,
  signal: AbortSignal | undefined,
  makeWorker: PowWorkerFactory,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = makeWorker();
    const end = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      end();
      reject(new PowCancelled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<PowAnswer>) => {
      end();
      if ("nonce" in event.data) resolve(event.data.nonce);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      end();
      reject(new Error(event.message || "the proof-of-work worker failed"));
    };
    worker.postMessage(job);
  });
}

/**
 * Find the proof-of-work nonce (unpadded base64url) for `job`. Rejects with `PowCancelled`
 * when `signal` aborts.
 */
export async function solveProofOfWork(
  job: PowJob,
  signal?: AbortSignal,
  makeWorker: PowWorkerFactory = defaultWorker,
): Promise<string> {
  if (signal?.aborted) throw new PowCancelled();
  return isTauri() ? solveOnDesktop(job, signal) : solveInWorker(job, signal, makeWorker);
}
