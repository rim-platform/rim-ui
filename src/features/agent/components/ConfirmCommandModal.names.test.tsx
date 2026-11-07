import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandArgumentType,
  CommandSensitivity,
  ConversationTypeEnum,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../state/confirmationModalStore";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn() },
}));

import { graphqlClient } from "../../../core/graphql/client";
import { ConfirmCommandModal } from "./ConfirmCommandModal";

const OPEN = "01a1b378-4bc1-762e-9646-c806acbc9564";
const OTHER = "01a1b378-4bc1-762e-9646-c806acbc9565";
const DIRECT = "01a1b376-8e11-7131-93d3-2ef218879aa2";
const GENERAL = "01a1b378-4bc6-76c6-80f7-7283af7fe543";
const GENERAL_TWIN = "01a1b378-4bc6-76c6-80f7-7283af7fe544";
const RANDOM = "01a1b378-4bca-71cb-bd9c-ec27237fc9dc";
const STRANGER = "01a1b378-4bca-71cb-bd9c-ec27237fc9dd";
const PERSON = "01a1b378-4bca-71cb-bd9c-ec27237fc9de";

function show(overrides: Partial<ConfirmationRequest>): void {
  render(<ConfirmCommandModal />);
  act(() => {
    void useConfirmationModalStore.getState().open({
      commandId: "chat.post_message",
      toolName: "chat.post_message",
      args: {},
      token: `tok-${Math.random().toString(36).slice(2, 8)}`,
      argsHash: "h",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sensitivity: CommandSensitivity.MUTATING,
      ...overrides,
    });
  });
}

function channel(id: string, workspaceId: string, title: string, extra = {}): void {
  queryClient.setQueryData(queryKeys.conversation(workspaceId, id), {
    id,
    serverId: workspaceId,
    title,
    conversationType: ConversationTypeEnum.CHANNEL,
    ...extra,
  });
}

function row(argName: string) {
  return within(screen.getByTestId(`id-arg-${argName}`));
}

beforeEach(() => {
  vi.mocked(graphqlClient.request).mockReset();
  vi.mocked(graphqlClient.request).mockRejectedValue(new Error("not found"));
  queryClient.clear();
  useConfirmationModalStore.setState({ request: null });
  useShellStore.getState().reset();
  useWorkspaceStore.getState().setWorkspaceId(OPEN);
  useRelayStore.setState({ info: { directSpaceId: DIRECT } as never, spaces: {} });
  queryClient.setQueryData(queryKeys.myServers(), [
    { id: OPEN, name: "Rim Dev", owner: null },
    { id: OTHER, name: "Other", owner: null },
  ]);
});

afterEach(() => {
  cleanup();
  useConfirmationModalStore.setState({ request: null });
  useWorkspaceStore.getState().clearWorkspaceId();
});

describe("ConfirmCommandModal names the ids in its arguments", () => {
  it("shows a workspace and a channel by name, each with its id", () => {
    channel(GENERAL, OPEN, "general");
    show({ args: { server_id: OPEN, conversation_id: GENERAL, text: "hello" } });

    expect(row("server_id").getByText("Rim Dev")).toBeInTheDocument();
    expect(row("server_id").getByText(OPEN)).toBeInTheDocument();
    expect(row("conversation_id").getByText("#general")).toBeInTheDocument();
    expect(row("conversation_id").getByText(GENERAL)).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Channel")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("says Unknown beside an id it cannot resolve, and never leaves it blank", async () => {
    show({
      args: {
        server_id: STRANGER,
        conversation_id: GENERAL,
        user_id: PERSON,
      },
    });

    await waitFor(() => expect(row("conversation_id").getByText("Unknown")).toBeInTheDocument());
    expect(row("server_id").getByText("Unknown")).toBeInTheDocument();
    expect(row("server_id").getByText(STRANGER)).toBeInTheDocument();
    expect(row("conversation_id").getByText(GENERAL)).toBeInTheDocument();
    expect(row("user_id").getByText("Unknown")).toBeInTheDocument();
    expect(row("user_id").getByText(PERSON)).toBeInTheDocument();
  });

  it("tells apart two channels with one name by their ids", () => {
    channel(GENERAL, OPEN, "general");
    channel(GENERAL_TWIN, OTHER, "general");

    show({ args: { server_id: OPEN, conversation_id: GENERAL } });
    expect(row("conversation_id").getByText("#general")).toBeInTheDocument();
    expect(row("conversation_id").getByText(GENERAL)).toBeInTheDocument();
    cleanup();

    show({ args: { server_id: OTHER, conversation_id: GENERAL_TWIN } });
    expect(row("conversation_id").getByText("#general")).toBeInTheDocument();
    expect(row("conversation_id").getByText(GENERAL_TWIN)).toBeInTheDocument();
    expect(row("conversation_id").getByText("in Other")).toBeInTheDocument();
  });

  it("says which workspace a channel is in only when it is not the open one", () => {
    channel(GENERAL, OPEN, "general");
    show({ args: { server_id: OPEN, conversation_id: GENERAL } });
    expect(screen.getByTestId("id-arg-conversation_id")).not.toHaveTextContent("in Rim Dev");
    cleanup();

    useShellStore.getState().setMainSurface({ kind: "home" });
    show({ args: { server_id: OPEN, conversation_id: GENERAL } });
    expect(row("conversation_id").getByText("in Rim Dev")).toBeInTheDocument();
  });

  it("asks the server about a conversation that is not cached", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      conversation: {
        id: RANDOM,
        serverId: OTHER,
        title: "random",
        conversationType: ConversationTypeEnum.CHANNEL,
      },
    });
    show({ args: { server_id: OTHER, conversation_id: RANDOM } });

    expect(row("conversation_id").getByText("Looking up…")).toBeInTheDocument();
    await waitFor(() => expect(row("conversation_id").getByText("#random")).toBeInTheDocument());
    expect(vi.mocked(graphqlClient.request).mock.calls[0]![1]).toEqual({
      serverId: OTHER,
      conversationId: RANDOM,
    });
  });

  it("does not take the name of a conversation another workspace holds", () => {
    channel(GENERAL, OPEN, "general", { serverId: OTHER });
    show({ args: { server_id: OPEN, conversation_id: GENERAL } });

    expect(screen.getByTestId("id-arg-conversation_id")).not.toHaveTextContent("#general");
  });

  it("calls the direct space Direct messages, not a workspace name", () => {
    show({ args: { server_id: DIRECT } });

    expect(row("server_id").getByText("Direct messages")).toBeInTheDocument();
    expect(row("server_id").getByText(DIRECT)).toBeInTheDocument();
  });

  it("names a person from the workspace's members", () => {
    queryClient.setQueryData(queryKeys.serverMembers(OPEN), [
      { userId: PERSON, username: "ada", displayName: "Ada" },
    ]);
    show({ args: { server_id: OPEN, user_id: PERSON } });

    expect(row("user_id").getByText("Ada")).toBeInTheDocument();
    expect(row("user_id").getByText(PERSON)).toBeInTheDocument();
  });

  it("goes by the declared type over the argument's name", () => {
    channel(GENERAL, OPEN, "general");
    show({
      args: { server_id: "not an id here", target: GENERAL },
      argumentTypes: {
        server_id: CommandArgumentType.STRING,
        target: CommandArgumentType.CONVERSATION_ID,
      },
    });

    expect(screen.queryByTestId("id-arg-server_id")).not.toBeInTheDocument();
    expect(screen.getByText("not an id here")).toBeInTheDocument();
    expect(row("target").getByText("#general")).toBeInTheDocument();
  });

  it("shows invisible characters by name in every name", () => {
    queryClient.setQueryData(queryKeys.myServers(), [
      { id: OPEN, name: "Rim\u202EDev", owner: null },
    ]);
    channel(GENERAL, OPEN, "gen\u200Beral");
    useShellStore.getState().setMainSurface({ kind: "home" });
    show({ args: { server_id: OPEN, conversation_id: GENERAL } });

    expect(row("server_id").getByText("Rim⟦U+202E⟧Dev")).toBeInTheDocument();
    expect(row("conversation_id").getByText("#gen⟦U+200B⟧eral")).toBeInTheDocument();
    expect(row("conversation_id").getByText("in Rim⟦U+202E⟧Dev")).toBeInTheDocument();
  });

  it("keeps a masked value masked, even in an argument that holds an id", () => {
    show({
      args: { session_conversation: "secret" },
      argumentTypes: { session_conversation: CommandArgumentType.CONVERSATION_ID },
    });

    expect(screen.queryByTestId("id-arg-session_conversation")).not.toBeInTheDocument();
    expect(screen.getByText("[REDACTED]")).toBeInTheDocument();
  });

  it("leaves the request's arguments exactly as they are", () => {
    channel(GENERAL, OPEN, "general");
    const args = { server_id: OPEN, conversation_id: GENERAL, text: "hello" };
    show({ args: { ...args } });

    expect(useConfirmationModalStore.getState().request!.args).toEqual(args);
  });
});

describe("ConfirmCommandModal names the destination of its cross-channel warning", () => {
  beforeEach(() => {
    useShellStore.getState().setSelectedConversationId(RANDOM);
  });

  it("names the channel and its workspace, with its whole id", () => {
    channel(GENERAL, OTHER, "general");
    show({ args: { server_id: OTHER, conversation_id: GENERAL } });

    const chip = screen.getByTestId("cross-channel-chip");
    expect(chip).toHaveTextContent("Will post in #general in Other");
    expect(chip).toHaveTextContent(GENERAL);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      expect.stringContaining("will post in #general in Other."),
    );
  });

  it("says an unknown destination is unknown", async () => {
    show({ args: { server_id: OPEN, conversation_id: STRANGER } });

    const chip = screen.getByTestId("cross-channel-chip");
    await waitFor(() => expect(chip).toHaveTextContent("Will post in an unknown conversation"));
    expect(chip).toHaveTextContent(STRANGER);
  });

  it("keeps the words of the dialog for a program outside RIM, and asks nothing", () => {
    channel(GENERAL, OPEN, "general");
    show({
      args: { server_id: OPEN, conversation_id: GENERAL },
      outsideAgent: { name: "Tool", target: [] },
    });

    expect(screen.getByTestId("cross-channel-chip")).toHaveTextContent(
      `Will post in conversation ${GENERAL.slice(0, 8)}…`,
    );
    expect(graphqlClient.request).not.toHaveBeenCalled();
  });
});
