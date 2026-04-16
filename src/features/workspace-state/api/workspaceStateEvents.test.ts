import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus } from "../../../core/events/eventBus";
import { BUS_EVENTS } from "../../../core/events/busEvents";
import type { WorkspaceStateChangedEvent, WorkspaceStateDeletedEvent } from "../../../core/events/busEvents";

describe("workspace state bus events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("WORKSPACE_STATE_CHANGED event is well-defined", () => {
    expect(BUS_EVENTS.WORKSPACE_STATE_CHANGED).toBe("workspaceState:changed");
  });

  it("WORKSPACE_STATE_DELETED event is well-defined", () => {
    expect(BUS_EVENTS.WORKSPACE_STATE_DELETED).toBe("workspaceState:deleted");
  });

  it("emits and receives WorkspaceStateChanged via event bus", () => {
    const handler = vi.fn();
    const unsub = eventBus.on<WorkspaceStateChangedEvent>(
      BUS_EVENTS.WORKSPACE_STATE_CHANGED,
      handler,
    );

    eventBus.emit<WorkspaceStateChangedEvent>(BUS_EVENTS.WORKSPACE_STATE_CHANGED, {
      workspaceId: "ws-1",
      key: "theme.mode",
      scope: "SERVER",
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      key: "theme.mode",
      scope: "SERVER",
    });

    unsub();
  });

  it("emits and receives WorkspaceStateDeleted via event bus", () => {
    const handler = vi.fn();
    const unsub = eventBus.on<WorkspaceStateDeletedEvent>(
      BUS_EVENTS.WORKSPACE_STATE_DELETED,
      handler,
    );

    eventBus.emit<WorkspaceStateDeletedEvent>(BUS_EVENTS.WORKSPACE_STATE_DELETED, {
      workspaceId: "ws-1",
      key: "old.key",
      scope: "USER",
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      key: "old.key",
      scope: "USER",
    });

    unsub();
  });

  it("unsubscribe stops receiving events", () => {
    const handler = vi.fn();
    const unsub = eventBus.on<WorkspaceStateChangedEvent>(
      BUS_EVENTS.WORKSPACE_STATE_CHANGED,
      handler,
    );

    unsub();

    eventBus.emit<WorkspaceStateChangedEvent>(BUS_EVENTS.WORKSPACE_STATE_CHANGED, {
      workspaceId: "ws-1",
      key: "k",
      scope: "SERVER",
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
