import { useState, type FormEvent } from "react";

import { endpointHost, getGraphqlEndpoint, usesMovedRelay } from "../../../core/graphql/config";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import {
  CLIENT_API_VERSION,
  fetchServerInfoAt,
  type KnownServerInfo,
} from "../../updater/api/serverInfoApi";
import { NEWER_SERVER_API_MESSAGE } from "../../updater/hooks/useServerInfo";
import { parseServerAddress, switchServer } from "../api/serverAddress";
import { JoinField } from "./JoinField";

type Probe =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "failed"; host: string }
  | { status: "found"; endpoint: string; host: string; info: KnownServerInfo };

const LINK_BUTTON =
  "underline underline-offset-2 transition hover:text-rim-text-muted disabled:opacity-50";

/**
 * The server the desktop app signs in to, with a way to check and move to another one and
 * back to the default; nothing on the web, whose app its server serves.
 */
export function ServerChoice() {
  const { platform } = useRuntime();
  if (platform !== "desktop") return null;
  return <ServerChoicePanel />;
}

function ServerChoicePanel() {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ status: "idle" });
  const host = endpointHost(getGraphqlEndpoint());

  function close() {
    setOpen(false);
    setAddress("");
    setAddressError(null);
    setProbe({ status: "idle" });
  }

  async function check(e: FormEvent) {
    e.preventDefault();
    const parsed = parseServerAddress(address);
    if ("error" in parsed) {
      setAddressError(parsed.error);
      setProbe({ status: "idle" });
      return;
    }
    setAddressError(null);
    setProbe({ status: "checking" });
    try {
      const info = await fetchServerInfoAt(parsed.endpoint);
      setProbe({ status: "found", endpoint: parsed.endpoint, host: parsed.host, info });
    } catch {
      setProbe({ status: "failed", host: parsed.host });
    }
  }

  return (
    <div className="space-y-3 text-center text-xs text-rim-text-faint">
      <p>
        Server: <span className="text-rim-text-muted">{host}</span>
      </p>

      {!open && (
        <div className="flex justify-center gap-4">
          <button type="button" onClick={() => setOpen(true)} className={LINK_BUTTON}>
            Use another server
          </button>
          {usesMovedRelay() && (
            <button type="button" onClick={() => switchServer(null)} className={LINK_BUTTON}>
              Back to the default server
            </button>
          )}
        </div>
      )}

      {open && (
        <form
          aria-label="Use another server"
          onSubmit={(e) => void check(e)}
          className="space-y-3 rounded-xl border border-rim-line bg-rim-panel p-4 text-left"
        >
          <JoinField
            label="Server address"
            value={address}
            onChange={(v) => {
              setAddress(v);
              setAddressError(null);
              setProbe({ status: "idle" });
            }}
            placeholder="https://rim.example.org"
            hint="The address of the RIM server you sign in to."
            error={addressError}
          />

          {probe.status === "failed" && (
            <p
              role="alert"
              className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
            >
              No RIM server answered at {probe.host}. Check the address and that the server is
              running.
            </p>
          )}

          {probe.status === "found" && (
            <div
              role="status"
              className="space-y-1 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text"
            >
              <p>
                {probe.host} runs RIM {probe.info.version}, API {probe.info.apiVersion}.
              </p>
              {probe.info.instanceNotice && (
                <p className="text-xs text-rim-text-muted">{probe.info.instanceNotice}</p>
              )}
              {probe.info.apiVersion > CLIENT_API_VERSION && (
                <p className="text-xs text-rim-warm">{NEWER_SERVER_API_MESSAGE}</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            {probe.status === "found" ? (
              <Button type="button" onClick={() => switchServer(probe.endpoint)}>
                Use this server
              </Button>
            ) : (
              <Button type="submit" isLoading={probe.status === "checking"}>
                Check server
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
