import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import { queryKeys } from "../../core/query/keys";
import { queryClient } from "../../core/query/queryClient";
import { toast } from "../../shared/toast";
import { fakeServerInfo } from "../../test/serverInfo";
import { WORKSPACE_LEAVE, WORKSPACE_RENAME } from "../updater/api/serverCapabilities";
import {
  canLeaveWorkspace,
  canRenameWorkspace,
  openWorkspaceAction,
  workspaceActionOffered,
  workspaceCommandOffered,
  type WorkspaceActionFacts,
} from "./workspaceActions";
import { useWorkspaceActionStore } from "./state/useWorkspaceActionStore";
import { useWorkspaceStore } from "./state/useWorkspaceStore";

const BOTH = [WORKSPACE_LEAVE, WORKSPACE_RENAME];

function facts(over: Partial<WorkspaceActionFacts> = {}): WorkspaceActionFacts {
  return {
    role: ServerMemberRoleGql.MEMBER,
    inDirectSpace: false,
    isDefault: false,
    capabilities: BOTH,
    ...over,
  };
}

describe("canLeaveWorkspace", () => {
  it.each([
    ["a member", facts(), true],
    ["a moderator", facts({ role: ServerMemberRoleGql.MODERATOR }), true],
    ["a guest", facts({ role: ServerMemberRoleGql.GUEST }), true],
    ["the owner", facts({ role: ServerMemberRoleGql.OWNER }), false],
    ["an unknown role", facts({ role: undefined }), false],
    ["the direct space", facts({ inDirectSpace: true }), false],
    ["the default workspace", facts({ isDefault: true }), false],
    ["a server without capabilities", facts({ capabilities: undefined }), false],
    ["a server without workspace_leave", facts({ capabilities: [WORKSPACE_RENAME] }), false],
  ])("is %s", (_name, given, expected) => {
    expect(canLeaveWorkspace(given)).toBe(expected);
  });
});

describe("canRenameWorkspace", () => {
  it.each([
    ["the owner", facts({ role: ServerMemberRoleGql.OWNER }), true],
    ["a moderator", facts({ role: ServerMemberRoleGql.MODERATOR }), false],
    ["a member", facts(), false],
    ["the direct space", facts({ role: ServerMemberRoleGql.OWNER, inDirectSpace: true }), false],
    [
      "a server without workspace_rename",
      facts({ role: ServerMemberRoleGql.OWNER, capabilities: [WORKSPACE_LEAVE] }),
      false,
    ],
  ])("is %s", (_name, given, expected) => {
    expect(canRenameWorkspace(given)).toBe(expected);
  });
});

describe("the cached facts", () => {
  function cache(role: ServerMemberRoleGql, capabilities: string[] = BOTH) {
    queryClient.setQueryData(queryKeys.server("ws-2"), {
      id: "ws-2",
      name: "Beta",
      viewerRole: role,
    });
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceActionStore.setState({ action: null });
    useWorkspaceStore.setState({ workspaceId: "ws-2" });
  });

  afterEach(() => {
    queryClient.clear();
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("workspaceActionOffered reads the cached role and server info", () => {
    cache(ServerMemberRoleGql.OWNER);
    expect(workspaceActionOffered("rename", "ws-2")).toBe(true);
    expect(workspaceActionOffered("leave", "ws-2")).toBe(false);
    expect(workspaceActionOffered("rename", null)).toBe(false);
    expect(workspaceActionOffered("rename", "ws-unknown")).toBe(false);
    expect(workspaceCommandOffered("workspace.rename")).toBe(true);
    expect(workspaceCommandOffered("workspace.leave")).toBe(false);
    expect(workspaceCommandOffered("chat.mark_as_read")).toBe(true);
  });

  it("openWorkspaceAction opens the dialog or explains", () => {
    cache(ServerMemberRoleGql.MEMBER);
    openWorkspaceAction("leave");
    expect(useWorkspaceActionStore.getState().action).toEqual({
      kind: "leave",
      workspaceId: "ws-2",
    });

    useWorkspaceActionStore.getState().close();
    cache(ServerMemberRoleGql.OWNER);
    openWorkspaceAction("leave");
    expect(useWorkspaceActionStore.getState().action).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("You cannot leave this workspace.");

    cache(ServerMemberRoleGql.MEMBER);
    openWorkspaceAction("rename");
    expect(toast.info).toHaveBeenCalledWith("Only the owner can rename this workspace.");
  });
});
