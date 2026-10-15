import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { DeviceLinkError, linkNewDevice } from "../api/deviceLink";
import { defaultDeviceName } from "../api/keyIdentity";
import { BrowserKeyNotice } from "./BrowserKeyNotice";
import { Fingerprint } from "./Fingerprint";

const inputClass =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";

/**
 * "Link this device" on the sign-in screen: opens a form for the code shown on another device
 * of the account. In the web app, only in a browser that can hold a device key; one that cannot
 * says why.
 */
export function LinkThisDevice({ onSuccess }: { onSuccess: (userId: string) => void }) {
  const { capabilities, platform, deviceKeyStore } = useRuntime();
  const [open, setOpen] = useState(false);
  const inBrowser = platform === "web";
  if (deviceKeyStore === "unsupported") {
    return (
      <p className="text-center text-xs text-rim-text-faint">
        This browser cannot be linked to your account: it has no Ed25519 keys in WebCrypto, or no
        IndexedDB to keep one in (a private window may block it). Use a current browser, or the
        desktop app.
      </p>
    );
  }
  if (!capabilities.deviceKeys) return null;
  return open ? (
    <LinkThisDeviceForm
      inBrowser={inBrowser}
      onSuccess={onSuccess}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="block w-full text-center text-sm text-rim-text-muted transition hover:text-rim-text"
    >
      {inBrowser
        ? "Signed in on the desktop app? Link this browser with its code"
        : "Have another device signed in? Link this device with its code"}
    </button>
  );
}

/** The form for a link code from another device; `cancelLabel` names its second button. */
export function LinkThisDeviceForm({
  inBrowser,
  onSuccess,
  onCancel,
  cancelLabel = "Cancel",
}: {
  inBrowser: boolean;
  onSuccess: (userId: string) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const here = inBrowser ? "This browser" : "This computer";
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flow = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    return () => {
      cancelled = true;
      flow.current?.abort();
    };
  }, []);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    const controller = new AbortController();
    flow.current = controller;
    setBusy(true);
    setError(null);
    setFingerprint(null);
    try {
      const userId = await linkNewDevice(code, deviceName, {
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

  if (busy) {
    return (
      <div className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4">
        <p className="text-sm font-medium text-rim-text">Link this device</p>
        {fingerprint ? (
          <>
            <p className="text-xs text-rim-text-muted">Confirm this code on your other device:</p>
            <Fingerprint value={fingerprint} />
            <p className="text-xs text-rim-text-faint">
              Waiting for your other device. {here} stores nothing until it answers
              {inBrowser ? "; reloading the page abandons the link" : ""}.
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
      onSubmit={(e) => void link(e)}
      className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4"
    >
      <p className="text-sm font-medium text-rim-text">Link this device</p>
      <p className="text-xs text-rim-text-muted">
        On a computer that is signed in and holds your account&apos;s identity key, open Settings
        &gt; Security &gt; Link a device, and paste the code it shows here. {here} gets its own key;
        nothing else moves over.
      </p>
      {inBrowser && <BrowserKeyNotice />}
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
        <Button type="submit" disabled={!code.trim() || !deviceName.trim()}>
          Link this device
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}
