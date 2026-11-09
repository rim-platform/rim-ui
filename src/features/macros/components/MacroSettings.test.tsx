import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  runMacro: vi.fn(),
  agent: { available: true },
}));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => mocks.request(...args) },
}));
vi.mock("../runtime/runMacro", () => ({ runMacro: mocks.runMacro }));
vi.mock("./AiMacroBuilder", () => ({ AiMacroBuilder: () => null }));
vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: () => [],
}));
vi.mock("../../agent/agentAvailability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agent/agentAvailability")>()),
  agentAvailable: () => mocks.agent.available,
}));

import {
  CommandArgumentType,
  CommandSensitivity,
} from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";
import type { AccountMacro, MacroStepCommand } from "../api/useAccountMacros";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { recordStayedMacros, readStayedMacros } from "../runtime/macroMoves";
import { MacroSettings } from "./MacroSettings";

function stepCommand(id: string, title: string, extra: Partial<MacroStepCommand> = {}) {
  return {
    id,
    title,
    description: `${title} description`,
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: CommandSensitivity.MUTATING,
    aiCallable: true,
    arguments: [],
    ...extra,
  } satisfies MacroStepCommand;
}

const SET_TOPIC = stepCommand("chat.set_topic", "Set Topic", {
  arguments: [
    { name: "topic", title: "Topic", argumentType: CommandArgumentType.STRING, required: true },
  ],
});
const POST_MESSAGE = stepCommand("chat.post_message", "Post Message", {
  arguments: [
    { name: "text", title: "Text", argumentType: CommandArgumentType.STRING, required: true },
  ],
});
const MARK_READ = stepCommand("chat.mark_conversation_read", "Mark Read");
const OPEN_UNREADS = stepCommand("workspace.open_unreads", "Open Unreads", {
  category: "Workspace",
  executionTarget: "DESKTOP_LOCAL",
  aiCallable: false,
});
const MANAGE_AGENTS = stepCommand("agents.disconnect", "Disconnect Agent", {
  category: "Agents",
  executionTarget: "DESKTOP_LOCAL",
});
const CONNECT_AGENT = stepCommand("agents.connect_agent", "Connect an Agent", {
  category: "Agents",
  executionTarget: "DESKTOP_LOCAL",
});

function macro(overrides: Partial<AccountMacro> & { id: string }): AccountMacro {
  return {
    title: overrides.id,
    description: "",
    isEnabled: true,
    aiCallable: false,
    nlDescription: "",
    intentSamples: [],
    steps: [],
    ...overrides,
  };
}

const STANDUP = macro({
  id: "user.standup",
  title: "Standup",
  description: "Start the day",
  steps: [
    { commandId: "workspace.open_unreads", args: {}, ask: [] },
    { commandId: "chat.set_topic", args: {}, ask: ["topic"] },
  ],
});

function serve(macros: AccountMacro[]) {
  queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
  queryClient.setQueryData(queryKeys.macroStepCommands, [
    SET_TOPIC,
    MARK_READ,
    OPEN_UNREADS,
    MANAGE_AGENTS,
    CONNECT_AGENT,
    POST_MESSAGE,
  ]);
  queryClient.setQueryData(queryKeys.accountMacros, macros);
  routeRequests(mocks.request, {
    "query AccountMacros": () => ({ userCommands: macros }),
    "mutation CreateUserCommand": () => ({ createUserCommand: { id: "x" } }),
    "mutation UpdateUserCommand": () => ({ updateUserCommand: { id: "x" } }),
    "mutation DeleteUserCommand": () => ({ deleteUserCommand: true }),
    "mutation DeleteMacro": () => ({ deleteMacro: true }),
    "query MacrosToMove": () => ({ myMacros: [] }),
  });
}

function renderPage() {
  render(
    <QueryClientProvider client={queryClient}>
      <MacroSettings />
    </QueryClientProvider>,
  );
}

/** Opens the picker of step `n` and picks the command titled `title`. */
function pickStep(n: number, title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Step ${n} command` }));
  const list = screen.getByRole("listbox", { name: `Step ${n} command` });
  fireEvent.click(within(list).getByText(title));
}

beforeEach(() => {
  mocks.agent.available = true;
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ session: null });
});

describe("MacroSettings list", () => {
  it("lists each macro with its steps, and runs, turns off and deletes it", async () => {
    serve([STANDUP]);
    renderPage();

    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("2 steps: Open Unreads → Set Topic")).toBeInTheDocument();
    expect(screen.getByText("1 of 100 macros")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run Standup" }));
    await waitFor(() => expect(mocks.runMacro).toHaveBeenCalledWith("user.standup"));

    fireEvent.click(screen.getByRole("switch", { name: "Standup is on" }));
    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation UpdateUserCommand")).toEqual([
        {
          input: {
            commandId: "user.standup",
            title: "Standup",
            description: "Start the day",
            steps: [
              { commandId: "workspace.open_unreads", args: {}, ask: [] },
              { commandId: "chat.set_topic", args: {}, ask: ["topic"] },
            ],
            isEnabled: false,
          },
        },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Standup" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation DeleteUserCommand")).toEqual([
        { input: { commandId: "user.standup" } },
      ]),
    );
  });

  it("says when there are no macros yet", () => {
    serve([]);
    renderPage();

    expect(screen.getByText(/No macros yet/)).toBeInTheDocument();
  });
});

describe("MacroSettings form", () => {
  it("offers commands by category, without macros or agent management", () => {
    serve([STANDUP]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New macro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Step 1 command" }));

    const list = screen.getByRole("listbox", { name: "Step 1 command" });
    expect(within(list).getByText("Workspace")).toBeInTheDocument();
    expect(within(list).getByText("Set Topic description")).toBeInTheDocument();
    expect(within(list).queryByText("Disconnect Agent")).not.toBeInTheDocument();
    expect(within(list).queryByText(/Connect an Agent/)).not.toBeInTheDocument();
    expect(within(list).queryByText("Standup")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search commands for step 1 command" }), {
      target: { value: "topic" },
    });
    expect(within(list).queryByText("Mark Read")).not.toBeInTheDocument();
    expect(within(list).getByText("Set Topic")).toBeInTheDocument();
  });

  it("keeps a step that lacks a required argument from saving, and saves it asked for", async () => {
    mocks.agent.available = true;
    serve([STANDUP]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New macro/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Morning Topic" } });
    pickStep(1, "Set Topic");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Topic needs a value, or ask for it when the macro runs"),
    ).toBeInTheDocument();
    expect(callsTo(mocks.request, "mutation CreateUserCommand")).toEqual([]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Ask for Topic when I run it" }));
    expect(screen.getByTestId("agent-option-blocker")).toHaveTextContent(
      "Only commands the AI agent may run, run on RIM's server, with every argument fixed",
    );
    expect(screen.getByRole("checkbox", { name: "The AI agent can run this" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation CreateUserCommand")).toEqual([
        {
          input: {
            commandId: "user.morning-topic",
            title: "Morning Topic",
            description: "",
            steps: [{ commandId: "chat.set_topic", ask: ["topic"] }],
            aiCallable: false,
            nlDescription: "",
            intentSamples: [],
          },
        },
      ]),
    );
  });

  it("saves a step's message text with its line breaks", async () => {
    serve([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New macro/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Checklist" } });
    pickStep(1, "Post Message");
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "Day one\n- laptop\n- badge" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation CreateUserCommand")[0]).toMatchObject({
        input: {
          steps: [
            {
              commandId: "chat.post_message",
              args: { text: "Day one\n- laptop\n- badge" },
              ask: [],
            },
          ],
        },
      }),
    );
  });

  it("lets the agent run a macro of server commands with every argument fixed", async () => {
    serve([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New macro/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Topic" } });
    pickStep(1, "Set Topic");
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Launch day" } });

    const option = screen.getByRole("checkbox", { name: "The AI agent can run this" });
    expect(option).toBeEnabled();
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation CreateUserCommand")[0]).toMatchObject({
        input: {
          commandId: "user.topic",
          steps: [{ commandId: "chat.set_topic", args: { topic: "Launch day" }, ask: [] }],
          aiCallable: true,
        },
      }),
    );
  });

  it("refuses a title another macro has", async () => {
    serve([STANDUP]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New macro/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " standup " } });
    pickStep(1, "Mark Read");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText('You already have a macro called "standup".'),
    ).toBeInTheDocument();
    expect(callsTo(mocks.request, "mutation CreateUserCommand")).toEqual([]);
  });

  it("edits a saved macro, keeping a step that runs another macro", async () => {
    const nesting = macro({
      id: "user.both",
      title: "Both",
      steps: [
        { commandId: "user.standup", args: {}, ask: [] },
        { commandId: "chat.mark_conversation_read", args: {}, ask: [] },
      ],
    });
    serve([STANDUP, nesting]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Both" }));

    expect(screen.getByText("Another macro (kept, no longer offered)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation UpdateUserCommand")[0]).toMatchObject({
        input: {
          commandId: "user.both",
          isEnabled: true,
          steps: [
            { commandId: "user.standup", ask: [] },
            { commandId: "chat.mark_conversation_read", ask: [] },
          ],
          aiCallable: false,
        },
      }),
    );
  });

  it("leaves the agent option out where the agent does not run, keeping the saved choice", async () => {
    mocks.agent.available = false;
    serve([macro({ ...STANDUP, aiCallable: true })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Standup" }));

    expect(
      screen.queryByRole("checkbox", { name: "The AI agent can run this" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation UpdateUserCommand")).toHaveLength(1),
    );
    expect(callsTo(mocks.request, "mutation UpdateUserCommand")[0].input).not.toHaveProperty(
      "aiCallable",
    );
  });
});

describe("MacroSettings macros not moved yet", () => {
  const STAYED = {
    workspaceId: "ws-2",
    workspaceName: "Design",
    macroId: "m-1",
    title: "Old triage",
    reason: "unknown command step `x.y`",
  };

  beforeEach(() => {
    useAuthStore.setState({ session: { userId: "u-1" } as never });
    recordStayedMacros("u-1", "ws-2", [STAYED]);
  });

  it("lists each one with its workspace and why it stayed, and deletes one after a confirm", async () => {
    serve([]);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Not moved yet" })).toBeInTheDocument();
    expect(screen.getByText("Old triage")).toBeInTheDocument();
    expect(screen.getByText("In Design: unknown command step `x.y`")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Old triage from Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "mutation DeleteMacro")).toEqual([{ macroId: "m-1" }]),
    );
    await waitFor(() => expect(screen.queryByText("Old triage")).not.toBeInTheDocument());
    expect(readStayedMacros("u-1")).toEqual([]);
  });

  it("moves a workspace's macros again on Try again", async () => {
    serve([]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Try moving Old triage again" }));

    await waitFor(() =>
      expect(callsTo(mocks.request, "query MacrosToMove")).toEqual([{ serverId: "ws-2" }]),
    );
    await waitFor(() => expect(screen.queryByText("Old triage")).not.toBeInTheDocument());
  });

  it("shows nothing when every macro moved", async () => {
    localStorage.clear();
    serve([]);
    renderPage();

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.macroMovesStayed("u-1"))?.status).toBe("success"),
    );

    expect(screen.queryByRole("heading", { name: "Not moved yet" })).not.toBeInTheDocument();
  });
});
