import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../shell/state/useShellStore", () => {
  const mockSetSelectedConversationId = vi.fn();
  return {
    useShellStore: Object.assign(vi.fn(), {
      getState: () => ({
        setSelectedConversationId: mockSetSelectedConversationId,
      }),
      setState: vi.fn(),
      subscribe: vi.fn(),
      __mockSetSelectedConversationId: mockSetSelectedConversationId,
    }),
  };
});

import { useWorkspaceStore } from "./useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";

describe("useWorkspaceStore (extra)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    vi.clearAllMocks();
  });

  it("starts with null workspaceId", () => {
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it("setWorkspaceId updates the workspace", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
  });

  it("setWorkspaceId resets selected conversation", () => {
    const mockFn = (
      useShellStore as unknown as { __mockSetSelectedConversationId: ReturnType<typeof vi.fn> }
    ).__mockSetSelectedConversationId;
    useWorkspaceStore.getState().setWorkspaceId("ws-2");
    expect(mockFn).toHaveBeenCalledWith(null);
  });

  it("clearWorkspaceId sets to null", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useWorkspaceStore.getState().clearWorkspaceId();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it("can switch workspaces", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    useWorkspaceStore.getState().setWorkspaceId("ws-2");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
  });
});
