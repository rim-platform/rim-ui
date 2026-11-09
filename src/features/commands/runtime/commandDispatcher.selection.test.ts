import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import { useLensStore } from "../../lenses/state/useLensStore";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import {
  useSelectedMessageStore,
  type SelectedMessageActions,
} from "../../messages/state/useSelectedMessageStore";
import { useUnreadsPageStore } from "../../unreads/state/useUnreadsPageStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { CommandDefinition } from "../types";
import { dispatchCommand, runDesktopLocalCommand } from "./commandDispatcher";
import { currentCommandContext } from "./commandContext";
import { LOCAL_COMMANDS } from "./localCommands";

function command(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: false,
    visibleInContextMenus: true,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

const ON_SELECTED_MESSAGE = ["workspace", "conversation", "selected_message"];

const executeBackend = vi.fn(async () => ({
  executeCommand: { status: "SUCCESS" as const, message: "", payload: null, followUpCommands: [] },
}));

/** Runs `cmd` as a keybind does, in the context of the open conversation. */
function run(cmd: CommandDefinition, args?: Record<string, unknown>) {
  return dispatchCommand(cmd, executeBackend, { args, commandContext: currentCommandContext() });
}

function fakeActions(overrides: Partial<SelectedMessageActions> = {}): SelectedMessageActions {
  return {
    conversationId: "conv-1",
    textOf: vi.fn((id: string) => (id === "msg-1" ? "deploy is done" : null)),
    reply: vi.fn(() => true),
    edit: vi.fn(() => true),
    report: vi.fn(() => true),
    ...overrides,
  };
}

function selectMessage() {
  useSelectedMessageStore
    .getState()
    .select({ workspaceId: "ws-1", conversationId: "conv-1", messageId: "msg-1" });
}

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  executeBackend.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useShellStore.getState().setSelectedConversationId("conv-1");
});

afterEach(() => {
  useSelectedMessageStore.setState({ selection: null, actions: null });
  useUnreadsPageStore.getState().setControls(null);
  useLensStore.getState().setLensPickerOpen(false);
  useWorkspaceStore.setState({ workspaceId: null });
  queryClient.clear();
  document.body.innerHTML = "";
});

describe("commands on the selected message", () => {
  it("copies the selected message's text and says so", async () => {
    useSelectedMessageStore.getState().setActions(fakeActions());
    selectMessage();

    await run(command("chat.copy_message_text"));

    expect(writeText).toHaveBeenCalledWith("deploy is done");
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied to clipboard"));
  });

  it("asks for a message to copy when none is selected", async () => {
    useSelectedMessageStore.getState().setActions(fakeActions());

    await run(command("chat.copy_message_text"));

    expect(writeText).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Select a message first");
  });

  it("opens the selected message's thread, and the one an argument names", async () => {
    selectMessage();
    await run(command("chat.open_thread"));
    expect(useShellStore.getState().selectedRootMessageId).toBe("msg-1");

    await run(command("chat.open_thread"), { root_message_id: "msg-9" });
    expect(useShellStore.getState().selectedRootMessageId).toBe("msg-9");
  });

  it("leaves the selected message out of a run for the agent", () => {
    selectMessage();

    runDesktopLocalCommand("chat.open_thread");
    expect(useShellStore.getState().selectedRootMessageId).toBeNull();
    runDesktopLocalCommand("chat.open_thread", { root_message_id: "msg-9" });
    expect(useShellStore.getState().selectedRootMessageId).toBe("msg-9");
  });

  it("asks for a message when Open Thread has neither a selection nor an argument", async () => {
    await run(command("chat.open_thread"));

    expect(useShellStore.getState().selectedRootMessageId).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("Select a message first");
  });

  it.each([
    ["chat.reply_to_selected_message", "reply"],
    ["chat.edit_message", "edit"],
    ["chat.report_message", "report"],
  ] as const)("%s acts on the selected message through the list", async (id, action) => {
    const actions = fakeActions();
    useSelectedMessageStore.getState().setActions(actions);
    selectMessage();

    const result = await run(
      command(id, { executionTarget: "BACKEND", requiredContext: ON_SELECTED_MESSAGE }),
    );

    expect(actions[action]).toHaveBeenCalledWith("msg-1");
    expect(result?.status).toBe("SUCCESS");
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it.each([
    ["chat.reply_to_selected_message", "reply", "You can't reply in this conversation"],
    ["chat.edit_message", "edit", "Only your own messages can be edited"],
    ["chat.report_message", "report", "Your own messages can't be reported"],
  ] as const)("%s says why the list refused it", async (id, action, message) => {
    useSelectedMessageStore.getState().setActions(fakeActions({ [action]: vi.fn(() => false) }));
    selectMessage();

    await run(command(id, { executionTarget: "BACKEND", requiredContext: ON_SELECTED_MESSAGE }));

    expect(toast.info).toHaveBeenCalledWith(message);
  });

  it.each(["chat.reply_to_selected_message", "chat.edit_message", "chat.report_message"])(
    "%s asks for a message when none is selected",
    async (id) => {
      useSelectedMessageStore.getState().setActions(fakeActions());

      await run(command(id, { executionTarget: "BACKEND", requiredContext: ON_SELECTED_MESSAGE }));

      expect(toast.info).toHaveBeenCalledWith("Select a message first");
      expect(executeBackend).not.toHaveBeenCalled();
    },
  );

  it("sends Delete Message to the server with the selected message", async () => {
    selectMessage();

    await run(
      command("chat.delete_message", {
        executionTarget: "BACKEND",
        requiredContext: ON_SELECTED_MESSAGE,
      }),
    );

    expect(executeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "chat.delete_message",
        commandContext: expect.objectContaining({ selectedMessageId: "msg-1" }),
      }),
    );
  });

  it("keeps a server command on the selected message from the server without one", async () => {
    const result = await run(
      command("chat.delete_message", {
        executionTarget: "BACKEND",
        requiredContext: ON_SELECTED_MESSAGE,
      }),
    );

    expect(result).toMatchObject({ status: "ERROR", message: "Select a message first" });
    expect(executeBackend).not.toHaveBeenCalled();
  });
});

describe("the Unreads commands off the Unreads page", () => {
  it.each(["workspace.unreads_next", "workspace.unreads_previous", "workspace.unreads_open"])(
    "%s opens the Unreads page",
    async (id) => {
      await run(command(id));
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "unreads" });
    },
  );

  it.each(["workspace.unreads_mark_group", "workspace.unreads_undo"])(
    "%s says where it works",
    async (id) => {
      await run(command(id));
      expect(toast.info).toHaveBeenCalledWith("This works on the Unreads page");
      expect(useShellStore.getState().mainSurface).not.toEqual({ kind: "unreads" });
    },
  );

  it("runs on the page while it is open", async () => {
    const controls = {
      next: vi.fn(),
      previous: vi.fn(),
      markGroup: vi.fn(),
      open: vi.fn(),
      undo: vi.fn(),
    };
    useUnreadsPageStore.getState().setControls(controls);

    await run(command("workspace.unreads_next"));
    await run(command("workspace.unreads_undo"));

    expect(controls.next).toHaveBeenCalledTimes(1);
    expect(controls.undo).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("focus commands", () => {
  it.each(["workspace.focus_composer", "workspace.focus_message_list"])(
    "%s says to open a conversation when none is shown",
    async (id) => {
      await run(command(id));
      expect(toast.info).toHaveBeenCalledWith("Open a conversation first");
    },
  );

  it("focuses the composer when one is shown", async () => {
    document.body.innerHTML = '<textarea data-composer-input aria-label="Composer"></textarea>';

    await run(command("workspace.focus_composer"));

    expect(document.activeElement).toBe(document.querySelector("[data-composer-input]"));
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("Toggle Channel Lenses", () => {
  const lensCommand = LOCAL_COMMANDS.find((cmd) => cmd.id === "workspace.toggle_lens_picker")!;

  it("is one of this app's commands, named after the lens button", () => {
    expect(lensCommand).toMatchObject({ title: "Toggle Channel Lenses", category: "Workspace" });
  });

  it("opens and closes the open channel's lens picker", async () => {
    await run(lensCommand);
    expect(useLensStore.getState().lensPickerOpen).toBe(true);
    await run(lensCommand);
    expect(useLensStore.getState().lensPickerOpen).toBe(false);
  });

  it("says to open a conversation when none is open", async () => {
    useShellStore.getState().setSelectedConversationId(null);

    await run(lensCommand);

    expect(useLensStore.getState().lensPickerOpen).toBe(false);
    expect(toast.info).toHaveBeenCalledWith("Open a conversation first");
  });

  it("says lenses are for channels in a direct message", async () => {
    queryClient.setQueryData(queryKeys.conversations("ws-1"), {
      items: [{ id: "conv-1", conversationType: "DIRECT" }],
      pageInfo: { hasNext: false, hasPrev: false },
    });

    await run(lensCommand);

    expect(useLensStore.getState().lensPickerOpen).toBe(false);
    expect(toast.info).toHaveBeenCalledWith("Lenses are offered in channels");
  });
});

describe("arguments typed in the message box", () => {
  const createChannel = command("chat.create_channel", { executionTarget: "BACKEND" });

  it("send a backend command with a dialog of its own to the server", async () => {
    await dispatchCommand(createChannel, executeBackend, {
      args: { name: "ops" },
      commandContext: currentCommandContext(),
      typedArgs: true,
    });

    expect(executeBackend).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: "chat.create_channel", args: { name: "ops" } }),
    );
    expect(useShellStore.getState().showNewChannelDialog).toBe(false);
  });

  it("leave the dialog to a run without them", async () => {
    await dispatchCommand(createChannel, executeBackend, {
      commandContext: currentCommandContext(),
      typedArgs: true,
    });

    expect(executeBackend).not.toHaveBeenCalled();
    expect(useShellStore.getState().showNewChannelDialog).toBe(true);
  });

  it("are not sent to the server from a keybind's preset arguments", async () => {
    await dispatchCommand(createChannel, executeBackend, {
      args: { name: "ops" },
      commandContext: currentCommandContext(),
    });

    expect(executeBackend).not.toHaveBeenCalled();
    expect(useShellStore.getState().showNewChannelDialog).toBe(true);
  });

  it("reach a desktop-local handler as its arguments", async () => {
    await dispatchCommand(command("chat.open_thread"), executeBackend, {
      args: { root_message_id: "msg-5" },
      commandContext: currentCommandContext(),
      typedArgs: true,
    });

    expect(useShellStore.getState().selectedRootMessageId).toBe("msg-5");
    expect(executeBackend).not.toHaveBeenCalled();
  });
});

describe("the confirmation dialog", () => {
  it("names a server command by this app's title", async () => {
    executeBackend.mockResolvedValueOnce({
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "Confirm it",
        payload: null,
        followUpCommands: [],
        confirmationRequired: {
          token: "t",
          argsHash: "h",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    } as never);
    const running = dispatchCommand(
      command("chat.create_group", { title: "Create Group", executionTarget: "BACKEND" }),
      executeBackend,
      { args: { member_ids: "u-2" }, commandContext: currentCommandContext(), typedArgs: true },
    );

    await vi.waitFor(() =>
      expect(useConfirmationModalStore.getState().request?.toolName).toBe("New Message"),
    );
    useConfirmationModalStore.getState().reject();
    await running;
  });
});
