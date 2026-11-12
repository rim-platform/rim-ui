import { useEffect, useRef, useState } from "react";

import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { DeviceSelect } from "../../settings/components/DeviceSelect";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import {
  desktopCloseAction,
  desktopSetCloseAction,
  desktopSetStartAtLogin,
  desktopStartAtLogin,
  desktopTrayAvailable,
  type CloseAction,
  type StartAtLogin,
} from "../api/desktopShell";
import { NO_TRAY_SAVED_SENTENCE, NO_TRAY_SENTENCE } from "./noTraySentence";

const CLOSE_OPTIONS: { value: CloseAction; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "tray", label: "Keep running in the tray" },
  { value: "quit", label: "Quit RIM" },
];

/** The id of the sentence that says why the tray is not on offer. */
const NO_TRAY_ID = "desktop-no-tray";

const START_AT_LOGIN_LABEL = "Start RIM when I sign in to this computer";

/** The row of the Desktop tab that turns starting at login on and off. */
function StartAtLoginRow() {
  const [current, setCurrent] = useState<StartAtLogin | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    let live = true;
    desktopStartAtLogin()
      .then((state) => {
        if (live) setCurrent(state);
      })
      .catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not read the start-at-login setting:", error);
        if (live) setReadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const refused = current !== null && !current.pathAllowed;

  const change = (enabled: boolean) => {
    if (current === null || saving.current) return;
    setCurrent({ ...current, enabled });
    saving.current = true;
    desktopSetStartAtLogin(enabled)
      .catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not save the start-at-login setting:", error);
        setCurrent(current);
        toast.error("The setting could not be saved");
      })
      .finally(() => {
        saving.current = false;
      });
  };

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-rim-text">{START_AT_LOGIN_LABEL}</div>
          <div className="text-xs text-rim-text-muted">The window opens when you sign in.</div>
        </div>
        <ToggleSwitch
          checked={current?.enabled ?? false}
          onChange={change}
          label={START_AT_LOGIN_LABEL}
          disabled={current === null || (refused && !current.enabled)}
        />
      </div>
      {refused && (
        <p className="mt-2 text-xs text-rim-text-muted">
          RIM can&apos;t start at sign-in from this folder, because its path contains a character
          the desktop can&apos;t start. Move RIM to another folder.
        </p>
      )}
      {current?.appImage && (
        <p className="mt-2 text-xs text-rim-text-muted">
          If you move the RIM AppImage, open it once so it starts from the new place.
        </p>
      )}
      {readFailed && (
        <p className="mt-2 text-xs text-rim-text-muted">
          RIM can&apos;t check this setting on this computer.
        </p>
      )}
    </div>
  );
}

/** The Desktop tab of the settings: what closing the window does and starting at login. */
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
      <div className="divide-y divide-rim-line rounded-lg border border-rim-line bg-rim-panel px-4">
        <DeviceSelect
          value={action ?? "ask"}
          onChange={change}
          options={CLOSE_OPTIONS.map((option) =>
            option.value === "tray" && !trayAvailable && action !== "tray"
              ? { ...option, disabled: true }
              : option,
          )}
          describedBy={trayAvailable ? undefined : NO_TRAY_ID}
          label="When I close the window"
          description="In the tray, RIM keeps getting messages and notifications."
          disabled={action === null}
        />
        <StartAtLoginRow />
      </div>
      {!trayAvailable && (
        <p id={NO_TRAY_ID} className="text-sm text-rim-text-muted">
          {NO_TRAY_SENTENCE}
          {action === "tray" && ` ${NO_TRAY_SAVED_SENTENCE}`}
        </p>
      )}
    </div>
  );
}
