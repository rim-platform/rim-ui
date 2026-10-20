import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const platform = vi.hoisted(() => ({ tauri: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => platform.tauri,
}));

const invokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import powVectors from "../../../../protocol/pow-vectors.json";
import vectors from "../../../../protocol/relay-vectors.json";
import { getApiOrigin, getGraphqlEndpoint } from "../../../core/graphql/config";
import { keyFromSeed } from "../../../test/ed25519";
import { sign } from "../../key-identity/browser/statements";
import { RELAY_CONTEXT, verifyDiscovery } from "../crypto/serverStatements";
import { setDirectTransport, type DirectTransport } from "../direct/directTransport";
import {
  declaredOrigin,
  readOwnDiscovery,
  resetServerOrigin,
  serverEndpoint,
  serverOrigin,
  useServerHost,
  useServerOrigin,
} from "./serverOrigin";

/** The page's server in tests: `VITE_GRAPHQL_ENDPOINT` is unset. */
const PAGE = "http://localhost:8080";
/** The pow vector's descriptor declares its endpoints here. */
const RELAY = "https://relay.example";

function discovery(descriptor: { payload: string; signature: string }): string {
  return JSON.stringify({
    rim: "server-discovery",
    keyLog: [vectors.relay.inception],
    descriptor,
  });
}

/** The pow vector's descriptor with `from` replaced by `to`, signed again by the relay's key. */
async function resigned(...edits: [string, string][]) {
  const key = await keyFromSeed(vectors.relay.seed);
  let payload = powVectors.powDescriptor.payload;
  for (const [from, to] of edits) payload = payload.split(from).join(to);
  return sign(key.privateKey, RELAY_CONTEXT.descriptor, payload);
}

/** Serve `document` (or throw `document`) as the page's server's discovery document. */
function serve(document: string | Error) {
  const discovery = vi.fn(async () => {
    if (document instanceof Error) throw document;
    return document;
  });
  setDirectTransport({ discovery } as unknown as DirectTransport);
  return discovery;
}

/** The desktop: the Tauri side's discovery check runs the browser's here. */
function onDesktop() {
  platform.tauri = true;
  invokeMock.mockImplementation(async (command: string, args: Record<string, string>) => {
    if (command !== "relay_verify_discovery") return { ok: true, value: null };
    try {
      return { ok: true, value: await verifyDiscovery(args.document, args.origin) };
    } catch (err) {
      return { ok: false, error: { kind: "backend_error", message: (err as Error).message } };
    }
  });
}

afterEach(() => {
  platform.tauri = false;
  invokeMock.mockReset();
  setDirectTransport(null);
  resetServerOrigin();
});

describe("declaredOrigin", () => {
  it("reads the base URL of the descriptor's server-to-server endpoint", async () => {
    expect(declaredOrigin(discovery(powVectors.powDescriptor))).toBe(RELAY);
    const nested = await resigned([`${RELAY}/s2s/v1`, `${RELAY}/rim/s2s/v1`]);
    expect(declaredOrigin(discovery(nested))).toBe(`${RELAY}/rim`);
  });

  it("declares nothing without an endpoint of the expected shape", async () => {
    const off = await resigned([`"${RELAY}/s2s/v1"`, "null"]);
    expect(declaredOrigin(discovery(off))).toBeNull();
    const elsewhere = await resigned([`${RELAY}/s2s/v1`, `${RELAY}/peers`]);
    expect(declaredOrigin(discovery(elsewhere))).toBeNull();
    const ftp = await resigned([`${RELAY}/s2s/v1`, "ftp://relay.example/s2s/v1"]);
    expect(declaredOrigin(discovery(ftp))).toBeNull();
    expect(declaredOrigin("not json")).toBeNull();
    expect(declaredOrigin(JSON.stringify({ descriptor: { payload: "{" } }))).toBeNull();
  });
});

describe("the web app's server origin", () => {
  it("is the page's origin when the server declares its endpoints there", async () => {
    const here = await resigned([RELAY, PAGE], ["wss://relay.example", "ws://localhost:8080"]);
    const fetched = serve(discovery(here));
    await expect(serverOrigin()).resolves.toBe(PAGE);
    expect(fetched).toHaveBeenCalledWith(getApiOrigin());
  });

  it("is the origin the server declares when the web app is served elsewhere", async () => {
    const fetched = serve(discovery(powVectors.powDescriptor));
    const own = await readOwnDiscovery();
    expect(own.origin).toBe(RELAY);
    expect(own.verified.head.serverId).toBe(vectors.relay.serverId);
    // Fetched from the page's own server, never from the origin it declares.
    expect(fetched).toHaveBeenCalledWith(PAGE);
    expect(fetched).not.toHaveBeenCalledWith(RELAY);
    await expect(serverOrigin()).resolves.toBe(RELAY);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("is the page's origin when server-to-server traffic is off", async () => {
    serve(discovery(await resigned([`"${RELAY}/s2s/v1"`, "null"])));
    await expect(serverOrigin()).resolves.toBe(PAGE);
  });

  it("refuses a declared origin the server did not sign", async () => {
    const forged = {
      ...powVectors.powDescriptor,
      payload: powVectors.powDescriptor.payload.split(RELAY).join("https://evil.example"),
    };
    serve(discovery(forged));
    await expect(serverOrigin()).rejects.toThrow(/signature/);
  });

  it("fails when the discovery document cannot be read, and reads it again on the next ask", async () => {
    serve(new Error("the discovery document answered 502"));
    await expect(serverOrigin()).rejects.toThrow(/502/);

    serve(discovery(powVectors.powDescriptor));
    await expect(serverOrigin()).resolves.toBe(RELAY);
  });

  it("asks once for callers that ask together", async () => {
    const fetched = serve(discovery(powVectors.powDescriptor));
    const [a, b] = await Promise.all([serverOrigin(), serverOrigin()]);
    expect([a, b]).toEqual([RELAY, RELAY]);
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});

describe("serverEndpoint", () => {
  it("is the configured endpoint when the server is known by the page's origin", async () => {
    serve(discovery(await resigned([RELAY, PAGE], ["wss://relay.example", "ws://localhost:8080"])));
    await expect(serverEndpoint()).resolves.toBe(getGraphqlEndpoint());
  });

  it("is the declared origin's /api when the server is known by another origin", async () => {
    serve(discovery(powVectors.powDescriptor));
    await expect(serverEndpoint()).resolves.toBe(`${RELAY}/api`);
  });

  it("is the configured endpoint on the desktop", async () => {
    onDesktop();
    serve(discovery(powVectors.powDescriptor));
    await expect(serverEndpoint()).resolves.toBe(getGraphqlEndpoint());
  });
});

describe("useServerOrigin", () => {
  it("reads the origin on first use and answers it", async () => {
    serve(discovery(powVectors.powDescriptor));
    const { result } = renderHook(() => ({ view: useServerOrigin(), host: useServerHost() }));
    expect(result.current.view).toEqual({ origin: null, failed: false });
    expect(result.current.host).toBe("localhost:8080");
    await waitFor(() => expect(result.current.view.origin).toBe(RELAY));
    expect(result.current.host).toBe("relay.example");
  });

  it("says when the origin cannot be read, and keeps the page's host for display", async () => {
    serve(new Error("offline"));
    const { result } = renderHook(() => ({ view: useServerOrigin(), host: useServerHost() }));
    await waitFor(() => expect(result.current.view).toEqual({ origin: null, failed: true }));
    expect(result.current.host).toBe("localhost:8080");

    serve(discovery(powVectors.powDescriptor));
    await act(async () => {
      await serverOrigin();
    });
    expect(result.current.view).toEqual({ origin: RELAY, failed: false });
  });
});

describe("the desktop app's server origin", () => {
  it("is the configured server, without a fetch", async () => {
    onDesktop();
    const fetched = serve(discovery(powVectors.powDescriptor));
    await expect(serverOrigin()).resolves.toBe(getApiOrigin());
    const { result } = renderHook(() => useServerOrigin());
    expect(result.current).toEqual({ origin: getApiOrigin(), failed: false });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("verifies its server's document against the configured server only", async () => {
    onDesktop();
    serve(discovery(powVectors.powDescriptor));
    await expect(readOwnDiscovery()).rejects.toThrow(/another origin/);
    const here = await resigned([RELAY, PAGE], ["wss://relay.example", "ws://localhost:8080"]);
    serve(discovery(here));
    await expect(readOwnDiscovery()).resolves.toMatchObject({ origin: PAGE });
  });
});
