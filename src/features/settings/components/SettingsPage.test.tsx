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

vi.mock("../../agent/settings/AiProviderKeySettings", () => ({
  AiProviderKeySettings: () => <div data-testid="ai-key-settings">AI Keys Panel</div>,
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

vi.mock("../../../shell/state/useShellStore", () => ({
  useShellStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setMainSurface: mockSetMainSurface }),
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: "ws-1" }),
}));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText("AI Keys")).toBeInTheDocument();
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
    expect(
      screen.getByRole("heading", { name: "About RIM" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A programmable communication workspace."),
    ).toBeInTheDocument();
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
});
