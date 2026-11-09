import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  openDirectWithMember: vi.fn(),
  runMacro: vi.fn(),
  runLegacyMacro: vi.fn(),
  togglePipeline: vi.fn(),
  backUpHistoryNow: vi.fn(),
  openLogFolder: vi.fn(),
  window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
  platform: "web" as "web" | "desktop",
}));

vi.mock("../../../../shared/toast", () => ({ toast: mocks.toast }));
vi.mock("../../../conversations/state/openDirect", () => ({
  openDirectWithMember: mocks.openDirectWithMember,
}));
vi.mock("../../../macros/runtime/runMacro", () => ({ runMacro: mocks.runMacro }));
vi.mock("../../../macros/runtime/runLegacyMacro", () => ({
  runLegacyMacro: mocks.runLegacyMacro,
}));
vi.mock("../../../pipelines/api/usePipelines", () => ({ togglePipeline: mocks.togglePipeline }));
vi.mock("../../../history-archive/backUpNow", () => ({
  backUpHistoryNow: mocks.backUpHistoryNow,
}));
vi.mock("../../../updater/api/logFolderApi", () => ({ openLogFolder: mocks.openLogFolder }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks.window }));
vi.mock("../../../../core/runtime/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../core/runtime/runtime")>();
  return { ...actual, detectPlatform: () => mocks.platform };
});

import { ServerMemberRoleGql } from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { commandOfferedHere } from "../../../agent/agentAvailability";
import { useAuthStore } from "../../../auth/state/useAuthStore";
import { recordMacroMoves } from "../../../macros/runtime/macroMoves";
import { useRelayStore } from "../../../relay/state/useRelayStore";
import { SETTINGS_TABS, settingsTabCommandId } from "../../../settings/settingsTabs";
import { useUpdaterStore, initialUpdaterData } from "../../../updater/state/useUpdaterStore";
import { workspaceCommandOffered } from "../../../workspaces/workspaceActions";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { useAppDialogStore } from "../../state/useAppDialogStore";
import { useCommandStore } from "../../state/useCommandStore";
import { useQuickAccessStore } from "../../state/useQuickAccessStore";
import { COMMAND_CATEGORIES } from "../commandCategories";
import {
  dispatchCommand,
  hasLocalHandler,
  runDesktopLocalCommand,
  runLocalCommandForCaller,
  targetPickerKind,
} from "../commandDispatcher";
import { LOCAL_COMMANDS } from "../localCommands";
import { offeredInSituation } from "../paletteAvailability";
import { GENERAL_COMMANDS, GENERAL_HANDLERS } from "./general";

const SITUATION = {
  inDirectSpace: false,
  panelOpen: false,
  hasDirectOrigin: false,
  unreadsOpen: false,
};

function serveRole(role: ServerMemberRoleGql) {
  queryClient.setQueryData(queryKeys.server("ws-1"), { viewerRole: role });
}

function run(id: string, args?: Record<string, unknown>) {
  expect(runDesktopLocalCommand(id, args)).toBe(true);
}

beforeEach(() => {
  mocks.platform = "web";
  mocks.openLogFolder.mockResolvedValue(undefined);
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useShellStore.getState().reset();
  useAppDialogStore.getState().close();
  useQuickAccessStore.getState().close();
  useCommandStore.getState().closeCommandPalette();
  useUpdaterStore.setState({ ...initialUpdaterData });
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("the general app commands", () => {
  it("defines every command in a known category, with a handler, in the local list", () => {
    const ids = new Set(LOCAL_COMMANDS.map((c) => c.id));
    for (const command of GENERAL_COMMANDS) {
      expect(COMMAND_CATEGORIES).toContain(command.category);
      expect(hasLocalHandler(command.id)).toBe(true);
      expect(GENERAL_HANDLERS[command.id]).toBeTypeOf("function");
      expect(ids.has(command.id)).toBe(true);
      expect(command.executionTarget).toBe("DESKTOP_LOCAL");
    }
    expect(new Set(GENERAL_COMMANDS.map((c) => c.id)).size).toBe(GENERAL_COMMANDS.length);
  });

  it("names the commands and categories the plan lists", () => {
    const byId = new Map(GENERAL_COMMANDS.map((c) => [c.id, c]));
    const expected: [string, string, string][] = [
      ["plugins.open_settings", "Open Plugin Settings", "Plugins"],
      ["workspace.open_direct_messages", "Open Direct Messages", "Navigation"],
      ["workspace.add", "Add a Workspace…", "Workspace"],
      ["workspace.open_workspace_settings", "Open Workspace Settings", "Workspace"],
      ["workspace.open_join_requests", "Open Join Requests", "Workspace"],
      ["people.set_status", "Set Status…", "People"],
      ["people.view_profile", "View Profile…", "People"],
      ["people.message", "Message Someone…", "People"],
      ["app.sign_out", "Sign Out…", "App"],
      ["app.check_for_updates", "Check for Updates", "App"],
      ["app.restart_to_update", "Restart to Update", "App"],
      ["app.open_log_folder", "Open Log Folder", "App"],
      ["app.minimize_window", "Minimize Window", "App"],
      ["app.toggle_maximize_window", "Maximize or Restore Window", "App"],
      ["app.close_window", "Close Window", "App"],
      ["settings.assign_keybind", "Assign Keybind…", "App"],
      ["settings.back_up_history", "Back Up History Now", "App"],
      ["app.run_macro", "Run Macro…", "App"],
      ["app.toggle_pipeline", "Turn Pipeline On or Off…", "App"],
    ];
    for (const [id, title, category] of expected) {
      expect(byId.get(id)).toMatchObject({ title, category });
    }
  });

  it("has one command per Settings tab, workspace tabs in Workspace", () => {
    expect(SETTINGS_TABS).toHaveLength(25);
    for (const tab of SETTINGS_TABS) {
      const id = settingsTabCommandId(tab.key);
      expect(id).toMatch(/^settings\.open\.[a-z0-9_]+$/);
      expect(GENERAL_COMMANDS.find((c) => c.id === id)).toMatchObject({
        title: `Settings: ${tab.label}`,
        category: tab.group === "Workspace" ? "Workspace" : "App",
      });
    }
    expect(settingsTabCommandId("workspace-moderation")).toBe("settings.open.workspace_moderation");
    expect(settingsTabCommandId("plugin-ai")).toBe("settings.open.plugin_ai");
  });
});

describe("Settings tab commands", () => {
  it("opens Settings on the tab", () => {
    run("settings.open.notifications");
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "notifications",
    });
    run("settings.open.direct_messages");
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "direct-messages",
    });
  });

  it("is offered only where the tab shows", () => {
    expect(workspaceCommandOffered("settings.open.profile")).toBe(true);
    expect(workspaceCommandOffered("settings.open.workspace")).toBe(false);
    expect(workspaceCommandOffered("settings.open.desktop")).toBe(false);
    expect(workspaceCommandOffered("settings.open.moderation")).toBe(false);
    serveRole(ServerMemberRoleGql.OWNER);
    expect(workspaceCommandOffered("settings.open.workspace")).toBe(true);
    expect(workspaceCommandOffered("settings.open.workspace_moderation")).toBe(true);
    useWorkspaceStore.setState({ workspaceId: null });
    expect(workspaceCommandOffered("settings.open.workspace")).toBe(false);
  });

  it("refuses a tab that is hidden, as the page would not show it", () => {
    run("settings.open.workspace");
    expect(useShellStore.getState().mainSurface.kind).not.toBe("settings");
    expect(mocks.toast.info).toHaveBeenCalled();
  });
});

describe("workspace commands", () => {
  it("opens Plugin Settings", () => {
    run("plugins.open_settings");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "plugins" });
  });

  it("switches to the direct space, offered only when there is one", () => {
    expect(workspaceCommandOffered("workspace.open_direct_messages")).toBe(false);
    run("workspace.open_direct_messages");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    useRelayStore.setState({
      info: { directSpaceId: "direct-1" } as never,
    });
    expect(workspaceCommandOffered("workspace.open_direct_messages")).toBe(true);
    run("workspace.open_direct_messages");
    expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1");
    useRelayStore.setState({ info: null });
  });

  it("leaves Home and Unreads for the direct messages, and stays on other pages", () => {
    useRelayStore.setState({ info: { directSpaceId: "direct-1" } as never });
    for (const kind of ["home", "unreads"] as const) {
      useShellStore.getState().setMainSurface({ kind });
      run("workspace.open_direct_messages");
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    }
    useShellStore.getState().setMainSurface({ kind: "settings" });
    run("workspace.open_direct_messages");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
    useRelayStore.setState({ info: null });
  });

  it("opens the add dialog", () => {
    run("workspace.add");
    expect(useAppDialogStore.getState().dialog).toBe("addWorkspace");
  });

  it("opens workspace settings and join requests for moderators only", () => {
    for (const id of ["workspace.open_workspace_settings", "workspace.open_join_requests"]) {
      expect(workspaceCommandOffered(id)).toBe(false);
      run(id);
      expect(useShellStore.getState().mainSurface.kind).not.toBe("settings");
    }
    serveRole(ServerMemberRoleGql.MODERATOR);
    expect(workspaceCommandOffered("workspace.open_workspace_settings")).toBe(true);
    run("workspace.open_workspace_settings");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "workspace" });
    run("workspace.open_join_requests");
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "workspace-moderation",
    });
    serveRole(ServerMemberRoleGql.MEMBER);
    expect(workspaceCommandOffered("workspace.open_join_requests")).toBe(false);
  });
});

describe("people and account commands", () => {
  it("opens the status picker, the profile card and the sign-out confirmation", () => {
    run("people.set_status");
    expect(useAppDialogStore.getState().dialog).toBe("status");
    run("people.view_profile", { userId: "u-2" });
    expect(useAppDialogStore.getState().dialog).toBe("profile");
    expect(useAppDialogStore.getState().userId).toBe("u-2");
    run("app.sign_out");
    expect(useAppDialogStore.getState().dialog).toBe("signOut");
  });

  it("messages the picked person", () => {
    run("people.message", { user_id: "u-3" });
    expect(mocks.openDirectWithMember).toHaveBeenCalledWith("u-3");
  });

  it("asks for the person first when none is given", async () => {
    for (const [id, kind] of [
      ["people.view_profile", "member"],
      ["people.message", "messageableMember"],
    ] as const) {
      useCommandStore.getState().closeCommandPalette();
      expect(targetPickerKind(id)).toBe(kind);
      const command = GENERAL_COMMANDS.find((c) => c.id === id)!;
      await dispatchCommand(command, vi.fn());
      expect(useCommandStore.getState().targetPicker).toEqual({ commandId: id, kind });
    }
    expect(mocks.openDirectWithMember).not.toHaveBeenCalled();
  });
});

describe("update commands", () => {
  it("offers Check for Updates only where the app updates itself", () => {
    expect(commandOfferedHere("app.check_for_updates")).toBe(false);
    mocks.platform = "desktop";
    expect(commandOfferedHere("app.check_for_updates")).toBe(true);
  });

  it("offers Restart to Update only while an update is ready", () => {
    mocks.platform = "desktop";
    expect(offeredInSituation("app.restart_to_update", SITUATION)).toBe(false);
    useUpdaterStore.setState({ activity: "ready" });
    expect(offeredInSituation("app.restart_to_update", SITUATION)).toBe(true);
  });

  it("restarts into a ready update and says when none is ready", () => {
    const restartToUpdate = vi.fn(async () => undefined);
    useUpdaterStore.setState({ restartToUpdate });
    run("app.restart_to_update");
    expect(restartToUpdate).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalled();
    useUpdaterStore.setState({ activity: "ready" });
    run("app.restart_to_update");
    expect(restartToUpdate).toHaveBeenCalledTimes(1);
  });

  it("checks for updates and reports the answer", async () => {
    mocks.platform = "desktop";
    const checkNow = vi.fn(async () => ({ version: "1.2.3", notes: null, date: null }));
    useUpdaterStore.setState({ configured: true, checkNow });
    run("app.check_for_updates");
    await vi.waitFor(() => expect(checkNow).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith("Version 1.2.3 is available.", {
        description: "Download it in Settings > About.",
      }),
    );
  });
});

describe("desktop commands", () => {
  const DESKTOP = [
    "app.open_log_folder",
    "app.minimize_window",
    "app.toggle_maximize_window",
    "app.close_window",
    "settings.back_up_history",
  ];

  it("hides them outside the desktop app", () => {
    for (const id of DESKTOP) expect(commandOfferedHere(id)).toBe(false);
    mocks.platform = "desktop";
    for (const id of DESKTOP) expect(commandOfferedHere(id)).toBe(true);
  });

  it("acts on the window and the log folder", async () => {
    run("app.minimize_window");
    await vi.waitFor(() => expect(mocks.window.minimize).toHaveBeenCalled());
    run("app.toggle_maximize_window");
    await vi.waitFor(() => expect(mocks.window.toggleMaximize).toHaveBeenCalled());
    run("app.close_window");
    await vi.waitFor(() => expect(mocks.window.close).toHaveBeenCalled());
    run("app.open_log_folder");
    await vi.waitFor(() => expect(mocks.openLogFolder).toHaveBeenCalled());
  });

  it("backs up the history", () => {
    run("settings.back_up_history");
    expect(mocks.backUpHistoryNow).toHaveBeenCalled();
  });

  it("ends a run of the back-up only once the back-up has ended", async () => {
    let finish!: () => void;
    mocks.backUpHistoryNow.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const command = LOCAL_COMMANDS.find((c) => c.id === "settings.back_up_history")!;
    let ended = false;
    const running = dispatchCommand(command, vi.fn(), {}).then((result) => {
      ended = true;
      return result;
    });

    await Promise.resolve();
    expect(ended).toBe(false);
    finish();
    expect(await running).toMatchObject({ status: "SUCCESS" });
    expect(ended).toBe(true);
  });
});

describe("keybind, macro and pipeline commands", () => {
  it("assigns a keybind to the workspace a control names, not the open conversation", () => {
    useShellStore.getState().setSelectedConversationId("c-1");
    queryClient.setQueryData(queryKeys.myServers(), [{ id: "ws-2", name: "Beta" }]);
    expect(
      runLocalCommandForCaller("settings.assign_keybind", {}, { workspaceId: "ws-2" }),
    ).toEqual({ ok: true, message: "" });
    expect(useQuickAccessStore.getState().target).toEqual({
      kind: "workspace",
      workspaceId: "ws-2",
      label: "Beta",
    });
  });

  it("assigns a keybind to the open workspace when no conversation is open", () => {
    run("settings.assign_keybind");
    expect(useQuickAccessStore.getState().target).toMatchObject({
      kind: "workspace",
      workspaceId: "ws-1",
    });
  });

  it("assigns a keybind to the open conversation", () => {
    queryClient.setQueryData(queryKeys.joinedChannels("ws-1"), {
      items: [{ id: "c-1", serverId: "ws-1", title: "general", conversationType: "CHANNEL" }],
      pageInfo: { hasNext: false, hasPrev: false },
    });
    useShellStore.getState().setSelectedConversationId("c-1");
    run("settings.assign_keybind");
    expect(useQuickAccessStore.getState().target).toEqual({
      kind: "channel",
      conversationId: "c-1",
      serverId: "ws-1",
      label: "general",
    });
  });

  it("runs the picked macro as Settings does", async () => {
    const macro = { id: "m-1", name: "Standup", description: null, steps: [] };
    queryClient.setQueryData(queryKeys.macros("ws-1"), [macro]);
    run("app.run_macro", { macroId: "m-1" });
    await vi.waitFor(() =>
      expect(mocks.runLegacyMacro).toHaveBeenCalledWith(macro, "ws-1", undefined),
    );
    run("app.run_macro", { macroId: "gone" });
    await vi.waitFor(() => expect(mocks.toast.info).toHaveBeenCalled());
    expect(mocks.runLegacyMacro).toHaveBeenCalledTimes(1);
    expect(mocks.runMacro).not.toHaveBeenCalled();
  });

  it("runs the person's macro, or the one a workspace macro moved into, where the server keeps them", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
    useAuthStore.setState({ session: { userId: "u-1" } as never });
    recordMacroMoves("u-1", { "m-old": "user.standup" });
    const unmoved = { id: "m-2", name: "Triage", description: null, steps: [] };
    queryClient.setQueryData(queryKeys.macros("ws-1"), [unmoved]);
    try {
      run("app.run_macro", { macroId: "user.focus" });
      await vi.waitFor(() => expect(mocks.runMacro).toHaveBeenCalledWith("user.focus"));
      run("app.run_macro", { macroId: "m-old" });
      await vi.waitFor(() => expect(mocks.runMacro).toHaveBeenCalledWith("user.standup"));
      run("app.run_macro", { macroId: "m-2" });
      await vi.waitFor(() =>
        expect(mocks.runLegacyMacro).toHaveBeenCalledWith(unmoved, "ws-1", undefined),
      );
    } finally {
      localStorage.clear();
      useAuthStore.setState({ session: null });
    }
  });

  it("opens Macros from the Commands tab command where the home server keeps the person's macros", () => {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
    run(settingsTabCommandId("commands"));

    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "macros" });
    expect(workspaceCommandOffered(settingsTabCommandId("commands"))).toBe(false);
  });

  it("switches the picked pipeline", async () => {
    mocks.togglePipeline.mockResolvedValue({});
    queryClient.setQueryData(queryKeys.pipelines("ws-1"), [
      { id: "p-1", name: "Triage", enabled: true },
    ]);
    run("app.toggle_pipeline", { pipelineId: "p-1" });
    await vi.waitFor(() =>
      expect(mocks.togglePipeline).toHaveBeenCalledWith({ pipelineId: "p-1", enabled: false }),
    );
    await vi.waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('Pipeline "Triage" turned off'),
    );
  });

  it("asks for the macro or the pipeline first", async () => {
    for (const [id, kind] of [
      ["app.run_macro", "macro"],
      ["app.toggle_pipeline", "pipeline"],
    ] as const) {
      expect(targetPickerKind(id)).toBe(kind);
    }
  });
});
