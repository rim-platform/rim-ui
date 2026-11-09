import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const members = vi.hoisted(() => [
  { userId: "u-sam", isBot: false },
  { userId: "u-alex", isBot: false },
  { userId: "me", isBot: false },
]);
const names: Record<string, string> = { "u-sam": "Sam", "u-alex": "Alex", me: "Me" };

vi.mock("../../workspaces/api/useServerMembers", () => ({
  useServerMembers: () => ({ data: members, isPending: false }),
}));
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { id: "me" } }),
}));
vi.mock("../../workspaces/hooks/useMemberLookup", () => ({
  useMemberLookup: () => ({
    resolve: (id: string) => ({ displayName: names[id] ?? id, handleView: null, avatarUrl: null }),
  }),
}));
vi.mock("./paletteTargets", () => ({
  useChannelTargets: () => ({
    items: [
      { id: "conv-general", serverId: "ws-1", label: "#general" },
      { id: "conv-ops", serverId: "ws-1", label: "#ops" },
    ],
    isPending: false,
  }),
}));
vi.mock("../../home/api/useHomeWorkspaces", () => ({
  useHomeWorkspaces: () => ({
    workspaces: [
      { id: "ws-1", label: "Acme", local: true },
      { id: "ws-2", label: "Side project", local: true },
    ],
    isPending: false,
  }),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { useCommandArgumentsStore } from "../state/useCommandArgumentsStore";
import type { CommandArgumentInfo } from "../types";
import { CommandArgumentsDialog } from "./CommandArgumentsDialog";

function argument(
  name: string,
  title: string,
  argumentType: CommandArgumentType,
  overrides: Partial<CommandArgumentInfo> = {},
): CommandArgumentInfo {
  return { name, title, description: "", argumentType, required: true, ...overrides };
}

/** Opens the dialog for `fields` and returns what it resolves to. */
function ask(fields: CommandArgumentInfo[], title = "Run It") {
  let answer!: Promise<Record<string, unknown> | null>;
  act(() => {
    answer = useCommandArgumentsStore
      .getState()
      .ask({ title, arguments: fields, workspaceId: "ws-1" });
  });
  return answer;
}

afterEach(() => {
  act(() => useCommandArgumentsStore.getState().cancel());
});

describe("CommandArgumentsDialog", () => {
  it("shows the command's title and a labelled field with its hint", () => {
    render(<CommandArgumentsDialog />);
    void ask(
      [
        argument("minutes", "Minutes", CommandArgumentType.INTEGER, {
          description: "How long, 1 to 43200.",
        }),
      ],
      "Timeout Member",
    );

    const dialog = screen.getByRole("dialog", { name: "Timeout Member" });
    const field = within(dialog).getByLabelText("Minutes");
    expect(field).toHaveAccessibleDescription("How long, 1 to 43200.");
  });

  it("focuses the first field, and Enter submits", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask([
      argument("reason", "Reason", CommandArgumentType.STRING),
      argument("note", "Note", CommandArgumentType.STRING, { required: false }),
    ]);

    expect(screen.getByLabelText("Reason")).toHaveFocus();
    await user.keyboard("spam{Enter}");

    await expect(answer).resolves.toEqual({ reason: "spam" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reaches every field and button with Tab", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    void ask([
      argument("reason", "Reason", CommandArgumentType.STRING),
      argument("silent", "Silent", CommandArgumentType.BOOLEAN),
    ]);

    await user.tab();
    expect(screen.getByLabelText("Silent")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Run" })).toHaveFocus();
  });

  it("keeps the form open and names the problem when a field is wrong", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask([argument("minutes", "Minutes", CommandArgumentType.INTEGER)]);

    await user.click(screen.getByRole("button", { name: "Run" }));
    const field = screen.getByLabelText("Minutes");
    expect(field).toHaveAccessibleDescription("Minutes is required");
    expect(field).toHaveAttribute("aria-invalid", "true");

    await user.type(field, "1.5{Enter}");
    expect(field).toHaveAccessibleDescription("Enter a whole number");

    await user.clear(field);
    await user.type(field, "10{Enter}");
    await expect(answer).resolves.toEqual({ minutes: 10 });
  });

  it("runs nothing on Escape or Cancel", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const first = ask([argument("reason", "Reason", CommandArgumentType.STRING)]);
    await user.keyboard("{Escape}");
    await expect(first).resolves.toBeNull();

    const second = ask([argument("reason", "Reason", CommandArgumentType.STRING)]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBeNull();
  });

  it("prefills defaults, shows enum values as labels and submits a checkbox on Enter", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask([
      argument("level", "Level", CommandArgumentType.ENUM, {
        allowedValues: ["all", "mentions", "none"],
        defaultValue: "mentions",
      }),
      argument("ratio", "Ratio", CommandArgumentType.FLOAT, { defaultValue: 0.5 }),
      argument("threads", "Threads", CommandArgumentType.BOOLEAN, { defaultValue: true }),
    ]);

    const level = screen.getByLabelText("Level");
    expect(level).toHaveValue("mentions");
    expect(
      within(level)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All", "Mentions", "None"]);
    expect(screen.getByLabelText("Ratio")).toHaveValue("0.5");
    expect(screen.getByLabelText("Threads")).toBeChecked();

    await user.selectOptions(level, "none");
    await user.click(screen.getByLabelText("Threads"));
    await user.keyboard("{Enter}");
    await expect(answer).resolves.toEqual({ level: "none", ratio: 0.5, threads: false });
  });

  it("picks a member by searching the workspace's members", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask([argument("user_id", "Member", CommandArgumentType.USER_ID)]);

    const search = screen.getByLabelText("Member");
    await vi.waitFor(() => expect(search).toHaveFocus());
    expect(screen.queryByRole("option", { name: /Me/ })).toBeNull();
    await user.keyboard("sam{Enter}");
    expect(screen.getByRole("option", { name: /Sam/ })).toHaveAttribute("aria-selected", "true");
    // Enter on an empty search with a member picked runs the form.
    await user.keyboard("{Enter}");
    await expect(answer).resolves.toEqual({ user_id: "u-sam" });
  });

  it("picks a conversation and a workspace from their lists", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask([
      argument("server_id", "Workspace", CommandArgumentType.WORKSPACE_ID),
      argument("conversation_id", "Channel", CommandArgumentType.CONVERSATION_ID),
    ]);

    await user.selectOptions(screen.getByLabelText("Workspace"), "Side project");
    await user.selectOptions(screen.getByLabelText("Channel"), "#ops");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await expect(answer).resolves.toEqual({ server_id: "ws-2", conversation_id: "conv-ops" });
  });
});
