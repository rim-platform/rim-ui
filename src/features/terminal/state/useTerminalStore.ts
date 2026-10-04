import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TerminalSession {
  id: string;
  shell: string;
}

interface TerminalState {
  /** Whether the terminal feature is enabled in settings. */
  enabled: boolean;
  /** Whether the terminal pane is currently visible. */
  isOpen: boolean;
  /** Active session tab ID. */
  activeSessionId: string | null;
  /** All open sessions. */
  sessions: TerminalSession[];
  /** Panel height in pixels. */
  panelHeight: number;
  /** User-configured shell path (empty = system default). */
  preferredShell: string;
  /** User-configured terminal font family (empty = default). */
  fontFamily: string;
  /** User-configured terminal font size. */
  fontSize: number;

  setEnabled: (enabled: boolean) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;
  setPanelHeight: (height: number) => void;
  setPreferredShell: (shell: string) => void;
  setFontFamily: (font: string) => void;
  setFontSize: (size: number) => void;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.6; // 60vh equivalent, applied at render time

export { MIN_HEIGHT, MAX_HEIGHT_RATIO };

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      enabled: false,
      isOpen: false,
      activeSessionId: null,
      sessions: [],
      panelHeight: 300,
      preferredShell: "",
      fontFamily: "",
      fontSize: 13,

      setEnabled: (enabled) => {
        set({ enabled });
        // If disabling, also close the pane
        if (!enabled) {
          set({ isOpen: false });
        }
      },

      toggleOpen: () => {
        const { enabled, isOpen } = get();
        if (!enabled) return;
        set({ isOpen: !isOpen });
      },

      setOpen: (open) => {
        const { enabled } = get();
        if (!enabled && open) return;
        set({ isOpen: open });
      },

      addSession: (session) =>
        set((s) => ({
          sessions: [...s.sessions, session],
          activeSessionId: session.id,
        })),

      removeSession: (sessionId) =>
        set((s) => {
          const sessions = s.sessions.filter((ss) => ss.id !== sessionId);
          const activeSessionId =
            s.activeSessionId === sessionId
              ? (sessions[sessions.length - 1]?.id ?? null)
              : s.activeSessionId;
          // If no sessions left, close the pane
          const isOpen = sessions.length > 0 ? s.isOpen : false;
          return { sessions, activeSessionId, isOpen };
        }),

      setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

      setPanelHeight: (height) => set({ panelHeight: Math.max(MIN_HEIGHT, height) }),

      setPreferredShell: (shell) => set({ preferredShell: shell }),
      setFontFamily: (font) => set({ fontFamily: font }),
      setFontSize: (size) => set({ fontSize: Math.max(8, Math.min(32, size)) }),
    }),
    {
      name: "rim-terminal",
      // Only persist enabled state, panel height, shell, and font — sessions are runtime-only
      partialize: (state) => ({
        enabled: state.enabled,
        panelHeight: state.panelHeight,
        preferredShell: state.preferredShell,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
      }),
    },
  ),
);
