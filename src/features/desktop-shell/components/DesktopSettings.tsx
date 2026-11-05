import { useEffect, useState } from "react";

import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { DeviceSelect } from "../../settings/components/DeviceSelect";
import {
  desktopCloseAction,
  desktopSetCloseAction,
  desktopTrayAvailable,
  type CloseAction,
} from "../api/desktopShell";
import { NO_TRAY_SENTENCE } from "./noTraySentence";

const CLOSE_OPTIONS: { value: CloseAction; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "tray", label: "Keep running in the tray" },
  { value: "quit", label: "Quit RIM" },
];

/** The Desktop tab of the settings: what closing the window does on this computer. */
export function DesktopSettings() {
  const [action, setAction] = useState<CloseAction | null>(null);
  const [trayAvailable, setTrayAvailable] = useState(true);

  useEffect(() => {
    let live = true;
    desktopCloseAction()
      .catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not read the close setting:", error);
        return "ask" as const;
      })
      .then((current) => {
        if (live) setAction(current);
      });
    desktopTrayAvailable()
      .catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not check for a tray:", error);
        return true;
      })
      .then((available) => {
        if (live) setTrayAvailable(available);
      });
    return () => {
      live = false;
    };
  }, []);

  const change = (next: CloseAction) => {
    const previous = action;
    setAction(next);
    desktopSetCloseAction(next).catch((error: unknown) => {
      logger.warn("[RIM:desktop] could not save the close setting:", error);
      setAction(previous);
      toast.error("The setting could not be saved");
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Desktop</h2>
        <p className="mt-1 text-sm text-rim-text-muted">How RIM runs on this computer.</p>
      </div>
      <div className="rounded-lg border border-rim-line bg-rim-panel px-4">
        <DeviceSelect
          value={action ?? "ask"}
          onChange={change}
          options={CLOSE_OPTIONS}
          label="When I close the window"
          description="In the tray, RIM keeps getting messages and notifications."
          disabled={action === null}
        />
      </div>
      {!trayAvailable && <p className="text-sm text-rim-text-muted">{NO_TRAY_SENTENCE}</p>}
    </div>
  );
}
