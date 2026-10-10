import { useState, useEffect, lazy, Suspense } from "react";
import { X, Loader2 } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { KeybindSettings } from "../../commands/components/KeybindSettings";
import { KeyboardSettings } from "../../commands/components/KeyboardSettings";
import { UserCommandSettings } from "../../commands/components/UserCommandSettings";
import { NotificationSettings } from "../../notifications/components/NotificationSettings";
import { MessageDisplaySettings } from "../../messages/components/MessageDisplaySettings";
import { MacroSettings } from "../../macros/components/MacroSettings";
import { PipelineSettings } from "../../pipelines/components/PipelineSettings";
import { ProfileSettings } from "./ProfileSettings";
import { AccountSettings } from "./AccountSettings";
import { cn } from "../../../shared/ui/cn";
import { useCanModerate, useIsOwner } from "../../workspaces/api/useMyServerRole";
import { useFeatureEnabled } from "../../workspaces/hooks/useFeatureEnabled";
import { WorkspaceFeature } from "../../../core/graphql/generated/schema-types";
import { AboutUpdates, AboutVersion } from "../../updater/components/AboutUpdates";
import { AboutServerApiBanner, AboutServerVersion } from "../../updater/components/AboutServer";

// Lazy-load heavier / rarely-used settings panels
const PluginSettingsPage = lazy(() =>
  import("../../plugins/components/PluginSettingsPage").then((m) => ({
    default: m.PluginSettingsPage,
  })),
);
const PluginAiConsentPanel = lazy(() =>
  import("../../plugins/components/PluginAiConsentPanel").then((m) => ({
    default: m.PluginAiConsentPanel,
  })),
);
const AgentSettingsPanel = lazy(() =>
  import("../../agent/settings/AgentSettingsPanel").then((m) => ({
    default: m.AgentSettingsPanel,
  })),
);
const EmojiManagement = lazy(() =>
  import("../../emoji/components/EmojiManagement").then((m) => ({ default: m.EmojiManagement })),
);
const WorkspaceStateSettings = lazy(() =>
  import("../../workspace-state/components/WorkspaceStateSettings").then((m) => ({
    default: m.WorkspaceStateSettings,
  })),
);
const WorkspaceFeatureSettings = lazy(() =>
  import("./WorkspaceFeatureSettings").then((m) => ({
    default: m.WorkspaceFeatureSettings,
  })),
);
const ModerationSettings = lazy(() =>
  import("./ModerationSettings").then((m) => ({
    default: m.ModerationSettings,
  })),
);
const WorkspacePluginSettings = lazy(() =>
  import("../../plugins/registry/components/WorkspacePluginSettings").then((m) => ({
    default: m.WorkspacePluginSettings,
  })),
);
const HistoryArchiveSettings = lazy(() =>
  import("../../history-archive/components/HistoryArchiveSettings").then((m) => ({
    default: m.HistoryArchiveSettings,
  })),
);
const KeyIdentitySettings = lazy(() =>
  import("../../key-identity/components/KeyIdentitySettings").then((m) => ({
    default: m.KeyIdentitySettings,
  })),
);
const ContactsSettings = lazy(() =>
  import("../../relay/components/ContactsSettings").then((m) => ({
    default: m.ContactsSettings,
  })),
);
const IngestTokenSettings = lazy(() =>
  import("../../integrations/components/IngestTokenSettings").then((m) => ({
    default: m.IngestTokenSettings,
  })),
);

function SettingsLoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-rim-accent" />
    </div>
  );
}

function AboutRim() {
  const incidentsEnabled = useFeatureEnabled(WorkspaceFeature.INCIDENTS);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">About RIM</h2>
        <p className="mt-1 text-sm text-rim-text-muted">A programmable communication workspace.</p>
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rim-accent/10 text-rim-accent font-bold text-lg">
            R
          </div>
          <div>
            <p className="text-sm font-semibold text-rim-text">RIM</p>
            <AboutVersion />
            <AboutServerVersion />
          </div>
        </div>

        <AboutServerApiBanner />

        <p className="text-sm text-rim-text-muted leading-relaxed">
          RIM is not another chat app. Chat is the communication layer &mdash; commands, keybinds,
          macros, and plugins are the product. Built for teams that think in workflows, not just
          messages.
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">Runtime</span>
            <p className="font-medium text-rim-text">Tauri 2 + React 19</p>
          </div>
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">Backend</span>
            <p className="font-medium text-rim-text">Rust + Actix + GraphQL</p>
          </div>
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">UI</span>
            <p className="font-medium text-rim-text">TypeScript + Tailwind CSS</p>
          </div>
          <div className="rounded-md bg-rim-void px-3 py-2">
            <span className="text-rim-text-faint">License</span>
            <p className="font-medium text-rim-text">Proprietary</p>
          </div>
        </div>
      </div>

      <AboutUpdates />

      <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-3">
        <p className="text-sm font-medium text-rim-text">Core Capabilities</p>
        <ul className="space-y-1.5 text-sm text-rim-text-muted">
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Command palette with 19+ keybinds and slash commands
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Macro builder with AI-assisted step generation
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Reactive pipelines &mdash; event-driven automation
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Plugin system with capability-based security
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            AI agent with tool-calling and multi-provider support
          </li>
          {incidentsEnabled && (
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-rim-accent" />
              Incident management with timeline and postmortem
            </li>
          )}
          <li className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-rim-accent" />
            Channel lenses &mdash; filtered message views
          </li>
        </ul>
      </div>

      <p className="text-xs text-rim-text-faint">
        Built with obsessive attention to developer workflows.
      </p>
    </div>
  );
}

type SettingsTab =
  | "profile"
  | "keybinds"
  | "keyboard"
  | "commands"
  | "macros"
  | "pipelines"
  | "plugins"
  | "plugin-ai"
  | "emoji"
  | "state"
  | "agent"
  | "messages"
  | "notifications"
  | "history"
  | "workspace"
  | "integrations"
  | "security"
  | "contacts"
  | "account"
  | "about";

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "keybinds", label: "Keybinds" },
  { key: "keyboard", label: "Keyboard" },
  { key: "commands", label: "Commands" },
  { key: "macros", label: "Macros" },
  { key: "pipelines", label: "Pipelines" },
  { key: "plugins", label: "Plugins" },
  { key: "plugin-ai", label: "Plugin AI" },
  { key: "emoji", label: "Emoji" },
  { key: "state", label: "State" },
  { key: "agent", label: "AI Agent" },
  { key: "messages", label: "Messages" },
  { key: "notifications", label: "Notifications" },
  { key: "history", label: "History" },
  { key: "workspace", label: "Workspace" },
  { key: "integrations", label: "Integrations" },
  { key: "security", label: "Security" },
  { key: "contacts", label: "Contacts" },
  { key: "account", label: "Account" },
  { key: "about", label: "About" },
];

export function SettingsPage() {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  // Resolve the requested tab from the surface, defaulting to "profile".
  // We validate that the requested tab actually exists in our tab list so a
  // stale or typo'd value doesn't silently show an empty panel.
  const resolveTab = (surface: typeof mainSurface): SettingsTab => {
    if (surface.kind === "settings" && surface.tab) {
      const found = tabs.find((t) => t.key === surface.tab);
      if (found) return found.key;
    }
    return "profile";
  };

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveTab(mainSurface));

  // Workspace holds the Owner-only feature flags (Track 0.4) and the Owner/Moderator
  // Moderation section (Track 1.2); Integrations holds only the alert-ingest tokens, which
  // belong to the optional incidents module. Both stay hidden until the role / flag is known.
  // A requested tab that is hidden falls back to Profile without forgetting the request, so a
  // deep link lands once the role / flag loads.
  const isOwner = useIsOwner(workspaceId ?? undefined);
  const canModerate = useCanModerate(workspaceId ?? undefined);
  const incidentsEnabled = useFeatureEnabled(WorkspaceFeature.INCIDENTS);
  const visibleTabs = tabs.filter(
    (tab) =>
      (tab.key !== "workspace" || canModerate) && (tab.key !== "integrations" || incidentsEnabled),
  );
  const shownTab: SettingsTab = visibleTabs.some((tab) => tab.key === activeTab)
    ? activeTab
    : "profile";

  // When the caller navigates to settings again (e.g. "Manage plugins" while
  // settings is already open), the surface updates but the component stays
  // mounted, so we need to sync.
  useEffect(() => {
    if (mainSurface.kind === "settings") {
      setActiveTab(resolveTab(mainSurface));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainSurface]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-rim-line px-8">
        <h1 className="text-lg font-semibold text-rim-text">Settings</h1>
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "conversation" })}
          title="Close settings"
          aria-label="Close settings"
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-rim-line px-8">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors",
              shownTab === tab.key
                ? "border-b-2 border-rim-accent text-rim-text"
                : "text-rim-text-muted hover:text-rim-text",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <Suspense fallback={<SettingsLoadingSpinner />}>
            {shownTab === "profile" && <ProfileSettings />}
            {shownTab === "keybinds" && <KeybindSettings />}
            {shownTab === "keyboard" && <KeyboardSettings />}
            {shownTab === "commands" && <UserCommandSettings />}
            {shownTab === "macros" && <MacroSettings />}
            {shownTab === "pipelines" && <PipelineSettings />}
            {shownTab === "plugins" && <PluginSettingsPage />}
            {shownTab === "plugin-ai" && <PluginAiConsentPanel />}
            {shownTab === "emoji" && <EmojiManagement serverId={workspaceId} />}
            {shownTab === "state" && <WorkspaceStateSettings serverId={workspaceId ?? undefined} />}
            {shownTab === "agent" && <AgentSettingsPanel />}
            {shownTab === "messages" && <MessageDisplaySettings />}
            {shownTab === "notifications" && <NotificationSettings />}
            {shownTab === "history" && <HistoryArchiveSettings />}
            {shownTab === "workspace" && (
              <div className="space-y-10">
                {isOwner && <WorkspaceFeatureSettings serverId={workspaceId} />}
                <ModerationSettings serverId={workspaceId} />
                <WorkspacePluginSettings serverId={workspaceId} />
              </div>
            )}
            {shownTab === "integrations" && <IngestTokenSettings serverId={workspaceId} />}
            {shownTab === "security" && <KeyIdentitySettings />}
            {shownTab === "contacts" && <ContactsSettings />}
            {shownTab === "account" && (
              <AccountSettings onNavigateToProfile={() => setActiveTab("profile")} />
            )}
            {shownTab === "about" && <AboutRim />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
