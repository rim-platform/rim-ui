import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const served = vi.hoisted(() => ({
  members: [] as Record<string, unknown>[],
  macros: [] as { id: string; name: string }[],
  pipelines: [] as { id: string; name: string; enabled: boolean }[],
}));

vi.mock("../../workspaces/api/useServerMembers", () => ({
  fetchServerMembers: vi.fn(async () => []),
  useServerMembers: () => ({ data: served.members, isPending: false }),
}));
vi.mock("../../macros/api/useMacros", () => ({
  useMyMacros: () => ({ data: served.macros, isPending: false }),
}));
vi.mock("../../pipelines/api/usePipelines", () => ({
  usePipelines: () => ({ data: served.pipelines, isPending: false }),
}));
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: undefined }),
}));

import { queryClient } from "../../../core/query/queryClient";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { TargetPickerKind } from "../state/useCommandStore";
import { PaletteTargetPicker } from "./PaletteTargetPicker";

function renderPicker(kind: TargetPickerKind) {
  const onPick = vi.fn();
  const onBack = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <PaletteTargetPicker kind={kind} onPick={onPick} onBack={onBack} />
    </QueryClientProvider>,
  );
  return { onPick, onBack, field: screen.getByRole("textbox") };
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useAuthStore.setState({ session: { userId: "me" } as never });
  served.members = [
    { userId: "me", username: "me", displayName: "Me" },
    { userId: "u-1", username: "ana", displayName: "Ana" },
    { userId: "u-2", username: "bot", displayName: "Helper", isBot: true },
    { userId: "u-3", username: "cy", displayName: null },
  ];
  served.macros = [
    { id: "m-1", name: "Standup" },
    { id: "m-2", name: "Wrap up" },
  ];
  served.pipelines = [
    { id: "p-1", name: "Triage", enabled: true },
    { id: "p-2", name: "Digest", enabled: false },
  ];
});

afterEach(() => {
  useWorkspaceStore.setState({ workspaceId: null });
  useAuthStore.setState({ session: null });
});

describe("the pickers of the general commands", () => {
  it("picks a member with the arrow keys and Enter", () => {
    const { onPick, field } = renderPicker("member");
    expect(screen.getAllByRole("option")).toHaveLength(4);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "u-2", serverId: "ws-1", label: "Helper" });
  });

  it("offers only people who can be messaged", () => {
    const { onPick, field } = renderPicker("messageableMember");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ana", "cy"]);
    fireEvent.change(field, { target: { value: "cy" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "u-3", serverId: "ws-1", label: "cy" });
  });

  it("picks a macro by searching", () => {
    const { onPick, field } = renderPicker("macro");
    fireEvent.change(field, { target: { value: "wrap" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "m-2", serverId: "ws-1", label: "Wrap up" });
  });

  it("shows whether each pipeline is on, and picks one", () => {
    const { onPick, field } = renderPicker("pipeline");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Triage (on)",
      "Digest (off)",
    ]);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "p-2", serverId: "ws-1", label: "Digest (off)" });
  });

  it("goes back with Escape", () => {
    const { onBack, field } = renderPicker("macro");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onBack).toHaveBeenCalled();
  });
});
