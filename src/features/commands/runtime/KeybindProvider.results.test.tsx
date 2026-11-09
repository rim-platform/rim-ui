import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceLocalKeybinds: true } }),
}));

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({
    data: [
      {
        id: "kb-1",
        keystroke: "Ctrl+Alt+S",
        commandId: "chat.search_messages",
        context: "GLOBAL",
        source: "USER",
        scope: "USER",
        isEnabled: true,
        presetArgs: { query: "deploy" },
      },
    ],
  })),
}));

vi.mock("../api/useCommands", () => ({
  // The command lists are still loading, so a keybind runs through its stand-in command.
  useCommands: vi.fn(() => ({ data: undefined })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("./commandDispatcher", () => ({
  dispatchCommand: vi.fn(),
  hasLocalHandler: () => false,
  isLocalActionResult: () => false,
}));

vi.mock("../../plugins/chat/appMessageService", () => ({
  conversationEncrypted: vi.fn(async () => false),
  chatCache: () => null,
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { KeybindProvider } from "./KeybindProvider";
import { CommandResultView } from "../components/CommandResultView";
import { dispatchCommand } from "./commandDispatcher";
import { toast } from "../../../shared/toast";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useCommandResultStore } from "../state/useCommandResultStore";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

function press(key = "p") {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, ctrlKey: true, altKey: true, bubbles: true }),
  );
}

function bind(commandId: string) {
  useDeviceKeybindStore.setState({ keybinds: [] });
  useDeviceKeybindStore.getState().add({ keystroke: "Ctrl+Alt+P", commandId, context: "GLOBAL" });
}

describe("KeybindProvider with a read command bound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommandResultStore.getState().dismiss();
    useSearchOverlayStore.getState().close();
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  it("shows the channels the command lists", async () => {
    bind("chat.list_channels");
    vi.mocked(dispatchCommand).mockResolvedValue({
      status: "SUCCESS",
      message: "1 channels found",
      payload: { channels: [{ id: "c1", title: "general", conversation_type: "CHANNEL" }] },
      followUpCommands: [],
    });
    render(
      <KeybindProvider>
        <CommandResultView />
      </KeybindProvider>,
    );
    press();

    expect(await screen.findByText("general")).toBeInTheDocument();
  });

  it("retries where the key was pressed, after the person moved to another workspace", async () => {
    useWorkspaceStore.setState({ workspaceId: "workspace-a" });
    bind("chat.list_channels");
    vi.mocked(dispatchCommand).mockRejectedValue(
      Object.assign(new Error("dump"), {
        response: {
          errors: [
            {
              message: "Upstream timed out",
              extensions: { code: "TIMEOUT", refusal: "FAILED", retrySafe: true },
            },
          ],
        },
      }),
    );
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    press();
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalled());

    useWorkspaceStore.setState({ workspaceId: "workspace-b" });
    vi.mocked(toast.warning).mock.calls[0][1]?.action?.onClick();

    await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(2));
    const contextOf = (call: number) =>
      vi.mocked(dispatchCommand).mock.calls[call][2]?.commandContext;
    expect(contextOf(1)).toEqual(contextOf(0));
    expect(contextOf(1)?.workspaceId).toBe("workspace-a");
  });

  it("says a refused command was not done instead of failing silently", async () => {
    bind("chat.list_channels");
    vi.mocked(dispatchCommand).mockRejectedValue(
      Object.assign(new Error("dump"), {
        response: {
          errors: [
            {
              message: "Only moderators can do this",
              extensions: { code: "FORBIDDEN", refusal: "DENIED" },
            },
          ],
        },
      }),
    );
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    press();

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("chat.list_channels: not done", {
        card: "denied",
        description: "Only moderators can do this",
      }),
    );
  });

  it("opens the search overlay on the query a search keybind carries", () => {
    useDeviceKeybindStore.setState({ keybinds: [] });
    render(
      <KeybindProvider>
        <div />
      </KeybindProvider>,
    );
    press("s");

    expect(useSearchOverlayStore.getState()).toMatchObject({
      isOpen: true,
      query: "deploy",
      scope: { kind: "all" },
    });
    expect(dispatchCommand).not.toHaveBeenCalled();
  });
});
