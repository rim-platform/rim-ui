import { useCanManageBots } from "../../bots/availability";
import { useState, useEffect, useId, useRef, Suspense } from "react";
import { X, Loader2 } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useShellWidth } from "../../../shell/hooks/useShellWidth";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { KeybindSettings } from "../../commands/components/KeybindSettings";
import { KeyboardSettings } from "../../commands/components/KeyboardSettings";
import { UserCommandSettings } from "../../commands/components/UserCommandSettings";
import { NotificationSettings } from "../../notifications/components/NotificationSettings";
import { MessageDisplaySettings } from "../../messages/components/MessageDisplaySettings";
import { MacroSettings } from "../../macros/components/MacroSettings";
import { WorkspaceMacroSettings } from "../../macros/components/WorkspaceMacroSettings";
import { useAccountMacrosOn } from "../../macros/api/useAccountMacros";
import { PipelineSettings } from "../../pipelines/components/PipelineSettings";
import { SurfaceErrorBoundary } from "../../../shared/ui/SurfaceErrorBoundary";
import { lazyWithRetry } from "../../../shared/lazy/importWithRetry";
import { agentAvailable } from "../../agent/agentAvailability";
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
import { joinRequestBadge, useJoinRequestCount } from "../../workspaces/api/publicJoinLink";
import { useCanHavePublicLink } from "../../workspaces/hooks/useCanHavePublicLink";
import { desktopShellAvailable } from "../../desktop-shell/availability";
import { DesktopSettings } from "../../desktop-shell/components/DesktopSettings";
import {
  listedSettingsTab,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  visibleSettingsTabs,
  type SettingsTab,
} from "../settingsTabs";

export { SETTINGS_TABS, visibleSettingsTabs };
export type { SettingsTab, SettingsTabAccess } from "../settingsTabs";

// Lazy-load heavier / rarely-used settings panels
const PluginSettingsPage = lazyWithRetry(() =>
  import("../../plugins/components/PluginSettingsPage").then((m) => ({
    default: m.PluginSettingsPage,
  })),
);
const AgentSettingsPanel = lazyWithRetry(() =>
  import("../../agent/settings/AgentSettingsPanel").then((m) => ({
    default: m.AgentSettingsPanel,
  })),
);
const AgentsSettings = lazyWithRetry(() =>
  import("../../agents/components/AgentsSettings").then((m) => ({
    default: m.AgentsSettings,
  })),
);
const EmojiManagement = lazyWithRetry(() =>
  import("../../emoji/components/EmojiManagement").then((m) => ({ default: m.EmojiManagement })),
);
const BotsSettings = lazyWithRetry(() =>
  import("../../bots/components/BotsSettings").then((m) => ({ default: m.BotsSettings })),
);
const WorkspaceStateSettings = lazyWithRetry(() =>
  import("../../workspace-state/components/WorkspaceStateSettings").then((m) => ({
    default: m.WorkspaceStateSettings,
  })),
);
const ModerationSettings = lazyWithRetry(() =>
  import("./ModerationSettings").then((m) => ({
    default: m.ModerationSettings,
  })),
);
const WorkspaceInvites = lazyWithRetry(() =>
  import("./WorkspaceInvites").then((m) => ({
    default: m.WorkspaceInvites,
  })),
);
const PublicLinkSettings = lazyWithRetry(() =>
  import("./PublicLinkSettings").then((m) => ({
    default: m.PublicLinkSettings,
  })),
);
const WorkspacePluginSettings = lazyWithRetry(() =>
  import("../../plugins/registry/components/WorkspacePluginSettings").then((m) => ({
    default: m.WorkspacePluginSettings,
  })),
);
const HistoryArchiveSettings = lazyWithRetry(() =>
  import("../../history-archive/components/HistoryArchiveSettings").then((m) => ({
    default: m.HistoryArchiveSettings,
  })),
);
const KeyIdentitySettings = lazyWithRetry(() =>
  import("../../key-identity/components/KeyIdentitySettings").then((m) => ({
    default: m.KeyIdentitySettings,
  })),
);
const WorkspaceOwnerSettings = lazyWithRetry(() =>
  import("./WorkspaceOwnerSettings").then((m) => ({
    default: m.WorkspaceOwnerSettings,
  })),
);
const WorkspaceNameSettings = lazyWithRetry(() =>
  import("./WorkspaceNameSettings").then((m) => ({
    default: m.WorkspaceNameSettings,
  })),
);
const InstanceModerationSettings = lazyWithRetry(() =>
  import("../../instance-moderation/components/InstanceModerationSettings").then((m) => ({
    default: m.InstanceModerationSettings,
  })),
);
const DmSettings = lazyWithRetry(() =>
  import("../../dm-policy/components/DmSettings").then((m) => ({
    default: m.DmSettings,
  })),
);
const WorkspaceDmPolicySettings = lazyWithRetry(() =>
  import("../../dm-policy/components/WorkspaceDmPolicySettings").then((m) => ({
    default: m.WorkspaceDmPolicySettings,
  })),
);
const ContactsSettings = lazyWithRetry(() =>
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

/** What each part of RIM is for, one line each, as About lists them. */
const WHATS_IN_RIM: readonly string[] = [
  "Commands: everything you can click, also from Ctrl+K or a key",
  "Macros: your own actions, made of commands",
  "Pipelines: do something when something happens in a workspace",
  "Lenses: filtered views of a channel",
  "Plugins: tools beside the conversation, with only the permissions you grant",
  "Assistant: an AI panel with your own key (desktop)",
  "Agents: programs on your computer, such as Claude Code, with the access you grant (desktop)",
];

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
        <p className="text-sm font-medium text-rim-text">What&apos;s in RIM</p>
        <ul className="space-y-1.5 text-sm text-rim-text-muted">
          {WHATS_IN_RIM.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-rim-accent" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-rim-text-faint">
        Built with obsessive attention to developer workflows.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const mainSurface = useShellStore((s) => s.mainSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  // Where the home server keeps the person's macros, Macros edits them and Commands is gone.
  const accountMacros = useAccountMacrosOn();

  // Resolve the requested tab from the surface, defaulting to "profile".
  // The requested tab must exist in the tab list, so a
  // stale or typo'd value doesn't silently show an empty panel. A section with a tab key of its
  // own opens the tab it is part of.
  const resolveTab = (surface: typeof mainSurface): SettingsTab => {
    if (surface.kind === "settings" && surface.tab) {
      const listed = listedSettingsTab(surface.tab as SettingsTab);
      const found = SETTINGS_TABS.find((t) => t.key === listed);
      if (found) return found.key;
    }
    return "profile";
  };
  // The section the surface asked for, when it named one by its own tab key.
  const resolveSection = (surface: typeof mainSurface): SettingsTab | null =>
    surface.kind === "settings" &&
    surface.tab &&
    listedSettingsTab(surface.tab as SettingsTab) !== surface.tab
      ? (surface.tab as SettingsTab)
      : null;

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveTab(mainSurface));
  const [section, setSection] = useState<SettingsTab | null>(() => resolveSection(mainSurface));
  const openTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSection(null);
  };

  // Workspace holds the Owner/Moderator settings and stays hidden until the role is known.
  // A requested tab that is hidden falls back to Profile without forgetting the request, so a
  // deep link lands once the role loads.
  const canModerate = useCanModerate(workspaceId ?? undefined);
  // Emoji management needs custom emoji on the server.
  const customEmoji = useServerFeature("custom_emoji").enabled;
  const inDirectSpace = useIsDirectSpace(workspaceId);
  // Bots are managed by moderators, on a server that lists the bots feature as enabled.
  const botsManageable = useCanManageBots(workspaceId);
  // Instance moderation is listed for instance operators only. Opened directly by anyone else,
  // the page says it is for operators instead of falling back to Profile.
  const { isOperator } = useIsInstanceOperator();
  // Open join requests, counted on the Moderation entry.
  const canHaveLink = useCanHavePublicLink(workspaceId);
  const { data: requestCount } = useJoinRequestCount(workspaceId, canModerate && canHaveLink);
  const moderationBadge = canModerate && canHaveLink ? joinRequestBadge(requestCount) : null;
  const visibleTabs = visibleSettingsTabs({
    canModerate,
    isOperator,
    customEmoji,
    botsManageable,
    agentAvailable: agentAvailable(),
    desktopShellAvailable: desktopShellAvailable(),
    inDirectSpace,
    accountMacros,
  });
  const narrow = useShellWidth() === "narrow";
  const requestedTab: SettingsTab =
    activeTab === "commands" && accountMacros ? "macros" : activeTab;
  const shownTab: SettingsTab =
    requestedTab === "moderation" || visibleTabs.some((tab) => tab.key === requestedTab)
      ? requestedTab
      : "profile";
  const sectionLabel = SETTINGS_TABS.find((tab) => tab.key === shownTab)?.label ?? "Settings";
  // Groups with no visible tab are left out, label included.
  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    group,
    items: visibleTabs.filter((tab) => tab.group === group),
  })).filter(({ items }) => items.length > 0);
  const groupIdPrefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // When the caller navigates to settings again (e.g. "Manage plugins" while
  // settings is already open), the surface updates but the component stays
  // mounted, so the tab is synced here.
  useEffect(() => {
    if (mainSurface.kind === "settings") {
      setActiveTab(resolveTab(mainSurface));
      setSection(resolveSection(mainSurface));
      // Tab starts on the page, not wherever focus was before the tab was opened.
      const panel = rootRef.current?.closest<HTMLElement>('[data-panel="mainSurface"]');
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainSurface]);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      {/* Header */}
      <div
        className={cn(
          "flex h-10 items-center justify-between border-b border-rim-line",
          narrow ? "px-4" : "px-8",
        )}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-rim-text">Settings</h1>
        </div>
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

      <div className={cn("flex min-h-0 flex-1", narrow && "flex-col")}>
        {/* Section navigation: a list beside the content, or one menu above it in a narrow window */}
        {narrow ? (
          <div className="shrink-0 border-b border-rim-line bg-rim-void px-3 py-2">
            <select
              aria-label="Settings sections"
              value={shownTab}
              onChange={(event) => openTab(event.target.value as SettingsTab)}
              className="w-full rounded-md border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text"
            >
              {visibleGroups.map(({ group, items }) => (
                <optgroup key={group} label={group}>
                  {items.map((tab) => (
                    <option key={tab.key} value={tab.key}>
                      {tab.label}
                      {tab.key === "workspace-moderation" && moderationBadge
                        ? ` (${moderationBadge} join requests)`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        ) : (
          <nav
            aria-label="Settings sections"
            onKeyDown={handleVerticalStripKeys}
            className="w-52 shrink-0 overflow-y-auto border-r border-rim-line bg-rim-void px-2 pb-4"
          >
            {visibleGroups.map(({ group, items }) => {
              // An id holds no spaces, which would make aria-labelledby name several ids.
              const labelId = `${groupIdPrefix}-${group.replace(/[^A-Za-z0-9]+/g, "-")}`;
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
                      onClick={() => openTab(tab.key)}
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
        )}

        {/* Tab content */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className={cn("mx-auto max-w-3xl", narrow ? "px-4 py-4" : "px-8 py-6")}>
            <SurfaceErrorBoundary surface={sectionLabel} resetKeys={[shownTab]}>
              <Suspense fallback={<SettingsLoadingSpinner />}>
                {shownTab === "profile" && <ProfileSettings />}
                {shownTab === "keybinds" && <KeybindSettings />}
                {shownTab === "keyboard" && <KeyboardSettings />}
                {shownTab === "commands" && <UserCommandSettings />}
                {shownTab === "macros" &&
                  (accountMacros ? <MacroSettings /> : <WorkspaceMacroSettings />)}
                {shownTab === "pipelines" && <PipelineSettings />}
                {shownTab === "plugins" && <PluginSettingsPage />}
                {shownTab === "emoji" && <EmojiManagement serverId={workspaceId} />}
                {shownTab === "state" && (
                  <WorkspaceStateSettings serverId={workspaceId ?? undefined} />
                )}
                {shownTab === "agents" && <AgentsSettings />}
                {shownTab === "agent" && (
                  <AgentSettingsPanel showPluginCommands={section === "plugin-ai"} />
                )}
                {shownTab === "messages" && <MessageDisplaySettings />}
                {shownTab === "direct-messages" && <DmSettings />}
                {shownTab === "notifications" && <NotificationSettings />}
                {shownTab === "history" && <HistoryArchiveSettings />}
                {shownTab === "workspace" && (
                  <div className="space-y-10">
                    <WorkspaceNameSettings serverId={workspaceId} />
                    <WorkspaceInvites serverId={workspaceId} />
                    <PublicLinkSettings
                      serverId={workspaceId}
                      onOpenRequests={() => openTab("workspace-moderation")}
                    />
                    <WorkspaceDmPolicySettings serverId={workspaceId} />
                    <WorkspacePluginSettings serverId={workspaceId} />
                    <WorkspaceOwnerSettings serverId={workspaceId} />
                  </div>
                )}
                {shownTab === "security" && <KeyIdentitySettings />}
                {shownTab === "desktop" && <DesktopSettings />}
                {shownTab === "contacts" && <ContactsSettings />}
                {shownTab === "workspace-moderation" && workspaceId && (
                  <ModerationSettings serverId={workspaceId} />
                )}
                {shownTab === "bots" && workspaceId && <BotsSettings serverId={workspaceId} />}
                {shownTab === "moderation" && (
                  <InstanceModerationSettings
                    onNavigateToWorkspaceModeration={
                      canModerate && !inDirectSpace
                        ? () => openTab("workspace-moderation")
                        : undefined
                    }
                  />
                )}

                {shownTab === "account" && (
                  <AccountSettings onNavigateToWorkspace={() => openTab("workspace")} />
                )}
                {shownTab === "about" && <AboutRim />}
              </Suspense>
            </SurfaceErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
