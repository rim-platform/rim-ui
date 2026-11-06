import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    events.listeners.set(name, handler);
    return Promise.resolve(events.unlisten);
  }),
}));

import { lockVault } from "../../../core/accountVault/accountVault";
import { readSealedItem } from "../../../core/accountVault/sealedStorage";
import { logger } from "../../../core/logger";
import { unlockTestVault } from "../../../test/accountVault";
import { AGENT_BRIDGE_REQUEST_EVENT } from "../api/agentBridge";
import { AgentPairDialogHost } from "../components/AgentPairDialogHost";
import { AgentsSettings } from "../components/AgentsSettings";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { sha256Base64Url } from "./agentCrypto";
import { useAgentBridge } from "./useAgentBridge";

const TITLE = "Connect this program to RIM?";

let listening: boolean | Error;
let nextId: number;

function Harness() {
  useAgentBridge();
  return <AgentPairDialogHost />;
}

function commandCalls(command: string) {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

function commandOrder() {
  return invoke.mock.calls.map(([name]) => name as string);
}

/** Hands the page a request, and gives its id. */
async function deliver(path: string, body: unknown, authorization: string | null = null) {
  const id = nextId++;
  await act(async () => {
    events.listeners.get(AGENT_BRIDGE_REQUEST_EVENT)?.({
      payload: { id, path, authorization, body: JSON.stringify(body) },
    });
    await Promise.resolve();
  });
  return id;
}

/** Waits for the page's answer to request `id`. */
async function answerTo(id: number): Promise<{ status: number; body: Record<string, string> }> {
  let answer: { status: number; body: string } | undefined;
  await waitFor(() => {
    answer = commandCalls("agent_bridge_answer").find((args) => args.id === id);
    expect(answer).toBeDefined();
  });
  return { status: answer!.status, body: JSON.parse(answer!.body) as Record<string, string> };
}

async function asked(path: string, body: unknown, authorization: string | null = null) {
  return answerTo(await deliver(path, body, authorization));
}

/** Polls until the person's choice has taken effect. */
async function collected(ids: { requestId: string; pollSecret: string }) {
  for (;;) {
    const answer = await asked("/pair/poll", ids);
    if (answer.body.status !== "pending") return answer;
  }
}

async function renderBridge() {
  const view = render(<Harness />);
  await waitFor(() => expect(events.listeners.has(AGENT_BRIDGE_REQUEST_EVENT)).toBe(true));
  return view;
}

describe("useAgentBridge", () => {
  beforeEach(async () => {
    listening = true;
    nextId = 1;
    events.listeners.clear();
    events.unlisten.mockReset();
    invoke.mockImplementation((command: string, args?: { enabled?: boolean }) => {
      if (command === "agent_bridge_set_enabled") {
        const enabled = args?.enabled ?? false;
        return Promise.resolve({ enabled, listening: enabled, error: null, port: 47821 });
      }
      if (command !== "agent_bridge_status") return Promise.resolve(null);
      if (listening instanceof Error) return Promise.reject(listening);
      return Promise.resolve({ enabled: listening, listening, error: null, port: 47821 });
    });
    await unlockTestVault();
    useConnectedAgentsStore.setState({ agents: [] });
  });

  afterEach(() => {
    invoke.mockReset();
    lockVault();
    vi.restoreAllMocks();
  });

  it("takes the request, checks the bridge still listens, then answers", async () => {
    await renderBridge();
    const { status } = await asked("/pair", { name: "Claude Code" });
    expect(status).toBe(200);
    expect(commandOrder().filter((name) => name.startsWith("agent_bridge_"))).toEqual([
      "agent_bridge_ack",
      "agent_bridge_status",
      "agent_bridge_answer",
    ]);
    expect(commandCalls("agent_bridge_ack")).toEqual([{ id: 1 }]);
  });

  it("shows the dialog and brings the window forward for a pending request", async () => {
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    const dialog = await screen.findByRole("dialog", { name: TITLE });
    expect(dialog).toHaveTextContent("“Claude Code”");
    expect(dialog).toHaveTextContent(`${body.code.slice(0, 3)} ${body.code.slice(3)}`);
    expect(commandCalls("desktop_show_window")).toHaveLength(1);
  });

  it("brings the window forward only for a new request", async () => {
    await renderBridge();
    await asked("/pair", { name: "Claude Code" });
    expect((await asked("/pair", { name: "Other" })).status).toBe(409);
    expect((await asked("/pair/poll", {})).status).toBe(404);
    expect(commandCalls("desktop_show_window")).toHaveLength(1);
  });

  it("does not bring the window forward while locked", async () => {
    await renderBridge();
    lockVault();
    expect((await asked("/pair", { name: "Claude Code" })).status).toBe(423);
    expect(commandCalls("desktop_show_window")).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows no dialog and answers nothing once the bridge stopped listening", async () => {
    listening = false;
    await renderBridge();
    await deliver("/pair", { name: "Claude Code" });
    await waitFor(() => expect(commandCalls("agent_bridge_status")).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(commandCalls("agent_bridge_ack")).toHaveLength(1);
    expect(commandCalls("agent_bridge_answer")).toEqual([]);
    expect(commandCalls("desktop_show_window")).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("counts a failed status read as not listening", async () => {
    listening = new Error("no status");
    await renderBridge();
    await deliver("/pair", { name: "Claude Code" });
    await waitFor(() => expect(commandCalls("agent_bridge_status")).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(commandCalls("agent_bridge_answer")).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("goes no further when the request cannot be taken", async () => {
    await renderBridge();
    invoke.mockImplementation(() => Promise.reject(new Error("no bridge")));
    await deliver("/pair", { name: "Claude Code" });
    await waitFor(() => expect(commandCalls("agent_bridge_ack")).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(commandCalls("agent_bridge_status")).toEqual([]);
    expect(commandCalls("agent_bridge_answer")).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pairs from request to token, and a revoked token stops working", async () => {
    const user = userEvent.setup();
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    const ids = { requestId: body.requestId, pollSecret: body.pollSecret };
    expect((await asked("/pair/poll", ids)).body).toEqual({ status: "pending" });

    await user.click(await screen.findByRole("button", { name: "The code matches, connect" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);

    const answer = await collected(ids);
    expect(answer.body.status).toBe("approved");
    expect(useConnectedAgentsStore.getState().agents).toHaveLength(1);
    const authorization = `Bearer ${answer.body.token}`;
    expect((await asked("/pair/poll", ids)).status).toBe(404);
    expect((await asked("/mcp", {}, authorization)).status).toBe(501);
    expect((await asked("/mcp", {}, null)).status).toBe(401);

    const [agent] = useConnectedAgentsStore.getState().agents;
    expect(agent.name).toBe("Claude Code");
    expect(JSON.stringify(agent)).not.toContain(answer.body.token);
    act(() => useConnectedAgentsStore.getState().revoke(agent.id));
    expect((await asked("/mcp", {}, authorization)).status).toBe(401);
  });

  it("refuses from the dialog", async () => {
    const user = userEvent.setup();
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    await user.click(await screen.findByRole("button", { name: "Don't connect" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      (await asked("/pair/poll", { requestId: body.requestId, pollSecret: body.pollSecret })).body,
    ).toEqual({ status: "refused" });
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
  });

  it("closes the dialog and forgets the request when the account locks", async () => {
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    await screen.findByRole("dialog", { name: TITLE });
    act(() => lockVault());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((await asked("/pair", { name: "Claude Code" })).status).toBe(423);
    expect((await asked("/mcp", {}, null)).status).toBe(423);
    await act(() => unlockTestVault());
    expect(
      (await asked("/pair/poll", { requestId: body.requestId, pollSecret: body.pollSecret }))
        .status,
    ).toBe(404);
    expect((await asked("/pair", { name: "Claude Code" })).status).toBe(200);
  });

  it("closes the dialog and forgets the request when the switch goes off", async () => {
    const user = userEvent.setup();
    render(<AgentsSettings />);
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    await screen.findByRole("dialog", { name: TITLE });
    const toggle = screen.getByRole("switch", { name: "Let agents on this computer connect" });
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(commandCalls("agent_bridge_set_enabled")).toEqual([{ enabled: false }]);
    listening = true;
    expect(
      (await asked("/pair/poll", { requestId: body.requestId, pollSecret: body.pollSecret }))
        .status,
    ).toBe(404);
  });

  it("gives not_paired to a token after another account unlocks", async () => {
    const user = userEvent.setup();
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    await user.click(await screen.findByRole("button", { name: "The code matches, connect" }));
    const answer = await collected({ requestId: body.requestId, pollSecret: body.pollSecret });
    const authorization = `Bearer ${answer.body.token}`;
    expect((await asked("/mcp", {}, authorization)).status).toBe(501);

    await act(() => unlockTestVault({ endpoint: "http://other/api", principalId: "rimp1_other" }));
    expect((await asked("/mcp", {}, authorization)).status).toBe(401);
  });

  it("keeps only the token's hash in the sealed store", async () => {
    const user = userEvent.setup();
    await renderBridge();
    const { body } = await asked("/pair", { name: "Claude Code" });
    await user.click(await screen.findByRole("button", { name: "The code matches, connect" }));
    const answer = await collected({ requestId: body.requestId, pollSecret: body.pollSecret });
    const sealed = readSealedItem("rim-connected-agents");
    expect(sealed).toContain(await sha256Base64Url(answer.body.token));
    expect(sealed).not.toContain(answer.body.token);
    expect(sealed).not.toContain(body.pollSecret);
  });

  it("never logs what a request carried", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    await renderBridge();
    invoke.mockImplementation(() => Promise.reject(new Error("no bridge")));
    await deliver("/pair", { pollSecret: "sensitive-secret" }, "Bearer sensitive-token");
    await waitFor(() => expect(commandCalls("agent_bridge_ack")).toHaveLength(1));
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain("sensitive");
  });

  it("stops listening and forgets the request at unmount", async () => {
    const { unmount } = await renderBridge();
    await asked("/pair", { name: "Claude Code" });
    await screen.findByRole("dialog", { name: TITLE });
    unmount();
    expect(events.unlisten).toHaveBeenCalledOnce();
    render(<AgentPairDialogHost />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
