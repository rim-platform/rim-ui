import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/runtime/runtime")>()),
  detectPlatform: vi.fn(() => "desktop"),
}));

import {
  CommandArgumentType,
  ConversationTypeEnum,
  DmRequestStatus,
  ServerMemberRoleGql,
} from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { detectPlatform } from "../../../../core/runtime/runtime";
import { toast } from "../../../../shared/toast";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import type { ConversationSummary } from "../../../conversations/types";
import { useRelayStore } from "../../../relay/state/useRelayStore";
import { workspaceCommandOffered } from "../../../workspaces/workspaceActions";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { useManageCommandStore } from "../../state/useManageCommandStore";
import { useSettingsIntentStore } from "../../state/useSettingsIntentStore";
import { COMMAND_CATEGORIES } from "../commandCategories";
import { dispatchCommand } from "../commandDispatcher";
import { currentCommandContext } from "../commandContext";
import { LOCAL_COMMANDS } from "../localCommands";
import { stepFields } from "../../../macros/runtime/macroSteps";
import { presetFields } from "../argumentValues";
import { MANAGE_COMMANDS, MANAGE_HANDLERS } from "./manage";

const executeBackend = vi.fn();

function run(id: string, args?: Record<string, unknown>) {
  const command = LOCAL_COMMANDS.find((c) => c.id === id)!;
  return dispatchCommand(command, executeBackend, {
    args,
    commandContext: currentCommandContext(),
  });
}

function setRole(role: ServerMemberRoleGql) {
  queryClient.setQueryData(queryKeys.server("ws-1"), { viewerRole: role });
}

function dm(): ConversationSummary {
  return {
    id: "dm-1",
    serverId: "ws-1",
    title: "",
    conversationType: ConversationTypeEnum.DIRECT,
    memberIds: ["me", "peer"],
    pendingMemberIds: [],
  } as unknown as ConversationSummary;
}

function cacheConversation(c: ConversationSummary) {
  queryClient.setQueryData(queryKeys.conversations("ws-1"), {
    items: [c],
    pageInfo: { hasNext: false, hasPrev: false },
  });
}

function relayOn() {
  useRelayStore.setState({ info: { directSpaceId: "direct" } as never });
}

const requested = () => useManageCommandStore.getState().request;

beforeEach(() => {
  vi.mocked(toast.info).mockClear();
  vi.mocked(detectPlatform).mockReturnValue("desktop");
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useManageCommandStore.setState({ request: null, workspaceId: null });
  useSettingsIntentStore.setState({ intent: null });
});

afterEach(() => {
  useRelayStore.getState().reset();
  useAuthStore.setState({ session: null });
  useWorkspaceStore.setState({ workspaceId: null });
  queryClient.clear();
});

describe("management commands", () => {
  it("defines each with a built-in category and a handler, under a unique id", () => {
    const ids = MANAGE_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of MANAGE_COMMANDS) {
      expect(COMMAND_CATEGORIES, command.id).toContain(command.category);
      expect(MANAGE_HANDLERS[command.id], command.id).toBeTypeOf("function");
      expect(LOCAL_COMMANDS).toContain(command);
    }
    expect(Object.keys(MANAGE_HANDLERS).sort()).toEqual([...ids].sort());
  });

  it("uses the ids, titles and categories of the plan", () => {
    const row = (id: string) => MANAGE_COMMANDS.find((c) => c.id === id);
    expect(row("moderation.resolve_report")).toMatchObject({
      title: "Resolve Report…",
      category: "Moderation",
    });
    expect(row("workspace.revoke_invite")).toMatchObject({
      title: "Revoke Invite…",
      category: "Workspace",
    });
    expect(row("bots.new_webhook")).toMatchObject({
      title: "New Webhook…",
      category: "Bots & Webhooks",
    });
    expect(row("plugins.revoke_ai_access")?.title).toBe("Revoke a Plugin's Assistant Access…");
    expect(row("people.report_request")).toMatchObject({
      title: "Report Message Request…",
      category: "People",
    });
  });
});

describe("who is offered the moderation commands", () => {
  const MODERATION = [
    "moderation.open_reports",
    "moderation.resolve_report",
    "moderation.dismiss_report",
    "moderation.clear_flag",
    "workspace.accept_join_request",
    "workspace.decline_join_request",
  ];

  it("hides them from a member and refuses them from a key", async () => {
    setRole(ServerMemberRoleGql.MEMBER);
    for (const id of MODERATION) {
      expect(workspaceCommandOffered(id), id).toBe(false);
      vi.mocked(toast.info).mockClear();
      await run(id);
      expect(toast.info, id).toHaveBeenCalledWith("Only owners and moderators can do this.");
    }
    expect(requested()).toBeNull();
    expect(useShellStore.getState().mainSurface.kind).not.toBe("settings");
  });

  it("offers them to a moderator, who opens the pickers", async () => {
    setRole(ServerMemberRoleGql.MODERATOR);
    for (const id of MODERATION) expect(workspaceCommandOffered(id), id).toBe(true);
    await run("moderation.resolve_report");
    expect(requested()).toEqual({ kind: "report", outcome: "resolve" });
    await run("moderation.dismiss_report");
    expect(requested()).toEqual({ kind: "report", outcome: "dismiss" });
    await run("workspace.decline_join_request");
    expect(requested()).toEqual({ kind: "join-request", accept: false });
    await run("moderation.open_reports");
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "workspace-moderation",
    });
  });

  it("leaves revoking an invite to the owner", async () => {
    setRole(ServerMemberRoleGql.MODERATOR);
    expect(workspaceCommandOffered("workspace.revoke_invite")).toBe(false);
    await run("workspace.revoke_invite");
    expect(toast.info).toHaveBeenCalledWith("Only the owner can do this.");
    expect(requested()).toBeNull();
    setRole(ServerMemberRoleGql.OWNER);
    await run("workspace.revoke_invite");
    expect(requested()).toEqual({ kind: "revoke-invite" });
  });

  it("leaves instance moderation to instance operators", async () => {
    useAuthStore.setState({ session: { userId: "u1" } as never });
    expect(workspaceCommandOffered("moderation.unblock_ip")).toBe(false);
    await run("moderation.unblock_ip");
    expect(toast.info).toHaveBeenCalledWith("Only instance operators can do this.");
    expect(requested()).toBeNull();
    queryClient.setQueryData(queryKeys.instanceOperator("u1"), true);
    expect(workspaceCommandOffered("moderation.unblock_ip")).toBe(true);
    await run("moderation.unblock_ip");
    expect(requested()).toEqual({ kind: "unblock-ip" });
    await run("moderation.clear_profile");
    expect(requested()).toEqual({ kind: "principal", purpose: "clear-profile" });
  });

  it("clears a flag only on a selected flagged message", async () => {
    setRole(ServerMemberRoleGql.MODERATOR);
    useShellStore.getState().setSelectedConversationId("conv-1");
    await run("moderation.clear_flag");
    expect(toast.info).toHaveBeenCalledWith("Select a message first");
  });
});

describe("bots and webhooks", () => {
  it("are refused to someone who cannot manage bots", async () => {
    setRole(ServerMemberRoleGql.MEMBER);
    for (const id of ["bots.new", "bots.edit", "bots.deactivate", "bots.revoke_webhook"]) {
      expect(workspaceCommandOffered(id), id).toBe(false);
      await run(id);
    }
    expect(toast.info).toHaveBeenCalledWith(
      "Bots are managed by this workspace's owners and moderators.",
    );
    expect(requested()).toBeNull();
    expect(useSettingsIntentStore.getState().intent).toBeNull();
  });
});

describe("new webhook", () => {
  function botsOn() {
    setRole(ServerMemberRoleGql.OWNER);
    queryClient.setQueryData(queryKeys.serverInfo, {
      features: [{ key: "bots", state: "ENABLED", reason: null }],
      capabilities: ["incoming_webhooks"],
    });
  }

  it("opens the Settings form that asks for the channel when no conversation is in context", async () => {
    botsOn();
    await run("bots.new_webhook");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "bots" });
    expect(useSettingsIntentStore.getState().intent).toEqual({ kind: "webhook-create" });
    expect(requested()).toBeNull();
  });

  it("still asks for a channel when another kind of conversation is in context", async () => {
    botsOn();
    cacheConversation(dm());
    useShellStore.getState().setSelectedConversationId("dm-1");
    await run("bots.new_webhook");
    expect(toast.info).toHaveBeenCalledWith("Open a channel first");
    expect(useSettingsIntentStore.getState().intent).toBeNull();
  });
});

describe("plugin commands", () => {
  it("starts installing from a folder or a git URL its source names", async () => {
    await run("plugins.install", { source: "folder" });
    expect(useSettingsIntentStore.getState().intent).toEqual({
      kind: "plugin",
      action: "install",
      source: "folder",
    });
    await run("plugins.install", { source: "git" });
    expect(useSettingsIntentStore.getState().intent).toMatchObject({ source: "git" });
    await run("plugins.install", { source: "somewhere" });
    expect(useSettingsIntentStore.getState().intent).toEqual({ kind: "plugin", action: "install" });
  });

  it("opens the install choices on the plugins page", async () => {
    await run("plugins.install");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "plugins" });
    expect(useSettingsIntentStore.getState().intent).toEqual({
      kind: "plugin",
      action: "install",
    });
  });

  it("opens a picker for the others, so each keeps its confirmation", async () => {
    await run("plugins.uninstall");
    expect(requested()).toEqual({ kind: "plugin", action: "uninstall" });
    await run("plugins.toggle");
    expect(requested()).toEqual({ kind: "plugin", action: "toggle" });
  });

  it("keeps updating and AI access to the desktop app", async () => {
    vi.mocked(detectPlatform).mockReturnValue("web");
    expect(workspaceCommandOffered("plugins.update")).toBe(false);
    expect(workspaceCommandOffered("plugins.install")).toBe(true);
    await run("plugins.update");
    expect(toast.info).toHaveBeenCalledWith("This works in the desktop app.");
    expect(requested()).toBeNull();
  });
});

describe("people commands", () => {
  it("declare the arguments their handlers read, so keybinds and macro steps can fix them", () => {
    const fieldsOf = (id: string) => {
      const command = MANAGE_COMMANDS.find((candidate) => candidate.id === id);
      return stepFields(command).map((field) => [field.name, field.argumentType, field.required]);
    };
    for (const id of ["people.add_contact", "people.remove_contact", "people.block"]) {
      expect(fieldsOf(id), id).toEqual([["user_id", CommandArgumentType.USER_ID, false]]);
    }
    expect(fieldsOf("people.report_request")).toEqual([
      ["reason", CommandArgumentType.STRING, false],
    ]);
    const install = MANAGE_COMMANDS.find((command) => command.id === "plugins.install");
    expect(presetFields(install!)).toMatchObject([
      { name: "source", allowedValues: ["folder", "git"], required: false },
    ]);
  });

  it("act on the person a saved argument names", async () => {
    relayOn();
    await run("people.remove_contact", { user_id: "u-kim" });
    expect(requested()).toEqual({ kind: "person", purpose: "remove-contact", userId: "u-kim" });
  });

  it("need the relay account", async () => {
    expect(workspaceCommandOffered("people.block")).toBe(false);
    await run("people.block");
    expect(toast.info).toHaveBeenCalledWith("This needs your relay account.");
    expect(requested()).toBeNull();
  });

  it("act on the other person of the open direct message, else ask who", async () => {
    relayOn();
    useAuthStore.setState({ session: { userId: "me" } as never });
    cacheConversation(dm());
    useShellStore.getState().setSelectedConversationId("dm-1");
    await run("people.add_contact");
    expect(requested()).toEqual({ kind: "person", purpose: "add-contact", userId: "peer" });
    useShellStore.getState().setSelectedConversationId(null);
    await run("people.block");
    expect(requested()).toEqual({ kind: "person", purpose: "block", userId: undefined });
    await run("people.unblock");
    expect(requested()).toEqual({ kind: "unblock-person" });
  });

  it("act on the open message request, else open the requests page", async () => {
    relayOn();
    await run("people.accept_request");
    expect(requested()).toBeNull();
    expect(useShellStore.getState().mainSurface.kind).toBe("dm-requests");

    cacheConversation(dm());
    useShellStore.getState().setSelectedConversationId("dm-1");
    queryClient.setQueryData(queryKeys.dmRequests(DmRequestStatus.PENDING), [
      { id: "req-1", conversationId: "dm-1" },
    ]);
    await run("people.report_request");
    expect(requested()).toEqual({ kind: "request", action: "report", requestId: "req-1" });
    await run("people.read_request_first");
    expect(requested()).toEqual({ kind: "request", action: "read-first", requestId: "req-1" });
  });

  it("report a message request for the reason given, and block its sender", async () => {
    relayOn();
    cacheConversation(dm());
    useShellStore.getState().setSelectedConversationId("dm-1");
    queryClient.setQueryData(queryKeys.dmRequests(DmRequestStatus.PENDING), [
      { id: "req-1", conversationId: "dm-1" },
    ]);
    await run("people.report_request", { reason: "Spam" });
    expect(requested()).toEqual({
      kind: "request",
      action: "report",
      requestId: "req-1",
      reason: "Spam",
    });
    await run("people.block");
    expect(requested()).toEqual({ kind: "request", action: "block", requestId: "req-1" });
  });
});
