import { describe, expect, it } from "vitest";

import {
  ConversationTypeEnum,
  PostingPolicy,
  ServerMemberRoleGql,
} from "../../core/graphql/generated/schema-types";
import {
  canEditChannelTopic,
  canInviteTo,
  type InviteViewer,
  memberCountLabel,
  postingAllows,
  untitledGroupName,
  type PostKind,
} from "./utils";

const names: Record<string, string> = {
  me: "Me",
  ana: "Ana",
  bo: "Bo",
  cy: "Cy",
  dee: "Dee",
  eve: "Eve",
};
const resolve = (id: string) => names[id] ?? id;

describe("untitledGroupName", () => {
  it("names the others, sorted, leaving the viewer out", () => {
    expect(untitledGroupName({ memberIds: ["me", "bo"] }, "me", resolve)).toBe("Bo");
    expect(untitledGroupName({ memberIds: ["me", "cy", "ana"] }, "me", resolve)).toBe("Ana and Cy");
    expect(untitledGroupName({ memberIds: ["bo", "me", "cy", "ana"] }, "me", resolve)).toBe(
      "Ana, Bo and Cy",
    );
  });

  it("counts the rest past three", () => {
    expect(untitledGroupName({ memberIds: ["me", "eve", "dee", "cy", "bo"] }, "me", resolve)).toBe(
      "Bo, Cy, Dee and 1 other",
    );
    expect(
      untitledGroupName({ memberIds: ["me", "eve", "dee", "cy", "bo", "ana"] }, "me", resolve),
    ).toBe("Ana, Bo, Cy and 2 others");
  });

  it("includes people invited and not joined yet, once each", () => {
    expect(
      untitledGroupName(
        { memberIds: ["me", "ana"], pendingMemberIds: ["bo", "ana"] },
        "me",
        resolve,
      ),
    ).toBe("Ana and Bo");
  });

  it("is null when nobody else is in the group", () => {
    expect(untitledGroupName({ memberIds: ["me"] }, "me", resolve)).toBeNull();
  });
});

describe("postingAllows", () => {
  const kinds: PostKind[] = ["message", "thread", "reaction", "pin"];
  const allowed = (policy: PostingPolicy, allowsThreads: boolean, canModerate: boolean) =>
    kinds.filter((kind) => postingAllows({ policy, allowsThreads }, canModerate, kind));

  it("lets everyone do everything under EVERYONE", () => {
    expect(allowed(PostingPolicy.EVERYONE, true, false)).toEqual(kinds);
    expect(allowed(PostingPolicy.EVERYONE, false, false)).toEqual(kinds);
  });

  it("lets the Owner and Moderators do everything under MODERATORS", () => {
    expect(allowed(PostingPolicy.MODERATORS, true, true)).toEqual(kinds);
    expect(allowed(PostingPolicy.MODERATORS, false, true)).toEqual(kinds);
  });

  it("leaves everyone else thread replies and reactions only while threads are allowed", () => {
    expect(allowed(PostingPolicy.MODERATORS, true, false)).toEqual(["thread", "reaction"]);
    expect(allowed(PostingPolicy.MODERATORS, false, false)).toEqual([]);
  });
});

describe("memberCountLabel", () => {
  it("counts members in the singular for one and the plural otherwise", () => {
    expect(memberCountLabel(1)).toBe("1 member");
    expect(memberCountLabel(0)).toBe("0 members");
    expect(memberCountLabel(3)).toBe("3 members");
  });
});

describe("canEditChannelTopic", () => {
  const channel = {
    conversationType: ConversationTypeEnum.CHANNEL,
    isArchived: false,
    isPrivate: false,
    createdBy: "me",
  };
  const member = { userId: "me", canModerate: false };
  const moderator = { userId: "mod", canModerate: true };

  it("lets a moderator change any channel's topic", () => {
    expect(canEditChannelTopic({ ...channel, createdBy: "ana" }, moderator)).toBe(true);
  });

  it("refuses a member of a public channel, even its creator", () => {
    expect(canEditChannelTopic({ ...channel, createdBy: "ana" }, member)).toBe(false);
    expect(canEditChannelTopic(channel, member)).toBe(false);
  });

  it("lets the creator of a private channel change its topic", () => {
    expect(canEditChannelTopic({ ...channel, isPrivate: true }, member)).toBe(true);
    expect(canEditChannelTopic({ ...channel, isPrivate: true, createdBy: "ana" }, member)).toBe(
      false,
    );
    expect(
      canEditChannelTopic(
        { ...channel, isPrivate: true },
        { userId: undefined, canModerate: false },
      ),
    ).toBe(false);
  });

  it("refuses everyone while the channel is archived", () => {
    expect(canEditChannelTopic({ ...channel, isArchived: true }, moderator)).toBe(false);
  });

  it("refuses anything but a channel", () => {
    expect(
      canEditChannelTopic({ ...channel, conversationType: ConversationTypeEnum.GROUP }, moderator),
    ).toBe(false);
  });
});

describe("canInviteTo", () => {
  const conversation = {
    serverId: "ws-1",
    conversationType: ConversationTypeEnum.CHANNEL,
    isMember: true,
    isArchived: false,
    isPrivate: false,
    createdBy: "ana",
  };
  const group = { ...conversation, conversationType: ConversationTypeEnum.GROUP };
  const dm = { ...conversation, conversationType: ConversationTypeEnum.DIRECT };
  const viewer = (overrides: Partial<InviteViewer> = {}): InviteViewer => ({
    userId: "me",
    role: ServerMemberRoleGql.MEMBER,
    inDirectSpace: false,
    defaultWorkspaceId: null,
    ...overrides,
  });
  const guest = { role: ServerMemberRoleGql.GUEST };
  const direct = { role: ServerMemberRoleGql.GUEST, inDirectSpace: true };
  const inDefault = { defaultWorkspaceId: "ws-1" };

  it.each([
    ["a workspace member in a channel", conversation, viewer(), true],
    ["a workspace member in a group", group, viewer(), true],
    ["a guest", conversation, viewer(guest), false],
    ["a guest in a group", group, viewer(guest), false],
    ["a member of an archived channel", { ...conversation, isArchived: true }, viewer(), false],
    ["a viewer outside the channel", { ...conversation, isMember: false }, viewer(), false],
    ["a member of a DM", dm, viewer(), false],
    ["a guest in a group of the direct space", group, viewer(direct), true],
    ["a guest in a DM of the direct space", dm, viewer(direct), false],
    [
      "a member in a public channel of the default workspace",
      conversation,
      viewer(inDefault),
      false,
    ],
    [
      "a moderator in a channel of the default workspace",
      conversation,
      viewer({ ...inDefault, role: ServerMemberRoleGql.MODERATOR }),
      true,
    ],
    [
      "the creator of a private channel of the default workspace",
      { ...conversation, isPrivate: true, createdBy: "me" },
      viewer(inDefault),
      true,
    ],
    [
      "a member in someone else's private channel of the default workspace",
      { ...conversation, isPrivate: true },
      viewer(inDefault),
      false,
    ],
    ["a member in a group of the default workspace", group, viewer(inDefault), true],
  ])("%s", (_name, target, who, expected) => {
    expect(canInviteTo(target, who)).toBe(expected);
  });
});
