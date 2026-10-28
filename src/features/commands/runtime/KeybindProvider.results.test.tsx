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
  useCommands: vi.fn(() => ({ data: [] })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("./commandDispatcher", () => ({
  dispatchCommand: vi.fn(),
}));

vi.mock("../../plugins/chat/appMessageService", () => ({
  conversationEncrypted: vi.fn(async () => false),
  chatCache: () => null,
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { KeybindProvider } from "./KeybindProvider";
import { CommandResultView } from "../components/CommandResultView";
import { dispatchCommand } from "./commandDispatcher";
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
