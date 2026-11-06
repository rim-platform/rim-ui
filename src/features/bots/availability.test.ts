import { describe, expect, it } from "vitest";

import { ServerFeatureState, ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import { fakeServerInfo } from "../../test/serverInfo";
import { INCOMING_WEBHOOKS } from "../updater/api/serverCapabilities";
import { botsFeatureEnabled, canManageBots, webhooksAvailable } from "./availability";

const on = fakeServerInfo();

describe("canManageBots", () => {
  it.each([
    ["an owner", ServerMemberRoleGql.OWNER, true],
    ["a moderator", ServerMemberRoleGql.MODERATOR, true],
    ["a member", ServerMemberRoleGql.MEMBER, false],
    ["a guest", ServerMemberRoleGql.GUEST, false],
    ["an unknown role", undefined, false],
  ])("is %s", (_name, role, expected) => {
    expect(canManageBots({ role, inDirectSpace: false, info: on })).toBe(expected);
  });

  it("is false in the direct space", () => {
    expect(canManageBots({ role: ServerMemberRoleGql.OWNER, inDirectSpace: true, info: on })).toBe(
      false,
    );
  });

  it("needs the bots feature listed and enabled", () => {
    const role = ServerMemberRoleGql.OWNER;
    const off = fakeServerInfo({ bots: ServerFeatureState.DISABLED });
    const unlisted = { ...on, features: on.features?.filter((f) => f.key !== "bots") };
    expect(canManageBots({ role, inDirectSpace: false, info: off })).toBe(false);
    expect(canManageBots({ role, inDirectSpace: false, info: unlisted })).toBe(false);
    expect(canManageBots({ role, inDirectSpace: false, info: undefined })).toBe(false);
    expect(botsFeatureEnabled(on)).toBe(true);
  });
});

describe("webhooksAvailable", () => {
  it("needs the incoming_webhooks capability on a server with bots", () => {
    expect(webhooksAvailable(fakeServerInfo({}, { capabilities: [INCOMING_WEBHOOKS] }))).toBe(true);
    expect(webhooksAvailable(fakeServerInfo({}, { capabilities: [] }))).toBe(false);
    expect(
      webhooksAvailable(
        fakeServerInfo(
          { bots: ServerFeatureState.DISABLED },
          { capabilities: [INCOMING_WEBHOOKS] },
        ),
      ),
    ).toBe(false);
  });
});
