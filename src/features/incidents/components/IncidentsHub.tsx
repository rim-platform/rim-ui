import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { SurfaceErrorBoundary } from "../../../shared/ui/SurfaceErrorBoundary";
import { DisclosureGate } from "../../disclosure/components/DisclosureGate";
import { SkillTier } from "../../../core/graphql/generated/schema-types";
import { OnCallSubTab } from "../../oncall/components/OnCallSubTab";
import { EscalationSubTab } from "../../oncall/components/EscalationSubTab";
import { IncidentHistoryPage } from "./IncidentHistoryPage";

type IncidentsSubTab = "history" | "oncall" | "escalation";

const TABS: { key: IncidentsSubTab; label: string }[] = [
  { key: "history", label: "Active / History" },
  { key: "oncall", label: "On-call" },
  { key: "escalation", label: "Escalation" },
];

interface SubTabButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function SubTabButton({ active, label, onClick }: SubTabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 text-xs font-medium transition",
        active ? "bg-rim-accent/15 text-rim-accent" : "text-rim-text-muted hover:text-rim-text",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Incidents hub (Track C1): promotes the Incidents surface from a single page
 * (`IncidentHistoryPage`) to a segmented-tab hub — Active/History, On-call, Escalation.
 * Mirrors `SettingsPage`'s in-surface tab idiom. Each sub-tab body is wrapped in its own
 * `SurfaceErrorBoundary` so one editor crash doesn't take the whole hub down (finer-grained
 * than the outer incidents-surface boundary already in `AppShell`).
 *
 * On-call and Escalation are viewable by all members; only the editing affordances inside
 * are `canManageOnCall`-gated (see `useMyServerRole`). The Escalation tab's entry point
 * (button) and body are both gated behind `DisclosureGate minTier={INTERMEDIATE}` — it's
 * advanced/low-frequency, per the C1 handoff — while On-call stays ungated.
 */
export function IncidentsHub() {
  const mainSurface = useShellStore((s) => s.mainSurface);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const resolveTab = (surface: typeof mainSurface): IncidentsSubTab => {
    if (surface.kind === "incidents" && surface.tab) return surface.tab;
    return "history";
  };

  const [activeTab, setActiveTab] = useState<IncidentsSubTab>(() => resolveTab(mainSurface));

  useEffect(() => {
    if (mainSurface.kind === "incidents") {
      setActiveTab(resolveTab(mainSurface));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainSurface]);

  return (
    <div className="flex h-full flex-col" data-testid="incidents-hub">
      <div className="flex h-10 items-center justify-between border-b border-rim-line px-8">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rim-danger" />
            <h1 className="text-lg font-semibold text-rim-text">Incidents</h1>
          </div>
          <div className="flex items-center gap-1">
            {TABS.map((tab) => {
              const button = (
                <SubTabButton
                  active={activeTab === tab.key}
                  label={tab.label}
                  onClick={() => setActiveTab(tab.key)}
                />
              );
              // The escalation editor is advanced/low-frequency — gate its entry point
              // behind the progressive-disclosure primitive (on-call viewing stays
              // ungated per the C1 handoff).
              if (tab.key === "escalation") {
                return (
                  <DisclosureGate key={tab.key} minTier={SkillTier.INTERMEDIATE}>
                    {button}
                  </DisclosureGate>
                );
              }
              return <span key={tab.key}>{button}</span>;
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "conversation" })}
          aria-label="Close incidents"
          title="Close"
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "history" && (
          <SurfaceErrorBoundary surface="Incidents: History" resetKeys={[activeTab]}>
            <IncidentHistoryPage embedded />
          </SurfaceErrorBoundary>
        )}
        {activeTab === "oncall" && (
          <SurfaceErrorBoundary surface="Incidents: On-call" resetKeys={[activeTab]}>
            <div className="h-full overflow-y-auto">
              {workspaceId ? (
                <OnCallSubTab serverId={workspaceId} />
              ) : (
                <p className="p-4 text-sm text-rim-text-muted">
                  Select a workspace to view on-call schedules.
                </p>
              )}
            </div>
          </SurfaceErrorBoundary>
        )}
        {activeTab === "escalation" && (
          <DisclosureGate minTier={SkillTier.INTERMEDIATE}>
            <SurfaceErrorBoundary surface="Incidents: Escalation" resetKeys={[activeTab]}>
              <div className="h-full overflow-y-auto">
                {workspaceId ? (
                  <EscalationSubTab serverId={workspaceId} />
                ) : (
                  <p className="p-4 text-sm text-rim-text-muted">
                    Select a workspace to view escalation policies.
                  </p>
                )}
              </div>
            </SurfaceErrorBoundary>
          </DisclosureGate>
        )}
      </div>
    </div>
  );
}
