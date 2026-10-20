import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ tauri: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => platform.tauri,
}));

const invokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import vectors from "../../../../protocol/pow-vectors.json";
import { getApiOrigin } from "../../../core/graphql/config";
import relayVectors from "../../../../protocol/relay-vectors.json";
import { setDirectTransport, type DirectTransport } from "../direct/directTransport";
import { resetServerOrigin } from "../state/serverOrigin";
import { answerPowJob, type PowJob } from "./powSearch";
import { PowCancelled, readRegistration, solveProofOfWork } from "./proofOfWork";

/** A worker that runs the search in this thread, as the real one runs it in its own. */
class InlineWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: PowJob[] = [];
  constructor(private readonly answer: boolean) {}
  postMessage(job: PowJob) {
    this.posted.push(job);
    if (!this.answer) return;
    queueMicrotask(() => {
      if (!this.terminated) this.onmessage?.({ data: answerPowJob(job) } as MessageEvent);
    });
  }
  terminate() {
    this.terminated = true;
  }
}

function workerFactory(answer = true) {
  const made: InlineWorker[] = [];
  const make = () => {
    const worker = new InlineWorker(answer);
    made.push(worker);
    return worker as unknown as Worker;
  };
  return { make, made };
}

afterEach(() => {
  platform.tauri = false;
  invokeMock.mockReset();
  setDirectTransport(null);
  resetServerOrigin();
});

describe("solveProofOfWork in the web app", () => {
  // The desktop's search finds these same nonces (`src-tauri/src/relay/pow.rs`).
  it.each(vectors.cases.filter((c) => c.bits > 0).map((c) => [c.description, c] as const))(
    "finds the shared vector: %s",
    async (_, c) => {
      const { make, made } = workerFactory();
      const nonce = await solveProofOfWork(
        { serverId: c.serverId, inceptionPayload: c.inceptionPayload, bits: c.bits },
        undefined,
        make,
      );
      expect(nonce).toBe(c.nonce);
      expect(made[0].terminated).toBe(true);
    },
  );

  it("stops the worker when the signal aborts", async () => {
    const { make, made } = workerFactory(false);
    const stop = new AbortController();
    const search = solveProofOfWork(
      { serverId: "s", inceptionPayload: "{}", bits: 40 },
      stop.signal,
      make,
    );
    stop.abort();
    await expect(search).rejects.toBeInstanceOf(PowCancelled);
    expect(made[0].terminated).toBe(true);
  });

  it("starts nothing when already aborted", async () => {
    const { make, made } = workerFactory();
    await expect(
      solveProofOfWork(
        { serverId: "s", inceptionPayload: "{}", bits: 8 },
        AbortSignal.abort(),
        make,
      ),
    ).rejects.toBeInstanceOf(PowCancelled);
    expect(made).toHaveLength(0);
  });

  it("refuses a difficulty it does not compute", async () => {
    const { make } = workerFactory();
    await expect(
      solveProofOfWork({ serverId: "s", inceptionPayload: "{}", bits: 41 }, undefined, make),
    ).rejects.toThrow(/41 bits/);
  });
});

describe("solveProofOfWork on the desktop", () => {
  it("runs the Tauri search and cancels it by its job id", async () => {
    platform.tauri = true;
    let release: (value: unknown) => void = () => undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "relay_solve_pow") {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      if (command === "relay_cancel_pow") release({ ok: true, value: null });
      return Promise.resolve({ ok: true, value: null });
    });
    const stop = new AbortController();
    const job = { serverId: "rims1_relay", inceptionPayload: "{}", bits: 24 };
    const search = solveProofOfWork(job, stop.signal);
    stop.abort();
    await expect(search).rejects.toBeInstanceOf(PowCancelled);
    const [solve, cancel] = invokeMock.mock.calls;
    expect(solve).toEqual(["relay_solve_pow", { jobId: expect.any(String), ...job }]);
    expect(cancel).toEqual(["relay_cancel_pow", { jobId: solve[1].jobId }]);
  });

  it("answers the nonce the Tauri side found", async () => {
    platform.tauri = true;
    invokeMock.mockResolvedValue({ ok: true, value: "AAAAAAAAkaM" });
    await expect(
      solveProofOfWork({ serverId: "rims1_relay", inceptionPayload: "{}", bits: 16 }),
    ).resolves.toBe("AAAAAAAAkaM");
  });
});

describe("readRegistration", () => {
  it("reads the server's id and difficulty from its own verified discovery document", async () => {
    const document = JSON.stringify({
      rim: "server-discovery",
      keyLog: [relayVectors.relay.inception],
      descriptor: vectors.powDescriptor,
    });
    const transport = { discovery: vi.fn().mockResolvedValue(document) };
    setDirectTransport(transport as unknown as DirectTransport);

    await expect(readRegistration()).resolves.toEqual({
      serverId: relayVectors.relay.serverId,
      mode: "pow",
      powBits: 16,
    });
    expect(transport.discovery).toHaveBeenCalledWith(getApiOrigin());
  });

  it("fails when the document cannot be fetched", async () => {
    setDirectTransport({
      discovery: async () => {
        throw new Error("the discovery document answered 502");
      },
    } as unknown as DirectTransport);
    await expect(readRegistration()).rejects.toThrow(/502/);
  });
});
