import { useState, useEffect, useId, lazy, Suspense } from "react";
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
import { handleVerticalStripKeys } from "../../../shared/ui/focusNavigation";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { AboutLogFolder } from "../../updater/components/AboutLogFolder";
import { AboutNotices } from "../../updater/components/AboutNotices";
import { AboutUpdates, AboutVersion } from "../../updater/components/AboutUpdates";
import {
  AboutServerApiBanner,
  AboutServerFeatures,
  AboutServerVersion,
} from "../../updater/components/AboutServer";
import { InstanceNotice } from "../../updater/components/InstanceNotice";
import { useServerFeature } from "../../updater/hooks/useServerFeature";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useIsInstanceOperator } from "../../instance-moderation/api/instanceModeration";
import { RimMark } from "../../../shared/brand/RimLogo";
import { OperatorDmPolicy } from "../../dm-policy/components/OperatorDmPolicy";
import { joinRequestBadge, useJoinRequestCount } from "../../public-link/api/publicLink";
import { useCanHavePublicLink } from "../../public-link/hooks/useCanHavePublicLink";

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
const ModerationSettings = lazy(() =>
  import("./ModerationSettings").then((m) => ({
    default: m.ModerationSettings,
  })),
);
const WorkspaceInvites = lazy(() =>
  import("./WorkspaceInvites").then((m) => ({
    default: m.WorkspaceInvites,
  })),
);
const PublicLinkSettings = lazy(() =>
  import("../../public-link/components/PublicLinkSettings").then((m) => ({
    default: m.PublicLinkSettings,
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
const WorkspaceOwnerSettings = lazy(() =>
  import("./WorkspaceOwnerSettings").then((m) => ({
    default: m.WorkspaceOwnerSettings,
  })),
);
const InstanceModerationSettings = lazy(() =>
  import("../../instance-moderation/components/InstanceModerationSettings").then((m) => ({
    default: m.InstanceModerationSettings,
  })),
);
const DmSettings = lazy(() =>
  import("../../dm-policy/components/DmSettings").then((m) => ({
    default: m.DmSettings,
  })),
);
const WorkspaceDmPolicySettings = lazy(() =>
  import("../../dm-policy/components/WorkspaceDmPolicySettings").then((m) => ({
    default: m.WorkspaceDmPolicySettings,
  })),
);
const ContactsSettings = lazy(() =>
  import("../../relay/components/ContactsSettings").then((m) => ({
    default: m.ContactsSettings,
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
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">About RIM</h2>
        <p className="mt-1 text-sm text-rim-text-muted">A programmable communication workspace.</p>
      </div>

      <InstanceNotice />

      <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rim-void text-rim-text">
            <RimMark className="h-7 w-7" />
          </div>
          <div>
            <p className="text-sm font-semibold text-rim-text">RIM</p>
            <AboutVersion />
            <AboutServerVersion />
            <AboutLogFolder />
          </div>
        </div>

        <AboutServerFeatures />

        <OperatorDmPolicy />

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
            <p className="font-medium text-rim-text">Apache-2.0</p>
          </div>
        </div>
      </div>

      <AboutUpdates />

      <AboutNotices />

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
  | "direct-messages"
  | "notifications"
  | "history"
  | "workspace"
  | "security"
  | "contacts"
  | "account"
  | "workspace-moderation"
  | "moderation"
  | "about";

/** Tabs that edit what only a workspace has: hidden in a direct space. */
const WORKSPACE_ONLY_TABS: readonly SettingsTab[] = [
  "pipelines",
  "state",
  "emoji",
  "workspace",
  "workspace-moderation",
];

/** Sections of the settings navigation, in display order. */
const groups = [
  "You",
  "Messaging",
  "Programmable",
  "Extensions",
  "Workspace",
  "Instance",
  "About",
] as const;

type SettingsGroup = (typeof groups)[number];

const tabs: { key: SettingsTab; label: string; group: SettingsGroup }[] = [
  { key: "profile", label: "Profile", group: "You" },
  { key: "account", label: "Account", group: "You" },
  { key: "security", label: "Security", group: "You" },
  { key: "contacts", label: "Contacts", group: "You" },
  { key: "messages", label: "Messages", group: "Messaging" },
  { key: "direct-messages", label: "Direct messages", group: "Messaging" },
  { key: "notifications", label: "Notifications", group: "Messaging" },
  { key: "history", label: "History", group: "Messaging" },
  { key: "keybinds", label: "Keybinds", group: "Programmable" },
  { key: "keyboard", label: "Keyboard", group: "Programmable" },
  { key: "commands", label: "Commands", group: "Programmable" },
  { key: "macros", label: "Macros", group: "Programmable" },
  { key: "pipelines", label: "Pipelines", group: "Programmable" },
  { key: "plugins", label: "Plugins", group: "Extensions" },
  { key: "plugin-ai", label: "Plugin AI", group: "Extensions" },
  { key: "state", label: "State", group: "Extensions" },
  { key: "emoji", label: "Emoji", group: "Extensions" },
  { key: "agent", label: "AI Agent", group: "Extensions" },
  { key: "workspace", label: "Workspace", group: "Workspace" },
  { key: "workspace-moderation", label: "Moderation", group: "Workspace" },
  { key: "moderation", label: "Instance moderation", group: "Instance" },
  { key: "about", label: "About", group: "About" },
];

export function SettingsPage() {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  // Resolve the requested tab from the surface, defaulting to "profile".
  // The requested tab must exist in the tab list, so a
  // stale or typo'd value doesn't silently show an empty panel.
  const resolveTab = (surface: typeof mainSurface): SettingsTab => {
    if (surface.kind === "settings" && surface.tab) {
      const found = tabs.find((t) => t.key === surface.tab);
      if (found) return found.key;
    }
    return "profile";
  };

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveTab(mainSurface));

  // Workspace holds the Owner/Moderator settings and stays hidden until the role is known.
  // A requested tab that is hidden falls back to Profile without forgetting the request, so a
  // deep link lands once the role loads.
  const canModerate = useCanModerate(workspaceId ?? undefined);
  // Emoji management needs custom emoji on the server.
  const customEmoji = useServerFeature("custom_emoji").enabled;
  const inDirectSpace = useIsDirectSpace(workspaceId);
  // Instance moderation is listed for instance operators only. Opened directly by anyone else,
  // the page says it is for operators instead of falling back to Profile.
  const { isOperator } = useIsInstanceOperator();
  // Open join requests, counted on the Moderation entry.
  const canHaveLink = useCanHavePublicLink(workspaceId);
  const { data: requestCount } = useJoinRequestCount(workspaceId, canModerate && canHaveLink);
  const moderationBadge = canModerate && canHaveLink ? joinRequestBadge(requestCount) : null;
  const visibleTabs = tabs.filter(
    (tab) =>
      (!["workspace", "workspace-moderation"].includes(tab.key) || canModerate) &&
      (tab.key !== "moderation" || isOperator) &&
      (tab.key !== "emoji" || customEmoji) &&
      !(inDirectSpace && WORKSPACE_ONLY_TABS.includes(tab.key)),
  );
  const shownTab: SettingsTab =
    activeTab === "moderation" || visibleTabs.some((tab) => tab.key === activeTab)
      ? activeTab
      : "profile";
  // Groups with no visible tab are left out, label included.
  const visibleGroups = groups
    .map((group) => ({ group, items: visibleTabs.filter((tab) => tab.group === group) }))
    .filter(({ items }) => items.length > 0);
  const groupIdPrefix = useId();

  // When the caller navigates to settings again (e.g. "Manage plugins" while
  // settings is already open), the surface updates but the component stays
  // mounted, so the tab is synced here.
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

      <div className="flex min-h-0 flex-1">
        {/* Section navigation */}
        <nav
          aria-label="Settings sections"
          onKeyDown={handleVerticalStripKeys}
          className="w-52 shrink-0 overflow-y-auto border-r border-rim-line bg-rim-void px-2 pb-4"
        >
          {visibleGroups.map(({ group, items }) => {
            const labelId = `${groupIdPrefix}-${group}`;
            return (
              <div key={group} role="group" aria-labelledby={labelId}>
                <p
                  id={labelId}
                  className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-rim-text-faint"
                >
                  {group}
                </p>
                {items.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    aria-current={shownTab === tab.key ? "page" : undefined}
                    className={cn(
                      "block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                      shownTab === tab.key
                        ? "bg-rim-panel-soft text-rim-text"
                        : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
                    )}
                  >
                    {tab.label}
                    {tab.key === "workspace-moderation" && moderationBadge && (
                      <>
                        <span
                          aria-hidden="true"
                          className="ml-2 rounded-full bg-rim-accent px-1.5 text-[10px] font-semibold text-rim-void"
                        >
                          {moderationBadge}
                        </span>
                        <span className="sr-only">, {moderationBadge} join requests</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Tab content */}
        <div className="min-w-0 flex-1 overflow-y-auto">
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
              {shownTab === "state" && (
                <WorkspaceStateSettings serverId={workspaceId ?? undefined} />
              )}
              {shownTab === "agent" && <AgentSettingsPanel />}
              {shownTab === "messages" && <MessageDisplaySettings />}
              {shownTab === "direct-messages" && <DmSettings />}
              {shownTab === "notifications" && <NotificationSettings />}
              {shownTab === "history" && <HistoryArchiveSettings />}
              {shownTab === "workspace" && (
                <div className="space-y-10">
                  <WorkspaceInvites serverId={workspaceId} />
                  <PublicLinkSettings
                    serverId={workspaceId}
                    onOpenRequests={() => setActiveTab("workspace-moderation")}
                  />
                  <WorkspaceDmPolicySettings serverId={workspaceId} />
                  <WorkspacePluginSettings serverId={workspaceId} />
                  <WorkspaceOwnerSettings serverId={workspaceId} />
                </div>
              )}
              {shownTab === "security" && <KeyIdentitySettings />}
              {shownTab === "contacts" && <ContactsSettings />}
              {shownTab === "workspace-moderation" && workspaceId && (
                <ModerationSettings serverId={workspaceId} />
              )}
              {shownTab === "moderation" && (
                <InstanceModerationSettings
                  onNavigateToWorkspaceModeration={
                    canModerate && !inDirectSpace
                      ? () => setActiveTab("workspace-moderation")
                      : undefined
                  }
                />
              )}

              {shownTab === "account" && (
                <AccountSettings
                  onNavigateToProfile={() => setActiveTab("profile")}
                  onNavigateToWorkspace={() => setActiveTab("workspace")}
                />
              )}
              {shownTab === "about" && <AboutRim />}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
