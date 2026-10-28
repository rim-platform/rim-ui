import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../conversations/state/directSelection", () => ({
  selectDirectConversation: vi.fn(),
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { useRecentActivityStore } from "../../conversations/state/useRecentActivityStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { cycleRecentActivity, resetRecentActivityWalk } from "./cycleRecentActivity";

function post(workspaceId: string, conversationId: string, threadId: string | null = null) {
  useRecentActivityStore.getState().record({
    workspaceId,
    conversationId,
    threadId,
    authorId: "u-2",
  });
}

const selected = () => useShellStore.getState().selectedConversationId;

describe("cycleRecentActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    vi.clearAllMocks();
    useRecentActivityStore.getState().reset();
    resetRecentActivityWalk();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("jumps to the newest place, then further back while runs stay close", () => {
    post("ws-1", "a");
    post("ws-1", "b");
    post("ws-1", "c");
    cycleRecentActivity();
    expect(selected()).toBe("c");
    vi.advanceTimersByTime(4000);
    cycleRecentActivity();
    expect(selected()).toBe("b");
    vi.advanceTimersByTime(4000);
    cycleRecentActivity();
    expect(selected()).toBe("a");
  });

  it("starts at the newest again after a pause of 5 seconds", () => {
    post("ws-1", "a");
    post("ws-1", "b");
    post("ws-1", "c");
    cycleRecentActivity();
    vi.advanceTimersByTime(1000);
    cycleRecentActivity();
    expect(selected()).toBe("b");
    vi.advanceTimersByTime(5000);
    cycleRecentActivity();
    expect(selected()).toBe("c");
  });

  it("starts at the newest again when a message arrived", () => {
    post("ws-1", "a");
    post("ws-1", "b");
    cycleRecentActivity();
    post("ws-1", "x");
    vi.advanceTimersByTime(1000);
    cycleRecentActivity();
    expect(selected()).toBe("x");
  });

  it("skips the place the user is in", () => {
    post("ws-1", "a");
    post("ws-1", "b");
    useShellStore.getState().setSelectedConversationId("b");
    cycleRecentActivity();
    expect(selected()).toBe("a");
  });

  it("says so when there is nowhere else to go", () => {
    cycleRecentActivity();
    expect(toast.info).toHaveBeenCalledWith("No recent activity", expect.anything());

    post("ws-1", "a");
    useShellStore.getState().setSelectedConversationId("a");
    vi.advanceTimersByTime(10_000);
    cycleRecentActivity();
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(selected()).toBe("a");
  });

  it("switches to another workspace first", () => {
    post("ws-2", "z");
    cycleRecentActivity();
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
    expect(selected()).toBe("z");
  });

  it("opens a direct conversation through the direct selection", () => {
    useRelayStore.setState({
      spaces: { "dm-space": { kind: "direct" } },
    } as unknown as Partial<ReturnType<typeof useRelayStore.getState>>);
    post("dm-space", "dm-1");
    cycleRecentActivity();
    expect(selectDirectConversation).toHaveBeenCalledWith("dm-space", "dm-1");
    useRelayStore.setState({ spaces: {} });
  });

  it("opens the thread of a thread entry", () => {
    queryClient.setQueryData(queryKeys.threadByRoot("ws-1", "a", "root-1"), {
      id: "t-1",
      rootMessageId: "root-1",
    });
    post("ws-1", "a", "t-1");
    cycleRecentActivity();
    expect(selected()).toBe("a");
    expect(useShellStore.getState().selectedRootMessageId).toBe("root-1");
    expect(useShellStore.getState().isThreadOpen).toBe(true);
  });

  it("opens only the conversation when the thread's root is not known", () => {
    post("ws-1", "a", "t-9");
    cycleRecentActivity();
    expect(selected()).toBe("a");
    expect(useShellStore.getState().isThreadOpen).toBe(false);
  });
});
