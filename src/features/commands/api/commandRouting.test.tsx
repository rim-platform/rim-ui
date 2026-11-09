import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { setSpaceRouter } from "../../../core/graphql/client";
import { KeybindContext, KeybindScope } from "../../../core/graphql/generated/schema-types";
import { createTestQueryClient } from "../../../test/utils";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { fetchAgentCommands } from "../../agents/api/agentCommandList";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { runWithHumanConfirmation } from "../runtime/humanConfirmation";
import { createKeybind } from "./useKeybindSettings";
import { useUserCommandSteps } from "./useUserCommands";
import { fetchCommandList, useCommands, useExecuteCommandMutation } from "./useCommands";

const REMOTE = "remote-ws";
const LOCAL = "local-ws";
const HOST = "host-b";

const COMMAND = {
  id: "chat.mark_as_read",
  title: "Mark As Read",
  description: "",
  category: "chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: true,
  keybindCapable: true,
  dangerous: false,
  sensitivity: "SAFE",
  arguments: [],
};

const SUCCESS = { status: "SUCCESS", message: "", payload: null, followUpCommands: [] };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** An answer to any request these tests send, by the operation it names. */
function answer(body: string): Response {
  const { query } = JSON.parse(body) as { query: string };
  if (query.includes("executeCommand")) return json({ data: { executeCommand: SUCCESS } });
  if (query.includes("createKeybind")) {
    return json({ data: { createKeybind: { id: "kb-1", keystroke: "g", commandId: COMMAND.id } } });
  }
  if (query.includes("userCommands")) return json({ data: { userCommands: [] } });
  return json({ data: { commands: [COMMAND] } });
}

type Body = { query: string; variables: Record<string, unknown> };

const send = vi.fn(async (_host: string, body: string) => answer(body));
const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => answer(init?.body as string));

function hostBodies(): Body[] {
  return send.mock.calls.map(([, body]) => JSON.parse(body) as Body);
}

function homeBodies(): Body[] {
  return fetchSpy.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as Body);
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  send.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  useRelayStore.setState({
    spaces: { [REMOTE]: { account: "a", spaceId: REMOTE, hostServerId: HOST, kind: "workspace" } },
  });
  setSpaceRouter({ hostOf: (id) => (id === REMOTE ? HOST : null), send });
  useWorkspaceStore.setState({ workspaceId: REMOTE });
});

afterEach(() => {
  setSpaceRouter(null);
  useRelayStore.setState({ spaces: {} });
  useConfirmationModalStore.getState().reset();
  vi.unstubAllGlobals();
});

describe("command lists", () => {
  it("asks the host of a workspace on another server, with the workspace to route by", async () => {
    await fetchCommandList("KEYBIND_PICKER", { workspaceId: REMOTE });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(HOST);
    expect(hostBodies()[0].variables).toEqual({
      surface: "KEYBIND_PICKER",
      commandContext: { workspaceId: REMOTE },
      workspaceId: REMOTE,
    });
  });

  it("asks this server for a workspace it hosts, with the variables unchanged", async () => {
    await fetchCommandList("PALETTE", { workspaceId: LOCAL });
    expect(send).not.toHaveBeenCalled();
    expect(homeBodies()[0].variables).toEqual({
      surface: "PALETTE",
      commandContext: { workspaceId: LOCAL },
    });
  });

  it("lists the active remote workspace's commands from its host", async () => {
    const { result } = renderHook(() => useCommands("PALETTE"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([COMMAND]));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(hostBodies()[0].variables).toEqual({
      surface: "PALETTE",
      commandContext: { workspaceId: REMOTE },
      workspaceId: REMOTE,
    });
  });

  it("lists the active local workspace's commands from this server", async () => {
    useWorkspaceStore.setState({ workspaceId: LOCAL });
    const { result } = renderHook(() => useCommands("CONTEXT_MENU"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([COMMAND]));
    expect(send).not.toHaveBeenCalled();
    expect(homeBodies()[0].variables).toEqual({
      surface: "CONTEXT_MENU",
      commandContext: { workspaceId: LOCAL },
    });
  });
});

describe("running a command", () => {
  it("runs a command in a workspace on another server on its host", async () => {
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        commandId: COMMAND.id,
        commandContext: { workspaceId: REMOTE, conversationId: "c-1" },
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0]).toBe(HOST);
    const { variables } = hostBodies()[0];
    expect(variables.workspaceId).toBe(REMOTE);
    expect(variables.input).toMatchObject({
      commandId: COMMAND.id,
      commandContext: { workspaceId: REMOTE, conversationId: "c-1" },
    });
  });

  it("runs a command in a workspace this server hosts here, with the variables unchanged", async () => {
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        commandId: COMMAND.id,
        commandContext: { workspaceId: LOCAL },
      });
    });
    expect(send).not.toHaveBeenCalled();
    expect(Object.keys(homeBodies()[0].variables)).toEqual(["input"]);
  });

  it("runs a command with no workspace on this server", async () => {
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ commandId: "app.reload" });
    });
    expect(send).not.toHaveBeenCalled();
    expect(Object.keys(homeBodies()[0].variables)).toEqual(["input"]);
  });

  it("sends the confirmed run again to the same host", async () => {
    send.mockImplementationOnce(async () =>
      json({
        data: {
          executeCommand: {
            ...SUCCESS,
            status: "CONFIRMATION_REQUIRED",
            confirmationRequired: {
              token: "tok",
              argsHash: "hash",
              expiresAt: "2999-01-01T00:00:00Z",
            },
          },
        },
      }),
    );
    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) useConfirmationModalStore.getState().approve();
    });
    const { result } = renderHook(() => useExecuteCommandMutation(), { wrapper });
    let outcome: Awaited<ReturnType<typeof runWithHumanConfirmation>> | undefined;
    await act(async () => {
      outcome = await runWithHumanConfirmation(
        async (confirmation) =>
          (
            await result.current.mutateAsync({
              commandId: COMMAND.id,
              commandContext: { workspaceId: REMOTE },
              ...(confirmation && { confirmation }),
            })
          ).executeCommand,
        { commandId: COMMAND.id, title: COMMAND.title },
      );
    });
    unsubscribe();
    expect(outcome?.kind).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([host]) => host)).toEqual([HOST, HOST]);
    const resend = hostBodies()[1].variables;
    expect(resend.workspaceId).toBe(REMOTE);
    expect(resend.input).toMatchObject({
      confirmation: { inBandToken: { token: "tok", argsHash: "hash" } },
    });
  });
});

describe("account-level and agent requests", () => {
  it("keeps saving a keybind on this server while a remote workspace is open", async () => {
    await createKeybind({
      keystroke: "g",
      commandId: COMMAND.id,
      context: KeybindContext.GLOBAL,
      scope: KeybindScope.USER,
    });
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps reading user commands from this server while a remote workspace is open", async () => {
    const { result } = renderHook(() => useUserCommandSteps(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves an agent's command list for a remote workspace on this server", async () => {
    await fetchAgentCommands(REMOTE);
    expect(send).not.toHaveBeenCalled();
    expect(homeBodies()[0].variables).toEqual({ commandContext: { workspaceId: REMOTE } });
  });
});
