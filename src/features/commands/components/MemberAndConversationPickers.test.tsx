import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const members = vi.hoisted(() => [
  { userId: "u-sam", isBot: false, timeoutUntil: null as string | null },
  { userId: "u-alex", isBot: false, timeoutUntil: null as string | null },
  { userId: "u-kim", isBot: false, timeoutUntil: "2999-01-01T00:00:00Z" },
  { userId: "u-old", isBot: false, timeoutUntil: "2000-01-01T00:00:00Z" },
  { userId: "b-deploy", isBot: true, timeoutUntil: null as string | null },
  { userId: "me", isBot: false, timeoutUntil: null as string | null },
]);
const names: Record<string, string> = {
  "u-sam": "Sam",
  "u-alex": "Alex",
  "u-kim": "Kim",
  "u-old": "Old",
  "b-deploy": "Deploy bot",
  me: "Me",
};
const conversation = vi.fn();
const canModerate = vi.fn();
const bans = vi.fn();
const ownTargets = vi.fn();

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
vi.mock("../../workspaces/api/useMyServerRole", () => ({
  useCanModerate: () => canModerate(),
}));
vi.mock("../../workspaces/api/useModeration", () => ({
  useServerBans: () => bans(),
}));
vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: (...args: unknown[]) => conversation(...args),
}));
vi.mock("../../emoji/api/useCustomEmojis", () => ({
  useCustomEmojis: () => ({
    emojis: [{ id: "e-1", name: "party", imageUrl: "/party.png" }],
    isLoading: false,
  }),
}));
vi.mock("../../../shared/ui/EmojiPicker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <div role="dialog" aria-label="Emoji picker">
      <button type="button" onClick={() => onSelect("🎉")}>
        Tada
      </button>
      <button type="button" onClick={() => onSelect(":party:")}>
        Party
      </button>
    </div>
  ),
}));

function target(id: string, label: string) {
  return { id, serverId: "ws-1", label };
}

vi.mock("./paletteTargets", () => ({
  useChannelTargets: () => ({
    items: [target("c-general", "#general"), target("dm-sam", "Sam")],
    isPending: false,
  }),
  useJoinableTargets: () => ({ items: [target("c-random", "#random")], isPending: false }),
  useOwnConversationTargets: (_workspaceId: string | undefined, types: readonly string[]) =>
    ownTargets(types),
  useArchivedChannelTargets: () => ({
    items: [target("c-old", "#old-launch")],
    isPending: false,
  }),
  useDirectTargets: () => ({
    items: [{ id: "dm-relay", serverId: "direct-1", label: "Robin" }],
    isPending: false,
  }),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import {
  readFields,
  toFieldValue,
  type FieldValue,
  type FieldValues,
} from "../runtime/argumentValues";
import type { CommandArgumentInfo } from "../types";
import { ArgumentFieldList, type ArgumentFormMode } from "./ArgumentFields";

function argument(
  name: string,
  title: string,
  argumentType: CommandArgumentType,
  required = true,
): CommandArgumentInfo {
  return { name, title, argumentType, required };
}

const MEMBER_IDS = argument("member_ids", "Members", CommandArgumentType.STRING);
const USER_IDS = argument("user_ids", "People", CommandArgumentType.STRING);
const USER_ID = argument("user_id", "Member", CommandArgumentType.USER_ID);
const CONVERSATION = argument(
  "conversation_id",
  "Conversation",
  CommandArgumentType.CONVERSATION_ID,
);
const EMOJI = argument("emoji", "Emoji", CommandArgumentType.STRING);

/** A form of `fields` for `commandId` that keeps its own values, as the real forms do. */
function Form({
  commandId,
  fields,
  initial,
  mode = "preset",
  onValues,
}: {
  commandId: string;
  fields: CommandArgumentInfo[];
  initial: FieldValues;
  mode?: ArgumentFormMode;
  onValues?: (values: FieldValues) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <ArgumentFieldList
      fields={fields}
      values={values}
      onChange={(name: string, value: FieldValue) => {
        const next = { ...values, [name]: value };
        setValues(next);
        onValues?.(next);
      }}
      mode={mode}
      workspaceId="ws-1"
      commandId={commandId}
    />
  );
}

/** The names the member list offers, in its order. */
function offered(): string[] {
  return within(screen.getByRole("listbox"))
    .queryAllByRole("option")
    .map((option) => {
      const text = option.textContent ?? "";
      return Object.values(names).find((name) => text.includes(name)) ?? text;
    });
}

/** The labels and groups of a select's options. */
function selectOptions(label: string) {
  return within(screen.getByLabelText(label))
    .getAllByRole("option")
    .map((option) => {
      const group = option.parentElement?.tagName === "OPTGROUP" ? option.parentElement : null;
      return [group?.getAttribute("label") ?? null, option.textContent];
    });
}

beforeEach(() => {
  conversation.mockReset();
  conversation.mockReturnValue({ data: undefined });
  canModerate.mockReset();
  canModerate.mockReturnValue(false);
  bans.mockReset();
  bans.mockReturnValue({ data: [], isPending: false, isError: false });
  ownTargets.mockReset();
  ownTargets.mockImplementation((types: readonly string[]) => ({
    items: [
      target("c-general", "#general"),
      ...(types.includes("GROUP") ? [target("g-crew", "Crew")] : []),
    ],
    isPending: false,
  }));
});

describe("members field", () => {
  it("picks several members and sends their ids joined with commas", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    render(
      <Form
        commandId="chat.create_group"
        fields={[MEMBER_IDS]}
        initial={{ member_ids: "" }}
        onValues={onValues}
      />,
    );
    await user.click(screen.getByRole("option", { name: /Sam/ }));
    await user.click(screen.getByRole("option", { name: /Alex/ }));

    const values = onValues.mock.lastCall?.[0] as FieldValues;
    expect(values.member_ids).toBe("u-sam,u-alex");
    expect(readFields([MEMBER_IDS], values, true, "chat.create_group")).toEqual({
      ok: true,
      args: { member_ids: "u-sam,u-alex" },
    });
    expect(screen.getByRole("button", { name: "Remove Sam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeInTheDocument();
  });

  it("shows saved ids as named chips, from text or a list", () => {
    const fromList = toFieldValue(MEMBER_IDS, ["u-sam", "u-kim"], "chat.create_channel");
    expect(fromList).toBe("u-sam,u-kim");
    render(
      <Form
        commandId="chat.create_channel"
        fields={[MEMBER_IDS]}
        initial={{ member_ids: fromList as string }}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove Sam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Kim" })).toBeInTheDocument();
  });

  it("removes a chip, and an emptied field sends nothing", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    render(
      <Form
        commandId="chat.create_group"
        fields={[MEMBER_IDS]}
        initial={{ member_ids: "u-sam" }}
        onValues={onValues}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove Sam" }));
    const values = onValues.mock.lastCall?.[0] as FieldValues;
    expect(values.member_ids).toBe("");
    expect(readFields([MEMBER_IDS], values, true, "chat.create_group")).toEqual({
      ok: false,
      problems: { member_ids: "Members is required" },
    });
  });

  it("offers no bots for a new group or channel", () => {
    render(
      <Form commandId="chat.create_group" fields={[MEMBER_IDS]} initial={{ member_ids: "" }} />,
    );
    expect(offered()).not.toContain("Deploy bot");
    expect(offered()).toContain("Sam");
  });

  it("leaves out the people already in the conversation the form names", () => {
    conversation.mockReturnValue({
      data: {
        memberIds: ["me", "u-sam"],
        pendingMemberIds: ["u-alex"],
        conversationType: "GROUP",
      },
    });
    render(
      <Form
        commandId="chat.invite_to_conversation"
        fields={[CONVERSATION, USER_IDS]}
        initial={{ conversation_id: "g-crew", user_ids: "" }}
      />,
    );
    expect(conversation).toHaveBeenCalledWith("ws-1", "g-crew");
    expect(offered()).toEqual(["Kim", "Old"]);
  });

  it("offers bots to invite to a channel only to a moderator", () => {
    conversation.mockReturnValue({
      data: { memberIds: ["me"], pendingMemberIds: [], conversationType: "CHANNEL" },
    });
    const { unmount } = render(
      <Form
        commandId="chat.invite_to_conversation"
        fields={[CONVERSATION, USER_IDS]}
        initial={{ conversation_id: "c-general", user_ids: "" }}
      />,
    );
    expect(offered()).not.toContain("Deploy bot");
    unmount();

    canModerate.mockReturnValue(true);
    render(
      <Form
        commandId="chat.invite_to_conversation"
        fields={[CONVERSATION, USER_IDS]}
        initial={{ conversation_id: "c-general", user_ids: "" }}
      />,
    );
    expect(offered()).toContain("Deploy bot");
  });
});

describe("member pools", () => {
  it("offers only the members of the conversation to remove", () => {
    conversation.mockReturnValue({
      data: { memberIds: ["me", "u-alex", "b-deploy"], conversationType: "CHANNEL" },
    });
    render(
      <Form
        commandId="chat.remove_conversation_member"
        fields={[CONVERSATION, USER_ID]}
        initial={{ conversation_id: "c-general", user_id: "" }}
      />,
    );
    expect(offered()).toEqual(["Alex", "Deploy bot"]);
  });

  it("offers every member to remove while the conversation is not known", () => {
    render(
      <Form
        commandId="chat.remove_conversation_member"
        fields={[CONVERSATION, USER_ID]}
        initial={{ conversation_id: "", user_id: "" }}
      />,
    );
    expect(offered()).toContain("Sam");
    expect(offered()).toContain("Deploy bot");
  });

  it("offers only the members whose timeout is in force", () => {
    render(<Form commandId="admin.clear_timeout" fields={[USER_ID]} initial={{ user_id: "" }} />);
    expect(offered()).toEqual(["Kim"]);
  });

  it("offers no bots to message", () => {
    const prompted = argument("user_id", "", CommandArgumentType.USER_ID, false);
    render(<Form commandId="people.message" fields={[prompted]} initial={{ user_id: "" }} />);
    expect(offered()).not.toContain("Deploy bot");
    expect(offered()).toContain("Sam");
  });

  it("lists the banned people to unban, who are not members", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    bans.mockReturnValue({
      data: [
        { userId: "u-gone", user: { id: "u-gone", username: "gone", displayName: "Gone Person" } },
        { userId: "u-deleted", user: null },
      ],
      isPending: false,
      isError: false,
    });
    render(
      <Form
        commandId="admin.unban"
        fields={[USER_ID]}
        initial={{ user_id: "" }}
        onValues={onValues}
      />,
    );
    expect(selectOptions("Member")).toEqual([
      [null, "Ask when run"],
      [null, "Gone Person"],
      [null, "A deleted account"],
    ]);
    await user.selectOptions(screen.getByLabelText("Member"), "Gone Person");
    expect((onValues.mock.lastCall?.[0] as FieldValues).user_id).toBe("u-gone");
  });

  it("says when nobody is banned", () => {
    render(
      <Form commandId="admin.unban" fields={[USER_ID]} initial={{ user_id: "" }} mode="ask" />,
    );
    expect(selectOptions("Member")).toEqual([[null, "Nobody is banned"]]);
  });
});

describe("conversation selects by kind", () => {
  function optionsFor(commandId: string, mode: ArgumentFormMode = "preset") {
    const { unmount } = render(
      <Form
        commandId={commandId}
        fields={[CONVERSATION]}
        initial={{ conversation_id: "" }}
        mode={mode}
      />,
    );
    const options = selectOptions("Conversation").slice(1);
    unmount();
    return options;
  }

  it("offers archived channels to unarchive", () => {
    expect(optionsFor("chat.unarchive_channel")).toEqual([[null, "#old-launch"]]);
  });

  it("offers channels only for the channel settings, and unjoined ones in a preset", () => {
    for (const id of [
      "chat.archive_channel",
      "chat.set_slow_mode",
      "chat.set_channel_posting",
      "chat.set_topic",
    ]) {
      expect(optionsFor(id), id).toEqual([
        ["Your channels", "#general"],
        ["Other public channels", "#random"],
      ]);
      expect(optionsFor(id, "ask"), id).toEqual([[null, "#general"]]);
    }
    expect(ownTargets).toHaveBeenCalledWith(["CHANNEL"]);
  });

  it("offers channels and groups, no DMs, to leave, invite to or remove from", () => {
    for (const id of [
      "chat.leave_conversation",
      "chat.invite_to_conversation",
      "chat.remove_conversation_member",
    ]) {
      expect(optionsFor(id), id).toEqual([
        [null, "#general"],
        [null, "Crew"],
      ]);
    }
  });

  it("offers channels to join, and in a preset the joined ones too", () => {
    expect(optionsFor("chat.join_channel", "ask")).toEqual([[null, "#random"]]);
    expect(optionsFor("chat.join_channel")).toEqual([
      ["Channels to join", "#random"],
      ["Your channels", "#general"],
    ]);
  });

  it("offers the direct spaces' conversations to open as a DM", () => {
    expect(optionsFor("workspace.navigate_to_dm")).toEqual([[null, "Robin"]]);
  });

  it("keeps the general list for a command the map does not name", () => {
    expect(optionsFor("chat.post_message")).toEqual([
      ["Your conversations", "#general"],
      ["Your conversations", "Sam"],
      ["Other public channels", "#random"],
    ]);
  });
});

describe("emoji field", () => {
  it("takes an emoji from the picker and sends it as it is", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    render(
      <Form
        commandId="chat.toggle_reaction"
        fields={[EMOJI]}
        initial={{ emoji: "" }}
        onValues={onValues}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Choose an emoji" }));
    await user.click(screen.getByRole("button", { name: "Tada" }));
    expect(screen.queryByRole("dialog", { name: "Emoji picker" })).toBeNull();
    const values = onValues.mock.lastCall?.[0] as FieldValues;
    expect(screen.getByLabelText("Emoji")).toHaveValue("🎉");
    expect(readFields([EMOJI], values, true, "chat.toggle_reaction")).toEqual({
      ok: true,
      args: { emoji: "🎉" },
    });
  });

  it("takes a custom emoji as :name:", async () => {
    const user = userEvent.setup();
    render(<Form commandId="chat.toggle_reaction" fields={[EMOJI]} initial={{ emoji: "" }} />);
    await user.click(screen.getByRole("button", { name: "Choose an emoji" }));
    await user.click(screen.getByRole("button", { name: "Party" }));
    expect(screen.getByLabelText("Emoji")).toHaveValue(":party:");
    expect(screen.queryByText(/No custom emoji/)).toBeNull();
  });

  it("notes a typed :name: that is not one of the workspace's custom emoji", async () => {
    const user = userEvent.setup();
    render(<Form commandId="chat.toggle_reaction" fields={[EMOJI]} initial={{ emoji: "" }} />);
    await user.type(screen.getByLabelText("Emoji"), ":thumbsup:");
    expect(
      screen.getByText("No custom emoji is called :thumbsup: in this workspace"),
    ).toBeVisible();
  });

  it("closes the picker alone on Escape", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    document.addEventListener("keydown", onKeyDown);
    render(<Form commandId="chat.toggle_reaction" fields={[EMOJI]} initial={{ emoji: "" }} />);
    await user.click(screen.getByRole("button", { name: "Choose an emoji" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Emoji picker" })).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onKeyDown);
  });
});
