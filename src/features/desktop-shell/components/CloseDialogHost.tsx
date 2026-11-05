import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import {
  CLOSE_REQUESTED_EVENT,
  desktopCloseAck,
  desktopCloseChoose,
  desktopTrayAvailable,
  type CloseChoice,
  type CloseRequest,
} from "../api/desktopShell";
import { useQuitConfirmStore } from "../state/useQuitConfirmStore";
import { NO_TRAY_SENTENCE } from "./noTraySentence";

/** The question a close of the window asks. Cancel, Escape and the backdrop save nothing. */
function CloseDialog({
  trayAvailable,
  onChoose,
  onCancel,
}: {
  trayAvailable: boolean;
  onChoose: (choice: CloseChoice, remember: boolean) => void;
  onCancel: () => void;
}) {
  const [remember, setRemember] = useState(true);
  return (
    <Dialog open title="Keep RIM running in the tray?" maxWidth="max-w-md" onClose={onCancel}>
      <p className="text-sm text-rim-text-muted">
        You&apos;ll keep getting messages and notifications while the window is closed.
      </p>
      {!trayAvailable && <p className="mt-2 text-sm text-rim-text-muted">{NO_TRAY_SENTENCE}</p>}
      <label className="mt-4 flex items-start gap-2 text-sm text-rim-text-muted">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.currentTarget.checked)}
          className="mt-0.5 h-4 w-4 accent-rim-accent"
        />
        <span>Don&apos;t ask again (you can change this in Settings &gt; Desktop)</span>
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" onClick={() => onChoose("quit", remember)}>
          Quit RIM
        </Button>
        <Button type="button" autoFocus onClick={() => onChoose("tray", remember)}>
          Keep in tray
        </Button>
      </div>
    </Dialog>
  );
}

/** Answers the desktop app's close requests and shows the dialog for the first one. */
function CloseRequestListener() {
  const [trayAvailable, setTrayAvailable] = useState<boolean | null>(null);
  const asking = useRef(false);

  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    const onRequest = (id: number) => {
      desktopCloseAck(id).catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not acknowledge a close request:", error);
      });
      if (asking.current) return;
      asking.current = true;
      useQuitConfirmStore.getState().close();
      desktopTrayAvailable()
        .catch((error: unknown) => {
          logger.warn("[RIM:desktop] could not check for a tray:", error);
          return true;
        })
        .then((available) => {
          if (live) setTrayAvailable(available);
        });
    };
    listen<CloseRequest>(CLOSE_REQUESTED_EVENT, (event) => onRequest(event.payload.id)).then(
      (unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      },
      (error: unknown) => {
        logger.warn("[RIM:desktop] could not listen for close requests:", error);
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  const dismiss = useCallback(() => {
    asking.current = false;
    setTrayAvailable(null);
  }, []);

  const choose = useCallback(
    (choice: CloseChoice, remember: boolean) => {
      dismiss();
      desktopCloseChoose(choice, remember).catch((error: unknown) => {
        logger.warn("[RIM:desktop] could not apply the close choice:", error);
        toast.error("RIM could not do that. Try closing the window again.");
      });
    },
    [dismiss],
  );

  if (trayAvailable === null) return null;
  return <CloseDialog trayAvailable={trayAvailable} onChoose={choose} onCancel={dismiss} />;
}

/**
 * Asks whether RIM stays in the tray or quits when the desktop app's window is closed. It sits
 * at the top of the app, so it also works on the sign-in and unlock screens, and renders nothing
 * outside the desktop app.
 */
export function CloseDialogHost() {
  const { capabilities } = useRuntime();
  return capabilities.desktopShell ? <CloseRequestListener /> : null;
}
