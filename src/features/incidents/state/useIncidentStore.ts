import { create } from "zustand";

import type { IncidentSeverity, IncidentStatus, IncidentPhaseName } from "../api/useIncident";

interface ActiveIncidentState {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  currentPhase: IncidentPhaseName;
  startedAt: string;
}

interface IncidentStoreState {
  activeIncident: ActiveIncidentState | null;
  showStartDialog: boolean;
  showTimeline: boolean;
  showPostmortem: boolean;

  setActiveIncident: (incident: ActiveIncidentState | null) => void;
  setShowStartDialog: (show: boolean) => void;
  setShowTimeline: (show: boolean) => void;
  setShowPostmortem: (show: boolean) => void;
}

export const useIncidentStore = create<IncidentStoreState>((set) => ({
  activeIncident: null,
  showStartDialog: false,
  showTimeline: false,
  showPostmortem: false,

  setActiveIncident: (incident) => set({ activeIncident: incident }),
  setShowStartDialog: (show) => set({ showStartDialog: show }),
  setShowTimeline: (show) => set({ showTimeline: show }),
  setShowPostmortem: (show) => set({ showPostmortem: show }),
}));
