import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Laptop } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { Button } from "../../../shared/ui/Button";
import {
  cancelLink,
  confirmLink,
  declineLink,
  startLinkingDevice,
  waitForOffer,
  DeviceLinkError,
  type OfferToConfirm,
  type StartedLink,
} from "../api/deviceLink";
import type { MyKeyIdentity } from "../api/keyIdentity";
import { Fingerprint } from "./Fingerprint";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

interface Confirmed {
  link: StartedLink;
  offer: OfferToConfirm;
  name: string;
}

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "code"; link: StartedLink }
  | { kind: "confirm"; link: StartedLink; offer: OfferToConfirm }
  | ({ kind: "linking" } & Confirmed)
  | { kind: "linked"; name: string }
  | { kind: "failed"; message: string; retry?: Confirmed };

function failureText(err: unknown): string {
  if (err instanceof DeviceLinkError) return err.message;
  return graphqlErrorMessage(err, "The device could not be linked.");
}

function timeLeft(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Settings > Security > "Link a device": the code as a QR code and as text, then the new
 * device's name and fingerprint to confirm. Shown only where the identity key is held. `full`
 * says why no device can be linked while the account has as many as the instance allows.
 */
export function LinkDevicePanel({
  identity,
  displayName,
  full = null,
}: {
  identity: MyKeyIdentity;
  displayName: string;
  full?: string | null;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const offerFlow = useRef<AbortController | null>(null);
  // Aborted only by Cancel: closing the panel lets a confirmed link finish.
  const confirmFlow = useRef<AbortController | null>(null);
  const confirming = useRef<Promise<void> | null>(null);
  // A link not confirmed yet, cancelled if the panel closes.
  const open = useRef<StartedLink | null>(null);

  useEffect(
    () => () => {
      offerFlow.current?.abort();
      if (open.current) void declineLink(open.current);
    },
    [],
  );

  const counting = step.kind === "code";
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  function fail(err: unknown) {
    if (err instanceof DeviceLinkError && err.reason === "aborted") return;
    open.current = null;
    setStep({ kind: "failed", message: failureText(err) });
  }

  async function start() {
    const controller = new AbortController();
    offerFlow.current = controller;
    setStep({ kind: "starting" });
    setCopied(false);
    try {
      const link = await startLinkingDevice(identity);
      open.current = link;
      setNow(Date.now());
      setStep({ kind: "code", link });
      const offer = await waitForOffer(link, { signal: controller.signal });
      setName(offer.name);
      setStep({ kind: "confirm", link, offer });
    } catch (err) {
      fail(err);
    }
  }

  function confirm(confirmed: Confirmed) {
    const controller = new AbortController();
    confirmFlow.current = controller;
    open.current = null;
    setStep({ kind: "linking", ...confirmed });
    const run = (async () => {
      try {
        await confirmLink(confirmed.link, confirmed.name, displayName, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setStep({ kind: "linked", name: confirmed.name.trim() });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DeviceLinkError && err.reason === "failed") {
          setStep({ kind: "failed", message: err.message, retry: confirmed });
        } else {
          fail(err);
        }
      } finally {
        void qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity });
      }
    })();
    confirming.current = run;
    return run;
  }

  async function cancel() {
    const current = step;
    open.current = null;
    setStep({ kind: "idle" });
    if (current.kind === "code") {
      // `waitForOffer` cancels the link when aborted.
      offerFlow.current?.abort();
      return;
    }
    if (current.kind === "confirm") {
      await cancelLink(current.link);
      return;
    }
    const confirmed =
      current.kind === "linking" ? current : current.kind === "failed" ? current.retry : undefined;
    if (!confirmed) return;
    const controller = confirmFlow.current;
    controller?.abort();
    // Settle only once an `addDeviceKey` in flight has resolved.
    await confirming.current;
    const linked = await cancelLink(confirmed.link, confirmed.offer.deviceId);
    if (linked && confirmFlow.current === controller) {
      setStep({ kind: "linked", name: confirmed.name.trim() });
    }
    void qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-4">
      <div className="flex items-start gap-3">
        <Laptop className="mt-0.5 h-5 w-5 text-rim-accent" />
        <div>
          <p className="text-sm font-medium text-rim-text">Link a device</p>
          <p className="mt-1 text-xs text-rim-text-muted">
            Give another device its own key for this account. On it, choose &quot;Link this
            device&quot; on the sign-in screen and paste the code shown here.
          </p>
        </div>
      </div>

      {step.kind === "idle" && (
        <>
          <Button size="sm" disabled={Boolean(full)} onClick={() => void start()}>
            Link a device
          </Button>
          {full && <p className="text-xs text-rim-warm">{full}</p>}
        </>
      )}

      {step.kind === "starting" && <p className="text-sm text-rim-text-muted">Starting...</p>}

      {step.kind === "code" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start gap-4">
            <div className="rounded-md bg-rim-text p-3 text-rim-void">
              <QRCodeSVG
                value={step.link.code}
                level="M"
                boostLevel={false}
                marginSize={4}
                size={176}
                bgColor="transparent"
                fgColor="currentColor"
                title="Device link code"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs text-rim-text-muted">Code</p>
              <code
                aria-label="Device link code"
                className="block select-all break-all rounded-md border border-rim-line bg-rim-void p-2 font-mono text-xs text-rim-text"
              >
                {step.link.code}
              </code>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void copyCode(step.link.code)}>
                  <span className="flex items-center gap-1.5">
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? "Copied" : "Copy code"}
                  </span>
                </Button>
                <span className="text-xs text-rim-text-faint">
                  Expires in {timeLeft(step.link.expiresAt, now)}
                </span>
              </div>
              <p className="text-xs text-rim-text-faint">
                Anyone with this code can ask to join your account; you still confirm every device
                here. Waiting for the new device...
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      )}

      {step.kind === "confirm" && (
        <div className="space-y-3 rounded-md border border-rim-accent/30 bg-rim-void/40 p-3">
          <p className="text-sm text-rim-text">A device asks to join your account.</p>
          <div>
            <p className="text-xs text-rim-text-muted">Check that the new device shows</p>
            <div className="mt-1">
              <Fingerprint value={step.offer.fingerprint} />
            </div>
          </div>
          <p className="text-xs text-rim-text-muted">
            {step.offer.platform === "web"
              ? "A web browser. Keys in a browser are weaker than on a desktop: anything that controls this browser profile can use them."
              : "The desktop app."}
          </p>
          <label className="block text-sm font-medium text-rim-text">
            Device name
            <input
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
          <p className="text-xs text-rim-text-faint">
            If the code differs, or you did not start this, decline.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!name.trim()}
              onClick={() => void confirm({ link: step.link, offer: step.offer, name })}
            >
              Confirm
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void cancel()}>
              Decline
            </Button>
          </div>
        </div>
      )}

      {step.kind === "linking" && (
        <div className="space-y-2">
          <p className="text-sm text-rim-text-muted">
            Linking {step.name.trim()}... waiting for it to sign in.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      )}

      {step.kind === "linked" && (
        <div className="space-y-2">
          <p className="text-sm text-rim-success">{step.name} is linked.</p>
          <Button variant="secondary" size="sm" onClick={() => setStep({ kind: "idle" })}>
            Link another device
          </Button>
        </div>
      )}

      {step.kind === "failed" && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-rim-danger">
            {step.message}
          </p>
          {step.retry ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => step.retry && void confirm(step.retry)}>
                Retry
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void cancel()}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setStep({ kind: "idle" })}>
              Start again
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
