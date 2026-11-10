import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const members = vi.hoisted(() => [
  { userId: "u-sam", isBot: false, memberRole: "MODERATOR" },
  { userId: "u-alex", isBot: false, memberRole: "GUEST" },
  { userId: "me", isBot: false, memberRole: "OWNER" },
]);
const names: Record<string, string> = { "u-sam": "Sam", "u-alex": "Alex", me: "Me" };
const conversation = vi.hoisted(() => vi.fn());
const posting = vi.hoisted(() => vi.fn());
const stateList = vi.hoisted(() => vi.fn());

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
vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: (...args: unknown[]) => conversation(...args),
}));
vi.mock("../../conversations/api/useChannelPosting", () => ({
  useChannelPosting: (...args: unknown[]) => posting(...args),
}));
vi.mock("../../workspace-state/api/useWorkspaceState", () => ({
  useWorkspaceStateList: (...args: unknown[]) => stateList(...args),
  useWorkspaceState: () => ({ data: undefined, isPending: false }),
}));
vi.mock("../../updater/hooks/useSpaceHasCapability", () => ({
  useSpaceHasCapability: () => true,
}));
vi.mock("./paletteTargets", () => ({
  useChannelTargets: () => ({
    items: [{ id: "conv-general", serverId: "ws-1", label: "#general" }],
    isPending: false,
  }),
  useJoinableTargets: () => ({ items: [], isPending: false }),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import {
  useCommandArgumentsStore,
  type ArgumentStepGroup,
  type CommandArgumentsRequest,
} from "../state/useCommandArgumentsStore";
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

const USER_ID = argument("user_id", "Member", CommandArgumentType.USER_ID);
const REASON = argument("reason", "Reason", CommandArgumentType.STRING, { required: false });
const NOTIFY = argument("notify", "Tell them", CommandArgumentType.BOOLEAN, { required: false });
const EXPIRES = argument("expires_at", "Expires", CommandArgumentType.STRING, { required: false });
const MINUTES = argument("minutes", "Minutes", CommandArgumentType.INTEGER, { required: false });
const DURATION = argument("duration", "Duration", CommandArgumentType.ENUM, {
  allowedValues: ["1h", "8h", "until_tomorrow", "forever", "until", "minutes"],
});
const UNTIL = argument("until", "Until", CommandArgumentType.STRING, { required: false });
const TOPIC = argument("topic", "Topic", CommandArgumentType.STRING);
const VALUE = argument("value", "Value", CommandArgumentType.STRING);

/** Opens the dialog for `request` and returns what it resolves to. */
function ask(request: Omit<CommandArgumentsRequest, "title">) {
  let answer!: Promise<Record<string, unknown> | null>;
  act(() => {
    answer = useCommandArgumentsStore
      .getState()
      .ask({ title: "Run It", workspaceId: "ws-1", ...request });
  });
  return answer;
}

beforeEach(() => {
  conversation.mockReset();
  conversation.mockReturnValue({ data: undefined });
  posting.mockReset();
  posting.mockReturnValue({ policy: "EVERYONE", allowsThreads: true, supported: false });
  stateList.mockReset();
  stateList.mockReturnValue({ data: [{ key: "counter", value: 41 }], isPending: false });
});

afterEach(() => {
  act(() => useCommandArgumentsStore.getState().cancel());
});

describe("More options", () => {
  it("folds the optional arguments and sends only those set", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask({
      commandId: "admin.ban",
      arguments: [USER_ID],
      moreArguments: [REASON, NOTIFY, EXPIRES, MINUTES],
    });

    const more = screen.getByRole("button", { name: "More options" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/Reason/)).toBeNull();
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Tell them")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Minutes/)).toBeNull();
    await user.type(screen.getByLabelText("Reason (optional)"), "spam");
    await user.selectOptions(screen.getByLabelText("Ban ends (optional)"), "For 7 days");

    await user.click(screen.getByLabelText("Member"));
    await user.keyboard("sam{Enter}");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await expect(answer).resolves.toEqual({
      user_id: "u-sam",
      reason: "spam",
      minutes: 7 * 24 * 60,
    });
  });

  it("opens again on a problem among them", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    void ask({ commandId: "admin.ban", arguments: [REASON], moreArguments: [EXPIRES, MINUTES] });

    const more = screen.getByRole("button", { name: "More options" });
    await user.click(more);
    await user.selectOptions(screen.getByLabelText("Ban ends (optional)"), "For a set length");
    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Ban ends (optional)")).toHaveAccessibleDescription(
      "Enter how long",
    );
  });

  it("shows no More options when the command has none", () => {
    render(<CommandArgumentsDialog />);
    void ask({ commandId: "admin.kick", arguments: [USER_ID] });
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
  });
});

describe("current values", () => {
  it("starts the slow mode, the notification level and the posting policy with theirs", async () => {
    conversation.mockReturnValue({
      data: { id: "conv-general", slowModeSeconds: 30, notificationLevel: "MENTIONS" },
    });
    posting.mockReturnValue({ policy: "MODERATORS", allowsThreads: true, supported: true });
    render(<CommandArgumentsDialog />);
    const slow = ask({
      commandId: "chat.set_slow_mode",
      conversationId: "conv-general",
      arguments: [argument("seconds", "Seconds", CommandArgumentType.INTEGER)],
    });
    await vi.waitFor(() => expect(screen.getByLabelText("Seconds")).toHaveValue("30"));
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await expect(slow).resolves.toEqual({ seconds: 30 });

    const level = ask({
      commandId: "notifications.set_level",
      conversationId: "conv-general",
      arguments: [
        argument("level", "Level", CommandArgumentType.ENUM, {
          allowedValues: ["all", "mentions", "none", "default"],
        }),
      ],
    });
    await vi.waitFor(() => expect(screen.getByLabelText("Level")).toHaveValue("mentions"));
    act(() => useCommandArgumentsStore.getState().cancel());
    await level;

    void ask({
      commandId: "chat.set_channel_posting",
      conversationId: "conv-general",
      arguments: [
        argument("policy", "Policy", CommandArgumentType.ENUM, {
          allowedValues: ["everyone", "moderators"],
        }),
      ],
    });
    await vi.waitFor(() => expect(screen.getByLabelText("Policy")).toHaveValue("moderators"));
    expect(conversation).toHaveBeenCalledWith("ws-1", "conv-general");
  });

  it("starts an unset notification level as the workspace default", async () => {
    conversation.mockReturnValue({
      data: { id: "conv-general", slowModeSeconds: 0, notificationLevel: null },
    });
    render(<CommandArgumentsDialog />);
    void ask({
      commandId: "notifications.set_level",
      conversationId: "conv-general",
      arguments: [
        argument("level", "Level", CommandArgumentType.ENUM, {
          allowedValues: ["all", "mentions", "none", "default"],
        }),
      ],
    });
    await vi.waitFor(() => expect(screen.getByLabelText("Level")).toHaveValue("default"));
  });

  it("shows the picked member's role without choosing one", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    void ask({
      commandId: "admin.set_role",
      arguments: [
        USER_ID,
        argument("role", "Role", CommandArgumentType.ENUM, {
          allowedValues: ["moderator", "member", "guest"],
        }),
      ],
    });

    expect(screen.queryByText(/^Now:/)).toBeNull();
    await user.click(screen.getByLabelText("Member"));
    await user.keyboard("sam{Enter}");
    expect(await screen.findByText("Now: Moderator")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveValue("");
  });
});

describe("a macro's steps", () => {
  function step(
    index: number,
    title: string,
    group: Omit<ArgumentStepGroup, "key" | "labelPrefix">,
  ) {
    return { key: String(index), labelPrefix: `Step ${index + 1} · ${title}: `, ...group };
  }

  it("asks each step with its own command's fields and names the answers by step", async () => {
    const user = userEvent.setup();
    render(<CommandArgumentsDialog />);
    const answer = ask({
      arguments: [],
      steps: [
        step(0, "Set State", {
          commandId: "state.set",
          arguments: [VALUE],
          givenValues: { key: "counter" },
          workspaceId: "ws-1",
        }),
        step(1, "Mute Conversation", {
          commandId: "notifications.mute_conversation",
          arguments: [DURATION, UNTIL, MINUTES],
          workspaceId: "ws-1",
        }),
        step(2, "Set Topic", {
          commandId: "chat.set_topic",
          arguments: [TOPIC],
          workspaceId: "ws-1",
        }),
      ],
    });

    // The fixed key of the step gives the value field its current value and its kind.
    expect(screen.getByText((_, node) => node?.textContent === "Now: 41")).toBeInTheDocument();
    expect(screen.getByLabelText("Value: kind")).toHaveValue("number");
    await user.type(screen.getByLabelText("Step 1 · Set State: Value"), "42");

    const mute = screen.getByLabelText("Step 2 · Mute Conversation: How long");
    expect(within(mute).getByRole("option", { name: "Mute until tomorrow" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Step 2 · Mute Conversation: Until/)).toBeNull();
    await user.selectOptions(mute, "Mute until tomorrow");

    await user.click(screen.getByRole("checkbox", { name: "No topic" }));
    await user.click(screen.getByRole("button", { name: "Run" }));

    await expect(answer).resolves.toEqual({
      "0:value": "42",
      "1:duration": "until_tomorrow",
      "2:topic": "",
    });
  });
});
