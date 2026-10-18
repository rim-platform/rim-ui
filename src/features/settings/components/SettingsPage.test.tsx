import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock all sub-panels to avoid pulling in their complex dependencies
vi.mock("./ProfileSettings", () => ({
  ProfileSettings: () => <div data-testid="profile-settings">Profile Panel</div>,
}));

vi.mock("./AccountSettings", () => ({
  AccountSettings: ({ onNavigateToProfile }: { onNavigateToProfile: () => void }) => (
    <div data-testid="account-settings">
      Account Panel
      <button onClick={onNavigateToProfile}>Go to profile</button>
    </div>
  ),
}));

vi.mock("../../commands/components/KeyboardSettings", () => ({
  KeyboardSettings: () => <div data-testid="keyboard-settings">Keyboard Panel</div>,
}));

vi.mock("../../commands/components/KeybindSettings", () => ({
  KeybindSettings: () => <div data-testid="keybind-settings">Keybinds Panel</div>,
}));

vi.mock("../../commands/components/UserCommandSettings", () => ({
  UserCommandSettings: () => <div data-testid="command-settings">Commands Panel</div>,
}));

vi.mock("../../plugins/components/PluginSettingsPage", () => ({
  PluginSettingsPage: () => <div data-testid="plugin-settings">Plugins Panel</div>,
}));

vi.mock("../../plugins/components/PluginAiConsentPanel", () => ({
  PluginAiConsentPanel: () => <div data-testid="plugin-ai-settings">Plugin AI Panel</div>,
}));

vi.mock("../../agent/settings/AgentSettingsPanel", () => ({
  AgentSettingsPanel: () => <div data-testid="agent-settings">Agent Panel</div>,
}));

vi.mock("../../notifications/components/NotificationSettings", () => ({
  NotificationSettings: () => <div data-testid="notification-settings">Notifications Panel</div>,
}));

vi.mock("../../macros/components/MacroSettings", () => ({
  MacroSettings: () => <div data-testid="macro-settings">Macros Panel</div>,
}));

vi.mock("../../emoji/components/EmojiManagement", () => ({
  EmojiManagement: () => <div data-testid="emoji-settings">Emoji Panel</div>,
}));

const mockSetMainSurface = vi.fn();

// Mutable so individual tests can point to a specific settings surface.
const mockShellState: {
  setMainSurface: typeof mockSetMainSurface;
  mainSurface: Record<string, unknown>;
} = {
  setMainSurface: mockSetMainSurface,
  mainSurface: { kind: "settings" },
};

vi.mock("../../../shell/state/useShellStore", () => ({
  useShellStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockShellState as unknown as Record<string, unknown>),
}));

// The open space — mutable per test.
const mockWorkspace = { workspaceId: "ws-1" };

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockWorkspace),
}));

// The viewer's moderation role — mutable per test.
const mockGate = { canModerate: false };

vi.mock("../../workspaces/api/useMyServerRole", () => ({
  useCanModerate: () => mockGate.canModerate,
}));

// Whether the viewer is an instance operator — mutable per test.
const mockOperator = { isOperator: false };

vi.mock("../../instance-moderation/api/instanceModeration", () => ({
  useIsInstanceOperator: () => ({ isOperator: mockOperator.isOperator, isPending: false }),
}));
vi.mock("../../instance-moderation/components/InstanceModerationSettings", () => ({
  InstanceModerationSettings: () => <div data-testid="instance-moderation">Instance</div>,
}));

vi.mock("../../plugins/registry/components/WorkspacePluginSettings", () => ({
  WorkspacePluginSettings: () => null,
}));
vi.mock("./ModerationSettings", () => ({
  ModerationSettings: () => <div data-testid="moderation-settings">Moderation</div>,
}));
vi.mock("./WorkspaceOwnerSettings", () => ({
  WorkspaceOwnerSettings: () => null,
}));
vi.mock("../../dm-policy/components/WorkspaceDmPolicySettings", () => ({
  WorkspaceDmPolicySettings: () => <div data-testid="workspace-dm-settings">Workspace DMs</div>,
}));
vi.mock("../../dm-policy/components/DmSettings", () => ({
  DmSettings: () => <div data-testid="dm-settings">Who can message me</div>,
}));

vi.mock("../../updater/components/AboutUpdates", () => ({
  AboutVersion: () => <p>Version 9.9.9</p>,
  AboutUpdates: () => <div data-testid="about-updates">Updates</div>,
}));
vi.mock("../../updater/components/AboutLogFolder", () => ({
  AboutLogFolder: () => <button type="button">Open log folder</button>,
}));
vi.mock("../../updater/components/AboutNotices", () => ({
  AboutNotices: () => <div data-testid="about-notices">Third-party licences</div>,
}));
vi.mock("../../updater/components/AboutServer", () => ({
  AboutServerVersion: () => <p>Server 8.8.8</p>,
  AboutServerApiBanner: () => <p role="status">Newer server API</p>,
  AboutServerFeatures: () => <ul aria-label="Server features" />,
}));

import { SettingsPage } from "./SettingsPage";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import {
  withServerInfo,
  type FakeFeatures,
  type FakeServerDetails,
} from "../../../test/serverInfo";
import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";

function renderSettings(features: FakeFeatures = {}, details: FakeServerDetails = {}) {
  return render(<SettingsPage />, { wrapper: withServerInfo(features, details) });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default settings surface with no tab hint between tests.
    mockShellState.mainSurface = { kind: "settings" };
    mockGate.canModerate = false;
    mockOperator.isOperator = false;
    mockWorkspace.workspaceId = "ws-1";
  });

  afterEach(() => useRelayStore.getState().reset());

  it("renders with header and tabs", () => {
    renderSettings();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Keybinds")).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.getByText("Plugin AI")).toBeInTheDocument();
    expect(screen.getByText("AI Agent")).toBeInTheDocument();
    expect(screen.queryByText("AI Keys")).not.toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
  });

  it("groups the tabs under section labels and drops a group with nothing visible", () => {
    renderSettings({ custom_emoji: ServerFeatureState.DISABLED });
    expect(screen.getAllByRole("group")).toEqual(
      ["You", "Messaging", "Programmable", "Extensions", "About"].map((name) =>
        screen.getByRole("group", { name }),
      ),
    );
    const messaging = screen.getByRole("group", { name: "Messaging" });
    expect(
      within(messaging)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Messages", "Direct messages", "Notifications", "History"]);
    const extensions = screen.getByRole("group", { name: "Extensions" });
    expect(
      within(extensions)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Plugins", "Plugin AI", "State", "AI Agent"]);
  });

  it("reaches every tab and the close button by keyboard and opens Keyboard with Enter", async () => {
    const user = userEvent.setup();
    renderSettings();
    const keyboard = screen.getByRole("button", { name: "Keyboard" });
    await expectReachableByKeyboard(user, [
      screen.getByRole("button", { name: "Close settings" }),
      ...["Profile", "Keybinds", "Commands", "Plugins", "Account", "About"].map((name) =>
        screen.getByRole("button", { name }),
      ),
      keyboard,
    ]);
    keyboard.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("keyboard-settings")).toBeInTheDocument();
  });

  it("moves between tabs with Up and Down, across section labels", async () => {
    const user = userEvent.setup();
    renderSettings();
    screen.getByRole("button", { name: "Contacts" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Messages" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("button", { name: "Security" })).toHaveFocus();
  });

  it("shows Profile tab content by default", () => {
    renderSettings();
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("switches to Keybinds tab", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Keybinds"));
    expect(screen.getByTestId("keybind-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
  });

  it("switches to Commands tab", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Commands"));
    expect(screen.getByTestId("command-settings")).toBeInTheDocument();
  });

  it("switches to Plugins tab", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Plugins"));
    expect(await screen.findByTestId("plugin-settings")).toBeInTheDocument();
  });

  it("switches to AI Agent tab", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("AI Agent"));
    expect(await screen.findByTestId("agent-settings")).toBeInTheDocument();
  });

  it("switches to Account tab", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Account"));
    expect(screen.getByTestId("account-settings")).toBeInTheDocument();
  });

  it("shows the server's instance notice at the top of About, and none without one", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSettings({}, { instanceNotice: "Run by Acme." });
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("note", { name: "Notice from this server" })).toHaveTextContent(
      "Run by Acme.",
    );
    unmount();

    renderSettings();
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("switches to About tab and shows about panel", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: "About" }));
    // About panel renders an "About RIM" heading plus product blurb.
    expect(screen.getByRole("heading", { name: "About RIM" })).toBeInTheDocument();
    expect(screen.getByText("Version 9.9.9")).toBeInTheDocument();
    expect(screen.getByText("Server 8.8.8")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Newer server API");
    expect(screen.getByTestId("about-updates")).toBeInTheDocument();
    expect(screen.getByTestId("about-notices")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open log folder" })).toBeInTheDocument();
    expect(screen.getByText("A programmable communication workspace.")).toBeInTheDocument();
  });

  it("close button navigates to conversation surface", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText("Close settings"));
    expect(mockSetMainSurface).toHaveBeenCalledWith({ kind: "conversation" });
  });

  it("Account tab can navigate back to Profile", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Account"));
    await user.click(screen.getByText("Go to profile"));
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("Notifications tab renders", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Notifications"));
    expect(screen.getByTestId("notification-settings")).toBeInTheDocument();
  });

  it("Messages tab shows the inline media switch", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Messages"));
    expect(screen.getByRole("switch", { name: "Show inline media" })).toBeInTheDocument();
  });

  it("Macros tab renders", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByText("Macros"));
    expect(screen.getByTestId("macro-settings")).toBeInTheDocument();
  });

  // ── Tab routing via MainSurface ─────────────────────────────────────────────

  it("opens on the Plugins tab when surface.tab is 'plugins'", async () => {
    mockShellState.mainSurface = { kind: "settings", tab: "plugins" };
    renderSettings();
    expect(await screen.findByTestId("plugin-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
  });

  it("falls back to Profile tab when surface has no tab hint", () => {
    mockShellState.mainSurface = { kind: "settings" };
    renderSettings();
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("falls back to Profile tab when surface.tab is an unknown value", () => {
    mockShellState.mainSurface = { kind: "settings", tab: "does-not-exist" };
    renderSettings();
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("opens on the Keybinds tab when surface.tab is 'keybinds'", () => {
    mockShellState.mainSurface = { kind: "settings", tab: "keybinds" };
    renderSettings();
    expect(screen.getByTestId("keybind-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
  });

  describe("Workspace tab", () => {
    it("is hidden for an ordinary member, even when deep-linked", () => {
      mockShellState.mainSurface = { kind: "settings", tab: "workspace" };
      renderSettings();
      expect(screen.queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("moderation-settings")).not.toBeInTheDocument();
      expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
    });

    it("is offered to a moderator with the moderation settings", async () => {
      mockGate.canModerate = true;
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByRole("button", { name: "Workspace" }));
      expect(await screen.findByTestId("moderation-settings")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-dm-settings")).toBeInTheDocument();
    });
  });

  describe("Moderation tab", () => {
    it("is hidden for a non-operator, whom a deep link takes to the operators-only page", async () => {
      mockShellState.mainSurface = { kind: "settings", tab: "moderation" };
      renderSettings();
      expect(screen.queryByRole("group", { name: "Instance" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Moderation" })).not.toBeInTheDocument();
      expect(await screen.findByTestId("instance-moderation")).toBeInTheDocument();
      expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
    });

    it("is offered to an instance operator under Instance", async () => {
      mockOperator.isOperator = true;
      const user = userEvent.setup();
      renderSettings();

      const instance = screen.getByRole("group", { name: "Instance" });
      await user.click(within(instance).getByRole("button", { name: "Moderation" }));
      expect(await screen.findByTestId("instance-moderation")).toBeInTheDocument();
    });
  });

  it("lists the server's features in About", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("list", { name: "Server features" })).toBeInTheDocument();
  });

  describe("Emoji tab", () => {
    it("is offered while the server runs custom emoji", () => {
      renderSettings();
      expect(screen.getByRole("button", { name: "Emoji" })).toBeInTheDocument();
    });

    it("is hidden, even when deep-linked, while custom emoji is switched off", () => {
      mockShellState.mainSurface = { kind: "settings", tab: "emoji" };
      renderSettings({ custom_emoji: ServerFeatureState.DISABLED });
      expect(screen.queryByRole("button", { name: "Emoji" })).not.toBeInTheDocument();
      expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
    });
  });

  it("hides Pipelines, State and Emoji in a direct space, even when deep-linked", () => {
    startRelayWithDirectSpace();
    mockWorkspace.workspaceId = DIRECT_SPACE_ID;
    mockShellState.mainSurface = { kind: "settings", tab: "pipelines" };
    renderSettings();

    for (const name of ["Pipelines", "State", "Emoji"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Keybinds" })).toBeInTheDocument();
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });
});
