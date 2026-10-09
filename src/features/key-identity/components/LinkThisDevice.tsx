import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { browserKeysSupported } from "../api/browserKeys";
import { DeviceLinkError, linkNewDevice } from "../api/deviceLink";
import { defaultDeviceName } from "../api/keyIdentity";
import { Fingerprint } from "./Fingerprint";
import { QrScanner } from "./QrScanner";

const inputClass =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";

/**
 * "Link this device" on the sign-in screen: opens a form for the code shown on another device
 * of the account. The desktop takes the pasted code; the web app (a browser key, S3-7) also
 * scans it with the camera.
 */
export function LinkThisDevice({ onSuccess }: { onSuccess: (userId: string) => void }) {
  const { capabilities } = useRuntime();
  const [open, setOpen] = useState(false);
  if (!capabilities.deviceKeySignIn) return null;
  return open ? (
    <LinkThisDeviceForm
      onSuccess={onSuccess}
      onCancel={() => setOpen(false)}
      browser={!capabilities.deviceKeys}
    />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="block w-full text-center text-sm text-rim-text-muted transition hover:text-rim-text"
    >
      Have another device signed in? Link this device with its code
    </button>
  );
}

function LinkThisDeviceForm({
  onSuccess,
  onCancel,
  browser,
}: {
  onSuccess: (userId: string) => void;
  onCancel: () => void;
  /** The web app: the key is a browser key, and the camera can read the code. */
  browser: boolean;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(true);
  const flow = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    if (browser) {
      void browserKeysSupported().then((ok) => {
        if (!cancelled) setSupported(ok);
      });
    }
    return () => {
      cancelled = true;
      flow.current?.abort();
    };
  }, [browser]);

  async function link(text: string) {
    const controller = new AbortController();
    flow.current = controller;
    setBusy(true);
    setError(null);
    setFingerprint(null);
    try {
      const userId = await linkNewDevice(text, deviceName, {
        signal: controller.signal,
        onOffered: (offer) => setFingerprint(offer.fingerprint),
      });
      onSuccess(userId);
    } catch (err) {
      if (err instanceof DeviceLinkError && err.reason === "aborted") return;
      setError(
        err instanceof DeviceLinkError
          ? err.message
          : graphqlErrorMessage(err, "This device could not be linked."),
      );
    } finally {
      // The code is spent either way.
      setCode("");
      if (flow.current === controller) {
        flow.current = null;
        setBusy(false);
        setFingerprint(null);
      }
      // A device that linked but could not sign in now has keys to sign in with.
      void qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(getGraphqlEndpoint()) });
    }
  }

  function stop() {
    flow.current?.abort();
    flow.current = null;
    setBusy(false);
    setFingerprint(null);
  }

  const here = browser ? "browser" : "computer";

  if (busy) {
    return (
      <div className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4">
        <p className="text-sm font-medium text-rim-text">Link this device</p>
        {fingerprint ? (
          <>
            <p className="text-xs text-rim-text-muted">Confirm this code on your other device:</p>
            <Fingerprint value={fingerprint} />
            <p className="text-xs text-rim-text-faint">
              Waiting for your other device. This {here} stores nothing until it answers.
            </p>
          </>
        ) : (
          <p className="text-xs text-rim-text-muted">Sending this device&apos;s key...</p>
        )}
        <Button type="button" variant="secondary" onClick={stop}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void link(code);
      }}
      className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4"
    >
      <p className="text-sm font-medium text-rim-text">Link this device</p>
      <p className="text-xs text-rim-text-muted">
        On a computer that is signed in and holds your account&apos;s identity key, open Settings
        &gt; Security &gt; Link a device, and {browser ? "scan or paste" : "paste"} the code it
        shows here. This {here} gets its own key; nothing else moves over.
      </p>
      {browser && (
        <p className="text-xs text-rim-text-faint">
          A browser keeps its key less safely than the desktop app: anything running in this page
          could sign in with it while the page is open, though it cannot copy the key out. Link only
          a browser you trust, and remove it under Devices on the other computer when you stop using
          it.
        </p>
      )}
      {!supported && (
        <p role="alert" className="text-sm text-rim-danger">
          This browser cannot keep a device key. Use a current Firefox, Chrome, Edge or Safari.
        </p>
      )}
      {browser &&
        supported &&
        (scanning ? (
          <div className="space-y-2">
            <QrScanner
              onCode={(text) => {
                setScanning(false);
                setCode(text);
                // Without a name the code waits in the field for the person to finish the form.
                if (deviceName.trim()) void link(text);
              }}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => setScanning(false)}>
              Stop the camera
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setScanning(true)}>
            Scan the code with the camera
          </Button>
        ))}
      <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        Link code
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="rim-link:1:…"
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>
      <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        Name of this device
        <input
          value={deviceName}
          maxLength={64}
          onChange={(e) => setDeviceName(e.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!supported || !code.trim() || !deviceName.trim()}>
          Link this device
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
