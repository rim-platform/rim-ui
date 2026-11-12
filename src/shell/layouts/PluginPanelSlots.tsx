import type { ReactNode, TransitionEvent } from "react";

import { PluginSlotContainer } from "../../features/plugins/components/PluginSlotContainer";
import { cn } from "../../shared/ui/cn";
import { OverlayPanel } from "../components/OverlayPanel";
import { MAIN_PANEL_PROPS } from "./mainPanelProps";
import type { ShownPluginPanel } from "./shownPluginPanels";

interface PluginPanelSlotsProps {
  /** The panel in the tool panel slot, or `null`. */
  toolPanel: ShownPluginPanel | null;
  /** The panel in the main area, shown in place of `children`, or `null`. */
  mainArea: ShownPluginPanel | null;
  /** Whether panels beside the page open over it instead, as in a window that is not wide. */
  overlayMode: boolean;
  zenMode: boolean;
  /** Whether zen mode has finished hiding what it hides. */
  zenContentHidden: boolean;
  onZenTransitionEnd: (event: TransitionEvent) => void;
  /** Closes the plugin panel. */
  onClose: () => void;
  /** Further panels that open over the page in overlay mode, after the tool panel's. */
  overlays?: ReactNode;
  /** The page shown. */
  children: ReactNode;
}

/**
 * A page with the plugin panel slots around it: a tool-panel panel as a narrow column at its
 * left, or over it in overlay mode, and a main-area panel in its place. The page's wrapper is the
 * same at every width, so the page is not remounted when the window is resized.
 */
export function PluginPanelSlots({
  toolPanel,
  mainArea,
  overlayMode,
  zenMode,
  zenContentHidden,
  onZenTransitionEnd,
  onClose,
  overlays,
  children,
}: PluginPanelSlotsProps) {
  return (
    <>
      {toolPanel && !overlayMode && (
        <div
          onTransitionEnd={onZenTransitionEnd}
          className={cn(
            // One column that never grows past the slot, whatever the panel's header holds.
            "grid w-72 shrink-0 grid-cols-1 overflow-hidden border-r border-rim-line bg-rim-panel transition-opacity duration-300",
            zenMode ? "pointer-events-none w-0 overflow-hidden opacity-0" : "opacity-100",
          )}
        >
          {!zenContentHidden && (
            <PluginSlotContainer
              plugin={toolPanel.plugin}
              panel={toolPanel.panel}
              onClose={onClose}
            />
          )}
        </div>
      )}

      <div className="relative flex min-w-0 flex-1">
        {mainArea ? (
          <main {...MAIN_PANEL_PROPS} className="flex min-w-0 flex-1 flex-col outline-none">
            <PluginSlotContainer
              plugin={mainArea.plugin}
              panel={mainArea.panel}
              onClose={onClose}
            />
          </main>
        ) : (
          children
        )}
        {overlayMode && (
          <>
            {!zenMode && toolPanel && (
              <OverlayPanel label={toolPanel.panel.title} onClose={onClose}>
                <PluginSlotContainer
                  plugin={toolPanel.plugin}
                  panel={toolPanel.panel}
                  onClose={onClose}
                />
              </OverlayPanel>
            )}
            {overlays}
          </>
        )}
      </div>
    </>
  );
}
