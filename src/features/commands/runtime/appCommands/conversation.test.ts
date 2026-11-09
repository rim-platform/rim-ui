import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/runtime/runtime")>()),
  detectPlatform: vi.fn(() => "desktop"),
}));

import { ConversationTypeEnum } from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { detectPlatform } from "../../../../core/runtime/runtime";
import { toast } from "../../../../shared/toast";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { useAgentEncryptedStore } from "../../../agent/state/useAgentEncryptedStore";
import { useConversationDialogStore } from "../../../conversations/state/useConversationDialogStore";
import { useInvitationActionsStore } from "../../../conversations/state/useInvitationActionsStore";
import type { ConversationSummary } from "../../../conversations/types";
import { useLensStore } from "../../../lenses/state/useLensStore";
import {
  useSelectedMessageStore,
  type SelectedMessageActions,
} from "../../../messages/state/useSelectedMessageStore";
import { useNotificationsPanelStore } from "../../../notifications/state/useNotificationsPanelStore";
import { useUnreadsPageStore } from "../../../unreads/state/useUnreadsPageStore";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { COMMAND_CATEGORIES } from "../commandCategories";
import { dispatchCommand } from "../commandDispatcher";
import { currentCommandContext } from "../commandContext";
import { LOCAL_COMMANDS } from "../localCommands";
import { CONVERSATION_COMMANDS, CONVERSATION_HANDLERS } from "./conversation";

const executeBackend = vi.fn();

function run(id: string) {
  const command = LOCAL_COMMANDS.find((c) => c.id === id)!;
  return dispatchCommand(command, executeBackend, { commandContext: currentCommandContext() });
}

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "conv-1",
    serverId: "ws-1",
    title: "general",
    conversationType: ConversationTypeEnum.CHANNEL,
    memberIds: [],
    topic: null,
    isPrivate: false,
    isArchived: false,
    archivedAt: null,
    memberCount: 1,
    isMember: true,
    createdBy: null,
    slowModeSeconds: 0,
    notificationLevel: null,
    effectiveNotificationLevel: "ALL",
    encryptedAt: null,
    pendingMemberIds: [],
    ...overrides,
  } as ConversationSummary;
}

function cache(c: ConversationSummary) {
  queryClient.setQueryData(queryKeys.conversations("ws-1"), {
    items: [c],
    pageInfo: { hasNext: false, hasPrev: false },
  });
}

function fakeActions(overrides: Partial<SelectedMessageActions> = {}): SelectedMessageActions {
  return {
    conversationId: "conv-1",
    textOf: vi.fn(() => ""),
    reply: vi.fn(() => true),
    edit: vi.fn(() => true),
    report: vi.fn(() => true),
    forward: vi.fn(() => true),
    deleteAttachment: vi.fn(() => true),
    select: vi.fn(() => true),
    toggleFold: vi.fn(() => true),
    ...overrides,
  };
}

function selectMessage() {
  useSelectedMessageStore
    .getState()
    .select({ workspaceId: "ws-1", conversationId: "conv-1", messageId: "msg-1" });
}

beforeEach(() => {
  vi.mocked(toast.info).mockClear();
  vi.mocked(detectPlatform).mockReturnValue("desktop");
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useShellStore.getState().setSelectedConversationId("conv-1");
});

afterEach(() => {
  useSelectedMessageStore.setState({ selection: null, actions: null });
  useInvitationActionsStore.getState().setActions(null);
  useUnreadsPageStore.getState().setControls(null);
  useConversationDialogStore.setState({ browseChannelsIn: null, agentWarningFor: null });
  useAgentEncryptedStore.setState({ allowed: {} });
  useNotificationsPanelStore.getState().setOpen(false);
  useLensStore.setState({ activeLenses: {}, lensPickerOpen: false });
  useWorkspaceStore.setState({ workspaceId: null });
  queryClient.clear();
  document.body.innerHTML = "";
});

describe("conversation app commands", () => {
  it("defines each with a built-in category and a handler, under a unique id", () => {
    const ids = CONVERSATION_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of CONVERSATION_COMMANDS) {
      expect(COMMAND_CATEGORIES, command.id).toContain(command.category);
      expect(CONVERSATION_HANDLERS[command.id], command.id).toBeTypeOf("function");
      expect(LOCAL_COMMANDS).toContain(command);
    }
    expect(Object.keys(CONVERSATION_HANDLERS).sort()).toEqual([...ids].sort());
  });
});

describe("commands on the selected message", () => {
  const cases: [string, keyof SelectedMessageActions, string][] = [
    ["chat.start_reply", "reply", "You can't reply in this conversation"],
    ["chat.start_edit", "edit", "Only your own messages can be edited"],
    ["chat.forward_message", "forward", "This message can't be forwarded"],
    ["chat.delete_attachment", "deleteAttachment", "This message has no failed upload to delete"],
    ["chat.toggle_fold", "toggleFold", "This message does not fold"],
  ];

  it.each(cases)("%s acts on the selected message through the list", async (id, action) => {
    const actions = fakeActions();
    useSelectedMessageStore.setState({ actions });
    selectMessage();
    await run(id);
    expect(actions[action]).toHaveBeenCalledWith("msg-1");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each(cases)("%s says so when the list refuses", async (id, action, text) => {
    const actions = fakeActions({ [action]: vi.fn(() => false) });
    useSelectedMessageStore.setState({ actions });
    selectMessage();
    await run(id);
    expect(toast.info).toHaveBeenCalledWith(text);
  });

  it.each(cases)("%s asks for a selection when there is none", async (id, action) => {
    const actions = fakeActions();
    useSelectedMessageStore.setState({ actions });
    await run(id);
    expect(actions[action]).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Select a message first");
  });
});

describe("message selection commands", () => {
  it.each([
    ["chat.select_next_message", "next"],
    ["chat.select_previous_message", "previous"],
    ["chat.select_first_message", "first"],
    ["chat.select_last_message", "last"],
  ])("%s moves the list's selection", async (id, target) => {
    const actions = fakeActions();
    useSelectedMessageStore.setState({ actions });
    await run(id);
    expect(actions.select).toHaveBeenCalledWith(target);
  });

  it("asks for a conversation when no list is open", async () => {
    await run("chat.select_next_message");
    expect(toast.info).toHaveBeenCalledWith("Open a conversation first");
  });
});

describe("composer commands", () => {
  it("click the open composer's buttons, or say there is none", async () => {
    await run("chat.attach_file");
    expect(toast.info).toHaveBeenCalledTimes(1);
    const click = vi.fn();
    document.body.innerHTML =
      "<button data-composer-attach></button><button data-composer-emoji></button>";
    for (const el of document.querySelectorAll("button")) el.addEventListener("click", click);
    await run("chat.attach_file");
    await run("chat.insert_emoji");
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe("agents.allow_in_encrypted_conversation", () => {
  it("opens the warning for an encrypted conversation and never turns it on itself", async () => {
    cache(conversation({ encryptedAt: "2026-01-01T00:00:00Z" }));
    await run("agents.allow_in_encrypted_conversation");
    expect(useConversationDialogStore.getState().agentWarningFor).toBe("conv-1");
    expect(useAgentEncryptedStore.getState().allowed).toEqual({});
  });

  it("does not open it for a conversation that is not encrypted", async () => {
    cache(conversation());
    await run("agents.allow_in_encrypted_conversation");
    expect(useConversationDialogStore.getState().agentWarningFor).toBeNull();
    expect(toast.info).toHaveBeenCalled();
  });

  it("is refused outside the desktop app", async () => {
    vi.mocked(detectPlatform).mockReturnValue("web");
    cache(conversation({ encryptedAt: "2026-01-01T00:00:00Z" }));
    await run("agents.allow_in_encrypted_conversation");
    expect(useConversationDialogStore.getState().agentWarningFor).toBeNull();
  });
});

describe("Unreads commands", () => {
  it("say where they work when the page is not open", async () => {
    await run("unreads.mark_all_shown");
    await run("unreads.toggle_muted");
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith("This works on the Unreads page");
  });

  it("run the page's controls when it is open", async () => {
    const controls = {
      next: vi.fn(),
      previous: vi.fn(),
      markGroup: vi.fn(),
      open: vi.fn(),
      undo: vi.fn(),
      markAllShown: vi.fn(),
      toggleMuted: vi.fn(),
    };
    useUnreadsPageStore.getState().setControls(controls);
    await run("unreads.mark_all_shown");
    await run("unreads.toggle_muted");
    expect(controls.markAllShown).toHaveBeenCalledTimes(1);
    expect(controls.toggleMuted).toHaveBeenCalledTimes(1);
  });
});

describe("invitation commands", () => {
  it("ask for an invitation when the open conversation is not one", async () => {
    await run("chat.accept_invitation");
    await run("chat.decline_invitation");
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith("Open an invitation first");
  });

  it("answer the invitation on screen", async () => {
    const actions = { conversationId: "conv-1", accept: vi.fn(() => true), decline: vi.fn() };
    useInvitationActionsStore.getState().setActions(actions);
    await run("chat.accept_invitation");
    await run("chat.decline_invitation");
    expect(actions.accept).toHaveBeenCalledTimes(1);
    expect(actions.decline).toHaveBeenCalledTimes(1);
  });

  it("tell a device that is not ready to set up encryption", async () => {
    const actions = { conversationId: "conv-1", accept: vi.fn(() => false), decline: vi.fn() };
    useInvitationActionsStore.getState().setActions(actions);
    await run("chat.accept_invitation");
    expect(toast.info).toHaveBeenCalledWith("Set up this device for encryption to join");
  });
});

describe("lens commands", () => {
  it("refuse a conversation that is not a channel", async () => {
    cache(conversation({ conversationType: ConversationTypeEnum.DIRECT }));
    await run("chat.apply_lens");
    await run("chat.clear_lens");
    expect(useLensStore.getState().lensPickerOpen).toBe(false);
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith("Lenses are offered in channels");
  });

  it("open the picker and clear the applied lens in a channel", async () => {
    cache(conversation());
    await run("chat.apply_lens");
    expect(useLensStore.getState().lensPickerOpen).toBe(true);
    await run("chat.clear_lens");
    expect(toast.info).toHaveBeenCalledWith("No lens is applied here");
    useLensStore.getState().setActiveLens("conv-1", "lens-1");
    await run("chat.clear_lens");
    expect(useLensStore.getState().getActiveLens("conv-1")).toBeNull();
  });
});

describe("conversation dialogs and the inbox", () => {
  it("opens the invite picker only where people can be added", async () => {
    cache(conversation({ conversationType: ConversationTypeEnum.DIRECT }));
    await run("chat.open_invite");
    expect(toast.info).toHaveBeenCalledWith("You can't add people to this conversation");
  });

  it("opens the inbox for notifications.mark_read", async () => {
    await run("notifications.mark_read");
    expect(useNotificationsPanelStore.getState().open).toBe(true);
  });

  it("opens Browse channels for the open workspace", async () => {
    await run("chat.browse_channels");
    expect(useConversationDialogStore.getState().browseChannelsIn).toBe("ws-1");
  });
});
