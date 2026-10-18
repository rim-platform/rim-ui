import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { ResolvedKeybind } from "../types";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceLocalKeybinds: true } }),
}));

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({ data: SERVER_KEYBINDS })),
}));

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [] })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("./commandDispatcher", () => ({
  dispatchCommand: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { KeybindProvider } from "./KeybindProvider";
import { dispatchCommand } from "./commandDispatcher";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";

/** A workspace binding of Ctrl+Alt+L to `notifications.set_level` with a preset level. */
const SERVER_KEYBINDS: ResolvedKeybind[] = [
  {
    id: "kb-1",
    keystroke: "Ctrl+Alt+L",
    commandId: "notifications.set_level",
    context: "GLOBAL",
    source: "WORKSPACE",
    scope: "WORKSPACE",
    isEnabled: true,
    presetArgs: { level: "mentions" },
  },
];

function pressCtrlAltL() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "l", ctrlKey: true, altKey: true, bubbles: true }),
  );
}

function renderProvider() {
  render(
    <KeybindProvider>
      <div />
    </KeybindProvider>,
  );
}

describe("KeybindProvider command context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDeviceKeybindStore.setState({ keybinds: [] });
    vi.mocked(dispatchCommand).mockResolvedValue(null);
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  afterEach(() => {
    useWorkspaceStore.getState().clearWorkspaceId();
    useShellStore.getState().reset();
    queryClient.clear();
  });

  it("sends the open conversation and thread with the binding's preset arguments", () => {
    useShellStore.getState().setSelectedConversationId("conv-9");
    useShellStore.getState().openThreadForMessage("msg-root-1");
    queryClient.setQueryData(queryKeys.threadByRoot("ws-1", "conv-9", "msg-root-1"), {
      id: "thread-1",
    });
    renderProvider();
    pressCtrlAltL();

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    const [command, , options] = vi.mocked(dispatchCommand).mock.calls[0];
    expect(command.id).toBe("notifications.set_level");
    expect(options).toEqual({
      args: { level: "mentions" },
      commandContext: { workspaceId: "ws-1", conversationId: "conv-9", threadId: "thread-1" },
    });
  });

  it("sends only the workspace when no conversation is open", () => {
    renderProvider();
    pressCtrlAltL();

    expect(vi.mocked(dispatchCommand).mock.calls[0][2]?.commandContext).toEqual({
      workspaceId: "ws-1",
    });
  });

  it("reads the conversation opened after the provider rendered", () => {
    renderProvider();
    useShellStore.getState().setSelectedConversationId("conv-2");
    pressCtrlAltL();

    expect(vi.mocked(dispatchCommand).mock.calls[0][2]?.commandContext).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-2",
    });
  });
});
