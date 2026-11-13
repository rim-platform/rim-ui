import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { boxKind } from "./registry";
import { GettingStartedBody } from "./GettingStartedBox";

const run = vi.hoisted(() => vi.fn());
vi.mock("../../commands/runtime/runFromClick", () => ({
  runCommandFromClick: (...args: unknown[]) => run(...args),
}));

const facts = vi.hoisted(() => ({
  desktop: false,
  moderator: false,
  channels: [] as { id: string; isArchived: boolean }[],
}));
vi.mock("../../agent/agentAvailability", () => ({ agentAvailable: () => facts.desktop }));
vi.mock("../../bots/availability", () => ({ useCanManageBots: () => facts.moderator }));
vi.mock("../../conversations/api/useChannels", () => ({
  useJoinedChannels: () => ({ data: { items: facts.channels } }),
}));

function titles(): string[] {
  return screen.getAllByRole("listitem").map((row) => row.querySelector("span")!.textContent!);
}

describe("the Getting started box", () => {
  beforeEach(() => {
    run.mockReset();
    facts.desktop = false;
    facts.moderator = false;
    facts.channels = [
      { id: "c-old", isArchived: true },
      { id: "c-general", isArchived: false },
      { id: "c-random", isArchived: false },
    ];
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  it("is the first kind, one per Home, with no settings", () => {
    const kind = boxKind("start")!;
    expect(kind.name).toBe("Getting started");
    expect(kind.multiple).toBe(false);
    expect(kind.settingsReadable).toBeUndefined();
    expect(kind.unavailableReason()).toBeNull();
  });

  it("shows a member on the web the rows everyone can use", () => {
    render(<GettingStartedBody />);
    expect(titles()).toEqual([
      "Say hello",
      "Run anything with Ctrl+K",
      "Catch up on Unreads",
      "Add a tool beside the conversation",
      "Make Home yours",
    ]);
  });

  it("adds the webhook row for a moderator and the assistant and agent rows on desktop", () => {
    facts.moderator = true;
    facts.desktop = true;
    render(<GettingStartedBody />);
    expect(titles()).toEqual([
      "Say hello",
      "Run anything with Ctrl+K",
      "Catch up on Unreads",
      "Add a tool beside the conversation",
      "Bring alerts into a channel",
      "Ask the assistant",
      "Connect an agent",
      "Make Home yours",
    ]);
  });

  it("leaves out Say hello where the workspace has no channel", () => {
    facts.channels = [{ id: "c-old", isArchived: true }];
    render(<GettingStartedBody />);
    expect(titles()[0]).toBe("Run anything with Ctrl+K");
  });

  it("runs each row's command", async () => {
    facts.moderator = true;
    facts.desktop = true;
    const user = userEvent.setup();
    render(<GettingStartedBody />);
    const expected: [string, string, unknown?][] = [
      ["Say hello", "workspace.navigate_to_channel", { conversationId: "c-general" }],
      ["Run anything with Ctrl+K", "workspace.open_command_palette"],
      ["Catch up on Unreads", "workspace.open_unreads"],
      ["Add a tool beside the conversation", "settings.open.plugins"],
      ["Bring alerts into a channel", "settings.open.bots"],
      ["Ask the assistant", "settings.open.agent"],
      ["Connect an agent", "settings.open.agents"],
      ["Make Home yours", "workspace.edit_home"],
    ];
    for (const [title, commandId, args] of expected) {
      run.mockClear();
      await user.click(screen.getByText(title).closest("button")!);
      expect(run).toHaveBeenCalledWith(commandId, args);
    }
  });

  it("offers I'm done with this only where the box can be removed", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<GettingStartedBody />);
    expect(screen.queryByRole("button", { name: "I'm done with this" })).not.toBeInTheDocument();
    rerender(<GettingStartedBody onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "I'm done with this" }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
