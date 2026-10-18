import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useRunnableHere } from "./pluginContext";

describe("useRunnableHere", () => {
  afterEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("lets a conversation command run once a conversation is open", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    const { result } = renderHook(() => useRunnableHere());
    expect(result.current(["conversation"])).toBe(false);

    act(() => useShellStore.setState({ selectedConversationId: "conv-1" }));

    expect(result.current(["conversation"])).toBe(true);
    expect(result.current(["workspace"])).toBe(true);
  });

  it("never offers a message command, whose message only a context menu names", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    const { result } = renderHook(() => useRunnableHere());

    expect(result.current(["message"])).toBe(false);
  });

  it("offers a command that requires no context, or only kinds the host does not know", () => {
    const { result } = renderHook(() => useRunnableHere());

    expect(result.current([])).toBe(true);
    expect(result.current(["selected_pod"])).toBe(true);
    expect(result.current(["workspace"])).toBe(false);
  });
});
