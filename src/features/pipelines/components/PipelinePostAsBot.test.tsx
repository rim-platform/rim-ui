import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import {
  PipelineTriggerKindGql,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import { fakeServerInfo, serverInfoQueryClient } from "../../../test/serverInfo";
import { useToastStore } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { PIPELINE_POST_AS_BOT } from "../../updater/api/serverCapabilities";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { Pipeline } from "../api/usePipelines";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock("../../commands/api/useCommands", () => ({
  useCommands: () => ({ data: [] }),
}));

const roleMock = vi.fn<() => ServerMemberRoleGql>();

vi.mock("../../workspaces/api/useMyServerRole", () => ({
  useMyServerRole: () => roleMock(),
  useCanModerate: () =>
    [ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR].includes(roleMock()),
}));

import { PipelineSettings } from "./PipelineSettings";

type Handler = (vars: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;

function operationName(doc: unknown): string {
  return /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1] ?? "unknown";
}

function callsTo(op: string): Record<string, unknown>[] {
  return requestMock.mock.calls
    .filter(([doc]) => operationName(doc) === op)
    .map(([, vars]) => vars as Record<string, unknown>);
}

const CHANNEL_ID = "11111111-1111-7111-8111-111111111111";
const HIDDEN_ID = "22222222-2222-7222-8222-222222222222";
const BOT_ID = "33333333-3333-7333-8333-333333333333";

const bot = {
  userId: BOT_ID,
  serverId: "ws-1",
  name: "Greeter",
  runBy: "Ada",
  readsGoTo: "Nowhere",
  addedByName: "Ada",
  createdAt: "2026-01-01T00:00:00Z",
  deactivatedAt: null,
};

/** A welcome pipeline by someone else, listed with `postAsBot` for `conversationId`. */
function welcome(conversationId: string, fields: Partial<Pipeline> = {}): Pipeline {
  const text = "Welcome, {name}!";
  return {
    id: "p-1",
    serverId: "ws-1",
    name: "Welcome",
    description: null,
    trigger: { kind: PipelineTriggerKindGql.MEMBER_JOINED, conversationId: null },
    filter: null,
    actions: [
      {
        actionType: "PostAsBot",
        commandId: "chat.post_message",
        args: { bot_user_id: BOT_ID, conversation_id: conversationId, text },
        postAsBot: { botUserId: BOT_ID, conversationId, text },
      },
    ],
    enabled: true,
    cooldownSecs: null,
    createdBy: "someone-else",
    schemaVersion: 1,
    lastFiredAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...fields,
  };
}

/** The same pipeline as a listing that did not ask for `postAsBot` has it. */
function olderStyle(pipeline: Pipeline): Pipeline {
  return {
    ...pipeline,
    actions: pipeline.actions.map(({ actionType, commandId, args }) => ({
      actionType,
      commandId,
      args,
    })),
  };
}

function serve(pipelines: Pipeline[], extra: Record<string, Handler> = {}) {
  handlers = {
    Pipelines: () => ({ pipelines }),
    PipelinesWithPostAsBot: () => ({ pipelines }),
    Bots: () => ({ bots: [bot] }),
    BotChannels: () => ({
      channels: {
        items: [makeConversation({ id: CHANNEL_ID, title: "welcome", memberIds: [BOT_ID] })],
        next: null,
        pageInfo: { hasNext: false },
      },
    }),
    Channels: () => ({
      channels: { items: [], pageInfo: { hasNext: false, hasPrev: false } },
    }),
    ...extra,
  };
}

/** Render the page on a server listing `capabilities`, as a viewer with `role`. */
function renderPage(role: ServerMemberRoleGql, capabilities: string[] = [PIPELINE_POST_AS_BOT]) {
  roleMock.mockReturnValue(role);
  queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
  render(
    <QueryClientProvider client={serverInfoQueryClient({}, { capabilities })}>
      <PipelineSettings />
    </QueryClientProvider>,
  );
}

async function openNewMemberJoined() {
  fireEvent.click(await screen.findByRole("button", { name: /New Pipeline/ }));
  fireEvent.change(screen.getByPlaceholderText("My pipeline"), { target: { value: "Welcome" } });
  fireEvent.change(screen.getAllByRole("combobox")[0], {
    target: { value: PipelineTriggerKindGql.MEMBER_JOINED },
  });
}

async function fillPost(text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Post as bot" }));
  const botSelect = await screen.findByRole("combobox", { name: "Bot of action 1" });
  await within(botSelect).findByRole("option", { name: "Greeter" });
  fireEvent.change(botSelect, { target: { value: BOT_ID } });
  const channelSelect = screen.getByRole("combobox", { name: "Channel of action 1" });
  await within(channelSelect).findByRole("option", { name: "#welcome" });
  fireEvent.change(channelSelect, { target: { value: CHANNEL_ID } });
  fireEvent.change(screen.getByRole("textbox", { name: "Text of action 1" }), {
    target: { value: text },
  });
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((doc: unknown, vars: Record<string, unknown>) => {
    const handler = handlers[operationName(doc)];
    if (!handler) throw new Error(`unexpected operation ${operationName(doc)}`);
    return Promise.resolve(handler(vars));
  });
  serve([]);
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ session: { userId: "u-1" } });
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ session: null });
  queryClient.removeQueries({ queryKey: queryKeys.serverInfo });
});

describe("Post as bot in the list", () => {
  it("names the bot and the channel, with the text, for every member", async () => {
    serve([welcome(CHANNEL_ID)]);
    renderPage(ServerMemberRoleGql.MEMBER);
    expect(await screen.findByText("Post as Greeter in #welcome")).toBeInTheDocument();
    expect(screen.getByText("Welcome, {name}!")).toBeInTheDocument();
    expect(screen.queryByTitle("Edit pipeline")).not.toBeInTheDocument();
    expect(callsTo("PipelinesWithPostAsBot")).toHaveLength(1);
  });

  it.each([
    ["with postAsBot", (p: Pipeline) => p],
    ["from an older-style listing", olderStyle],
  ])("shows a channel the viewer can't see only as that, %s", async (_label, listing) => {
    serve([listing(welcome(HIDDEN_ID))]);
    renderPage(ServerMemberRoleGql.MEMBER);
    expect(await screen.findByText("Post as Greeter in a channel you can't see")).toBeVisible();
    expect(document.body.textContent).not.toContain(HIDDEN_ID);
  });

  it("reads an older-style listing the same way", async () => {
    serve([olderStyle(welcome(CHANNEL_ID))]);
    renderPage(ServerMemberRoleGql.MEMBER, []);
    expect(await screen.findByText("Post as Greeter in #welcome")).toBeInTheDocument();
    expect(callsTo("Pipelines")).toHaveLength(1);
    expect(callsTo("PipelinesWithPostAsBot")).toHaveLength(0);
  });

  it("names a bot the viewer's list can't hold only as a bot", async () => {
    serve([welcome(CHANNEL_ID)], { Bots: () => Promise.reject(new Error("FORBIDDEN")) });
    renderPage(ServerMemberRoleGql.GUEST);
    expect(await screen.findByText("Post as a bot in #welcome")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(BOT_ID);
  });

  it("shows invisible characters in every name and in the text", async () => {
    const pipeline = welcome(CHANNEL_ID);
    pipeline.actions[0].postAsBot!.text = "Hi‮ there";
    serve([pipeline], {
      Bots: () => ({ bots: [{ ...bot, name: "Gre‮eter" }] }),
      BotChannels: () => ({
        channels: {
          items: [makeConversation({ id: CHANNEL_ID, title: "wel​come" })],
          next: null,
          pageInfo: { hasNext: false },
        },
      }),
    });
    renderPage(ServerMemberRoleGql.MEMBER);
    expect(
      await screen.findByText("Post as Gre⟦U+202E⟧eter in #wel⟦U+200B⟧come"),
    ).toBeInTheDocument();
    expect(screen.getByText("Hi⟦U+202E⟧ there")).toBeInTheDocument();
  });
});

describe("Post as bot in the editor", () => {
  it("is offered to an Owner or Moderator on Member Joined only", async () => {
    renderPage(ServerMemberRoleGql.MODERATOR);
    fireEvent.click(await screen.findByRole("button", { name: /New Pipeline/ }));
    expect(screen.queryByRole("button", { name: "Post as bot" })).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: PipelineTriggerKindGql.MEMBER_JOINED },
    });
    expect(await screen.findByRole("button", { name: "Post as bot" })).toBeInTheDocument();
  });

  it("is not offered to a Member", async () => {
    renderPage(ServerMemberRoleGql.MEMBER);
    await openNewMemberJoined();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add action/ })).toBeInTheDocument(),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Post as bot" })).not.toBeInTheDocument();
  });

  it("is not offered, and nothing new is asked for, on an older host", async () => {
    renderPage(ServerMemberRoleGql.OWNER, []);
    await openNewMemberJoined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Post as bot" })).not.toBeInTheDocument();
    expect(callsTo("PipelinesWithPostAsBot")).toHaveLength(0);
    expect(callsTo("Pipelines")).toHaveLength(1);
  });

  it("says plainly who posts and what the placeholders mean, and saves the action", async () => {
    handlers.CreatePipeline = () => ({ createPipeline: welcome(CHANNEL_ID) });
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    await fillPost("Welcome, {name}!");

    expect(
      screen.getByText("Posted by the bot, without asking anyone, each time someone joins."),
    ).toBeInTheDocument();
    expect(screen.getByText(/at their home server if they're from another one/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("CreatePipeline")).toHaveLength(1));
    expect(callsTo("CreatePipeline")[0].input).toMatchObject({
      actions: [
        {
          commandId: "chat.post_message",
          postAsBot: {
            botUserId: BOT_ID,
            conversationId: CHANNEL_ID,
            text: "Welcome, {name}!",
          },
        },
      ],
    });
  });

  it("offers only that bot's channels and says when it has none", async () => {
    serve([], {
      BotChannels: () => ({
        channels: {
          items: [
            makeConversation({ id: "c-other", title: "other", memberIds: ["someone"] }),
            makeConversation({
              id: "c-sealed",
              title: "sealed",
              memberIds: [BOT_ID],
              encryptedAt: "2026-01-01T00:00:00Z",
            }),
          ],
          next: null,
          pageInfo: { hasNext: false },
        },
      }),
    });
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    fireEvent.click(await screen.findByRole("button", { name: "Post as bot" }));
    const botSelect = await screen.findByRole("combobox", { name: "Bot of action 1" });
    await within(botSelect).findByRole("option", { name: "Greeter" });
    fireEvent.change(botSelect, { target: { value: BOT_ID } });
    expect(
      await screen.findByText(
        "This bot is in no channels yet. Add it to one in Settings > Bots & webhooks.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Channel of action 1" })).toBeNull();
  });

  it("leaves deactivated bots out of the choice", async () => {
    serve([], {
      Bots: () => ({
        bots: [
          bot,
          { ...bot, userId: "gone", name: "Gone", deactivatedAt: "2026-01-02T00:00:00Z" },
        ],
      }),
    });
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    fireEvent.click(await screen.findByRole("button", { name: "Post as bot" }));
    const botSelect = await screen.findByRole("combobox", { name: "Bot of action 1" });
    await within(botSelect).findByRole("option", { name: "Greeter" });
    expect(within(botSelect).queryByRole("option", { name: "Gone" })).toBeNull();
  });

  it("shows the server's refusal beside the field and stays open", async () => {
    handlers.CreatePipeline = () =>
      Promise.reject(
        new Error("a Post as bot text takes only {username} and {name}, not {usernme}"),
      );
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    await fillPost("Hi {usernme}");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("{usernme}");
    const field = screen.getByRole("textbox", { name: "Text of action 1" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(useToastStore.getState().toasts).toEqual([]);

    fireEvent.change(field, { target: { value: "Hi {username}" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for what is missing before asking the server", async () => {
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    fireEvent.click(await screen.findByRole("button", { name: "Post as bot" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a bot and a channel");
    expect(callsTo("CreatePipeline")).toEqual([]);
  });

  it("says when the trigger no longer fits", async () => {
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    fireEvent.click(await screen.findByRole("button", { name: "Post as bot" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: PipelineTriggerKindGql.NEW_MESSAGE },
    });
    expect(await screen.findByText("This only runs on the Member Joined trigger.")).toBeVisible();
  });

  it("is reachable by keyboard", async () => {
    const user = userEvent.setup();
    renderPage(ServerMemberRoleGql.OWNER);
    await openNewMemberJoined();
    fireEvent.click(await screen.findByRole("button", { name: "Post as bot" }));
    const botSelect = await screen.findByRole("combobox", { name: "Bot of action 1" });
    await expectReachableByKeyboard(user, [
      botSelect,
      screen.getByRole("textbox", { name: "Text of action 1" }),
      screen.getByRole("button", { name: "Remove action 1" }),
      screen.getByRole("button", { name: "Save" }),
    ]);
  });
});

describe("Post as bot for someone who may not change it", () => {
  /** A demoted creator opens their own pipeline in the editor. */
  async function openOwnPipeline(pipeline: Pipeline) {
    serve([pipeline], { UpdatePipeline: () => ({ updatePipeline: pipeline }) });
    renderPage(ServerMemberRoleGql.MEMBER);
    fireEvent.click(await screen.findByTitle("Edit pipeline"));
  }

  it.each([
    ["with postAsBot", (p: Pipeline) => p],
    ["from an older-style listing", olderStyle],
  ])("shows it read-only and sends it back as it was listed, %s", async (_label, listing) => {
    const pipeline = listing(welcome(HIDDEN_ID, { createdBy: "u-1" }));
    await openOwnPipeline(pipeline);

    expect(await screen.findByText("Post as Greeter in a channel you can't see")).toBeVisible();
    expect(screen.getByText(/Only an Owner or Moderator can change this/)).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Bot of action 1" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Text of action 1" })).toBeNull();
    expect(screen.queryByDisplayValue(new RegExp(HIDDEN_ID))).toBeNull();
    expect(document.body.textContent).not.toContain(HIDDEN_ID);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("UpdatePipeline")).toHaveLength(1));
    expect(callsTo("UpdatePipeline")[0].input).toMatchObject({
      actions: [
        {
          commandId: "chat.post_message",
          args: { bot_user_id: BOT_ID, conversation_id: HIDDEN_ID },
        },
      ],
    });
    const sent = callsTo("UpdatePipeline")[0].input as { actions: Record<string, unknown>[] };
    expect(sent.actions[0].postAsBot).toBeUndefined();
  });

  it("tells a Moderator on an older-style listing that the server is why", async () => {
    const pipeline = olderStyle(welcome(CHANNEL_ID));
    serve([pipeline], { UpdatePipeline: () => ({ updatePipeline: pipeline }) });
    renderPage(ServerMemberRoleGql.MODERATOR, []);
    fireEvent.click(await screen.findByTitle("Edit pipeline"));
    expect(await screen.findByText(/server doesn't let this app change it/)).toBeVisible();
    expect(screen.queryByText(/Only an Owner or Moderator/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Post as bot" })).toBeNull();
    expect(screen.queryByDisplayValue(/bot_user_id/)).toBeNull();
  });

  it("can remove it", async () => {
    await openOwnPipeline(welcome(CHANNEL_ID, { createdBy: "u-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove action 1" }));
    expect(screen.queryByText(/Post as Greeter/)).toBeNull();
    expect(screen.getByText("Actions (0/10)")).toBeInTheDocument();
  });

  it("lets a Moderator change it, and doesn't show it as a command", async () => {
    const pipeline = welcome(CHANNEL_ID);
    serve([pipeline], { UpdatePipeline: () => ({ updatePipeline: pipeline }) });
    renderPage(ServerMemberRoleGql.MODERATOR);
    fireEvent.click(await screen.findByTitle("Edit pipeline"));
    const text = await screen.findByRole("textbox", { name: "Text of action 1" });
    expect(text).toHaveValue("Welcome, {name}!");
    expect(screen.queryByDisplayValue(/bot_user_id/)).toBeNull();
    fireEvent.change(text, { target: { value: "Hello {username}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("UpdatePipeline")).toHaveLength(1));
    expect(callsTo("UpdatePipeline")[0].input).toMatchObject({
      actions: [{ postAsBot: { text: "Hello {username}", conversationId: CHANNEL_ID } }],
    });
  });
});

describe("A suspended pipeline", () => {
  it("shows as Disabled, as any switched-off pipeline does", async () => {
    serve([welcome(CHANNEL_ID, { enabled: false, createdBy: "u-1" })]);
    renderPage(ServerMemberRoleGql.OWNER);
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(screen.getByTitle("Enable pipeline")).toBeInTheDocument();
  });
});
