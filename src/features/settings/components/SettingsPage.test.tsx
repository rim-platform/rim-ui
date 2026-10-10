import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

// Owner role and workspace feature flags (Track 0.4) — mutable per test.
const mockGate = { isOwner: false, canModerate: false, incidentsEnabled: true };

vi.mock("../../workspaces/api/useMyServerRole", () => ({
  useIsOwner: () => mockGate.isOwner,
  useCanModerate: () => mockGate.canModerate,
}));

vi.mock("../../workspaces/hooks/useFeatureEnabled", () => ({
  useFeatureEnabled: () => mockGate.incidentsEnabled,
}));

vi.mock("./WorkspaceFeatureSettings", () => ({
  WorkspaceFeatureSettings: () => <div data-testid="workspace-feature-settings">Workspace</div>,
}));

vi.mock("../../plugins/registry/components/WorkspacePluginSettings", () => ({
  WorkspacePluginSettings: () => null,
}));
vi.mock("./ModerationSettings", () => ({
  ModerationSettings: () => <div data-testid="moderation-settings">Moderation</div>,
}));

vi.mock("../../updater/components/AboutUpdates", () => ({
  AboutVersion: () => <p>Version 9.9.9</p>,
  AboutUpdates: () => <div data-testid="about-updates">Updates</div>,
}));

vi.mock("../../integrations/components/IngestTokenSettings", () => ({
  IngestTokenSettings: () => <div data-testid="ingest-token-settings">Integrations</div>,
}));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default settings surface with no tab hint between tests.
    mockShellState.mainSurface = { kind: "settings" };
    mockGate.isOwner = false;
    mockGate.canModerate = false;
    mockGate.incidentsEnabled = true;
  });

  it("renders with header and tabs", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Keybinds")).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.getByText("Plugin AI")).toBeInTheDocument();
    expect(screen.getByText("AI Agent")).toBeInTheDocument();
    expect(screen.queryByText("AI Keys")).not.toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("shows Profile tab content by default", () => {
    render(<SettingsPage />);
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("switches to Keybinds tab", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Keybinds"));
    expect(screen.getByTestId("keybind-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
  });

  it("switches to Commands tab", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Commands"));
    expect(screen.getByTestId("command-settings")).toBeInTheDocument();
  });

  it("switches to Plugins tab", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Plugins"));
    expect(await screen.findByTestId("plugin-settings")).toBeInTheDocument();
  });

  it("switches to AI Agent tab", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("AI Agent"));
    expect(await screen.findByTestId("agent-settings")).toBeInTheDocument();
  });

  it("switches to Account tab", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Account"));
    expect(screen.getByTestId("account-settings")).toBeInTheDocument();
  });

  it("switches to About tab and shows about panel", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("About"));
    // About panel renders an "About RIM" heading plus product blurb.
    expect(screen.getByRole("heading", { name: "About RIM" })).toBeInTheDocument();
    expect(screen.getByText("Version 9.9.9")).toBeInTheDocument();
    expect(screen.getByTestId("about-updates")).toBeInTheDocument();
    expect(screen.getByText("A programmable communication workspace.")).toBeInTheDocument();
  });

  it("close button navigates to conversation surface", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByLabelText("Close settings"));
    expect(mockSetMainSurface).toHaveBeenCalledWith({ kind: "conversation" });
  });

  it("Account tab can navigate back to Profile", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Account"));
    await user.click(screen.getByText("Go to profile"));
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("Notifications tab renders", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Notifications"));
    expect(screen.getByTestId("notification-settings")).toBeInTheDocument();
  });

  it("Macros tab renders", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByText("Macros"));
    expect(screen.getByTestId("macro-settings")).toBeInTheDocument();
  });

  // ── Tab routing via MainSurface ─────────────────────────────────────────────

  it("opens on the Plugins tab when surface.tab is 'plugins'", async () => {
    mockShellState.mainSurface = { kind: "settings", tab: "plugins" };
    render(<SettingsPage />);
    expect(await screen.findByTestId("plugin-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
  });

  it("falls back to Profile tab when surface has no tab hint", () => {
    mockShellState.mainSurface = { kind: "settings" };
    render(<SettingsPage />);
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("falls back to Profile tab when surface.tab is an unknown value", () => {
    mockShellState.mainSurface = { kind: "settings", tab: "does-not-exist" };
    render(<SettingsPage />);
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
  });

  it("opens on the Keybinds tab when surface.tab is 'keybinds'", () => {
    mockShellState.mainSurface = { kind: "settings", tab: "keybinds" };
    render(<SettingsPage />);
    expect(screen.getByTestId("keybind-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-settings")).not.toBeInTheDocument();
  });

  describe("Workspace tab (Track 0.4, Track 1.2)", () => {
    it("is hidden for an ordinary member, even when deep-linked", () => {
      mockShellState.mainSurface = { kind: "settings", tab: "workspace" };
      render(<SettingsPage />);
      expect(screen.queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("workspace-feature-settings")).not.toBeInTheDocument();
      expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
    });

    it("is offered to the owner with the feature settings and moderation", async () => {
      mockGate.isOwner = true;
      mockGate.canModerate = true;
      const user = userEvent.setup();
      render(<SettingsPage />);

      await user.click(screen.getByRole("button", { name: "Workspace" }));
      expect(await screen.findByTestId("workspace-feature-settings")).toBeInTheDocument();
      expect(await screen.findByTestId("moderation-settings")).toBeInTheDocument();
    });

    it("is offered to a moderator with moderation only (feature flags stay Owner-only)", async () => {
      mockGate.canModerate = true;
      const user = userEvent.setup();
      render(<SettingsPage />);

      await user.click(screen.getByRole("button", { name: "Workspace" }));
      expect(await screen.findByTestId("moderation-settings")).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-feature-settings")).not.toBeInTheDocument();
    });
  });

  describe("incidents module gate (Track 0.4)", () => {
    it("hides the Integrations (alert ingest) tab when incidents are off", () => {
      mockGate.incidentsEnabled = false;
      render(<SettingsPage />);
      expect(screen.queryByRole("button", { name: "Integrations" })).not.toBeInTheDocument();
    });

    it("shows the Integrations tab when incidents are on", async () => {
      const user = userEvent.setup();
      render(<SettingsPage />);
      await user.click(screen.getByRole("button", { name: "Integrations" }));
      expect(await screen.findByTestId("ingest-token-settings")).toBeInTheDocument();
    });

    it("drops the incident line from About when incidents are off", async () => {
      mockGate.incidentsEnabled = false;
      const user = userEvent.setup();
      render(<SettingsPage />);
      await user.click(screen.getByRole("button", { name: "About" }));
      expect(
        screen.queryByText("Incident management with timeline and postmortem"),
      ).not.toBeInTheDocument();
    });
  });
});
