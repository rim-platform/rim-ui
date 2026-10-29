import { describe, it, expect } from "vitest";

import {
  ServerMemberRoleGql,
  assignableRoles,
  canCreateChannel,
  canDeleteMemberMessages,
  canModerate,
  canTarget,
  canTargetMember,
  isGuest,
  isOwner,
  parseEventRole,
  roleLabel,
} from "./role";

const { OWNER, MODERATOR, MEMBER, GUEST } = ServerMemberRoleGql;

describe("role ladder helpers", () => {
  it.each([
    [OWNER, true, true, false],
    [MODERATOR, false, true, false],
    [MEMBER, false, false, false],
    [GUEST, false, false, true],
    [undefined, false, false, false],
    [null, false, false, false],
  ])("%s: isOwner=%s canModerate=%s isGuest=%s", (role, owner, moderate, guest) => {
    expect(isOwner(role)).toBe(owner);
    expect(canModerate(role)).toBe(moderate);
    expect(isGuest(role)).toBe(guest);
  });

  it("labels every role", () => {
    expect([OWNER, MODERATOR, MEMBER, GUEST].map(roleLabel)).toEqual([
      "Owner",
      "Moderator",
      "Member",
      "Guest",
    ]);
  });

  it("parses the lowercase role names of MemberRoleChanged", () => {
    expect(parseEventRole("owner")).toBe(OWNER);
    expect(parseEventRole("moderator")).toBe(MODERATOR);
    expect(parseEventRole("member")).toBe(MEMBER);
    expect(parseEventRole("guest")).toBe(GUEST);
    expect(parseEventRole("admin")).toBeUndefined();
  });
});

/** The targeting rules as [actor, target, allowed]. */
const TARGET_MATRIX: [ServerMemberRoleGql | undefined, ServerMemberRoleGql, boolean][] = [
  [OWNER, OWNER, false],
  [OWNER, MODERATOR, true],
  [OWNER, MEMBER, true],
  [OWNER, GUEST, true],
  [MODERATOR, OWNER, false],
  [MODERATOR, MODERATOR, false],
  [MODERATOR, MEMBER, true],
  [MODERATOR, GUEST, true],
  [MEMBER, OWNER, false],
  [MEMBER, MODERATOR, false],
  [MEMBER, MEMBER, false],
  [MEMBER, GUEST, false],
  [GUEST, MEMBER, false],
  [GUEST, GUEST, false],
  [undefined, MEMBER, false],
];

describe("canTarget mirrors the server's targeting rules", () => {
  it.each(TARGET_MATRIX)("%s -> %s: %s", (actor, target, allowed) => {
    expect(canTarget(actor, target)).toBe(allowed);
  });

  it("is false while the target's role is unknown", () => {
    expect(canTarget(OWNER, undefined)).toBe(false);
  });

  it("never targets yourself, even as Owner", () => {
    expect(canTargetMember({ userId: "me", role: OWNER }, { userId: "me", role: MEMBER })).toBe(
      false,
    );
    expect(canTargetMember({ userId: "me", role: OWNER }, { userId: "u2", role: MEMBER })).toBe(
      true,
    );
    expect(
      canTargetMember({ userId: undefined, role: OWNER }, { userId: "u2", role: MEMBER }),
    ).toBe(false);
  });
});

describe("canDeleteMemberMessages", () => {
  it.each(TARGET_MATRIX)("%s -> member %s: %s", (actor, target, allowed) => {
    expect(
      canDeleteMemberMessages({ userId: "me", role: actor }, { userId: "u2", role: target }),
    ).toBe(allowed);
  });

  it("lets an Owner or a Moderator target a former member, and nobody else", () => {
    const gone = { userId: "u-gone", isFormerMember: true };
    expect(canDeleteMemberMessages({ userId: "me", role: OWNER }, gone)).toBe(true);
    expect(canDeleteMemberMessages({ userId: "me", role: MODERATOR }, gone)).toBe(true);
    expect(canDeleteMemberMessages({ userId: "me", role: MEMBER }, gone)).toBe(false);
    expect(canDeleteMemberMessages({ userId: "me", role: GUEST }, gone)).toBe(false);
    expect(canDeleteMemberMessages({ userId: "me", role: undefined }, gone)).toBe(false);
    expect(canDeleteMemberMessages({ userId: "me", role: OWNER }, { userId: "u-gone" })).toBe(
      false,
    );
  });

  it("never targets yourself or with an unknown viewer", () => {
    expect(
      canDeleteMemberMessages({ userId: "me", role: OWNER }, { userId: "me", role: MEMBER }),
    ).toBe(false);
    expect(
      canDeleteMemberMessages(
        { userId: "me", role: OWNER },
        { userId: "me", isFormerMember: true },
      ),
    ).toBe(false);
    expect(
      canDeleteMemberMessages({ userId: null, role: OWNER }, { userId: "u2", role: MEMBER }),
    ).toBe(false);
    expect(
      canDeleteMemberMessages(
        { userId: undefined, role: MODERATOR },
        { userId: "u-gone", isFormerMember: true },
      ),
    ).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("lets the Owner give any role but Owner, minus the current one", () => {
    expect(assignableRoles(OWNER, MEMBER)).toEqual([MODERATOR, GUEST]);
    expect(assignableRoles(OWNER, MODERATOR)).toEqual([MEMBER, GUEST]);
    expect(assignableRoles(OWNER, GUEST)).toEqual([MODERATOR, MEMBER]);
  });

  it("lets a Moderator move Member <-> Guest only", () => {
    expect(assignableRoles(MODERATOR, MEMBER)).toEqual([GUEST]);
    expect(assignableRoles(MODERATOR, GUEST)).toEqual([MEMBER]);
    expect(assignableRoles(MODERATOR, MODERATOR)).toEqual([]);
  });

  it("offers nothing on the Owner or to non-moderators", () => {
    expect(assignableRoles(OWNER, OWNER)).toEqual([]);
    expect(assignableRoles(MEMBER, GUEST)).toEqual([]);
    expect(assignableRoles(GUEST, MEMBER)).toEqual([]);
  });
});

describe("canCreateChannel", () => {
  it.each([
    [GUEST, false, false],
    [MEMBER, false, true],
    [MEMBER, true, false],
    [MODERATOR, true, true],
    [OWNER, true, true],
    [undefined, false, false],
    [undefined, true, false],
  ])("%s, default workspace %s: %s", (role, inDefault, expected) => {
    expect(canCreateChannel(role, inDefault)).toBe(expected);
  });
});
