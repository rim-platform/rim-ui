import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, FolderOpen, Server } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import type { SafeInvokeError } from "../../../core/tauri/safeInvoke";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  backUpIdentityKeyQuietly,
  canUnlockArchiveWithKeys,
  unlockArchiveWithKeys,
} from "../../key-identity/api/identityBackup";
import { currentCacheAccount, type CacheAccount } from "../../messages/api/messageCache";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  ArchiveErrorCode,
  CLOUD_SERVICE_NAMES,
  ENDPOINT_NAME,
  MIN_PASSPHRASE_LENGTH,
  archiveLocation,
  authorizeCloud,
  cancelCloudSignIn,
  checkEndpoint,
  connectArchive,
  disconnectArchive,
  discardCloudSignIn,
  exportArchive,
  getArchiveStatus,
  inspectArchiveFolder,
  listCloudServices,
  passphraseLength,
  pickArchiveFolder,
  restoreArchive,
  unlockArchive,
  type ArchiveStatus,
  type CloudKind,
  type ConnectTarget,
  type EndpointSetup,
} from "../api/historyArchive";
import { describeExport, describeRestore } from "./archiveReports";
import { EndpointForm } from "./EndpointForm";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

function errorText(error: SafeInvokeError): string {
  if (error.kind === "backend_error") {
    switch (error.code) {
      case ArchiveErrorCode.WRONG_PASSPHRASE:
        return "That passphrase does not open this archive.";
      case ArchiveErrorCode.NO_IDENTITY_WRAP:
        return "This device's keys do not open this archive. Enter the passphrase.";
      case ArchiveErrorCode.UNAVAILABLE:
        return "The archive cannot be reached. Is the drive connected, and are you online?";
      case ArchiveErrorCode.NOT_WRITABLE:
        return "RIM cannot write into this folder. Choose a folder you can write to.";
      case ArchiveErrorCode.MISMATCH:
        return "The folder now holds a different archive. Stop backing up here and choose it again.";
      case ArchiveErrorCode.CLOUD_AUTH:
        return `The sign-in did not work or is no longer valid (${error.message}). Sign in again; if this archive is already set up, stop backing up here first.`;
      case ArchiveErrorCode.TLS:
        return "The secure connection failed: the server's certificate is not trusted here, or that address does not speak HTTPS.";
      case ArchiveErrorCode.ENDPOINT_INSECURE:
        return "That address is plain HTTP to another computer. Use https://, or allow an unencrypted connection if the network is yours.";
      case ArchiveErrorCode.ENDPOINT_UNAUTHORIZED:
        return "The backup endpoint refused the credentials (401). Check the user name and password, or the token.";
      case ArchiveErrorCode.ENDPOINT_FORBIDDEN:
        return "The backup endpoint accepted the credentials but refuses access (403).";
      case ArchiveErrorCode.ENDPOINT_NOT_FOUND:
        return "No backup endpoint answers at that address (404). The URL should lead to the service's /backup route.";
      case ArchiveErrorCode.ENDPOINT_NOT_JSON:
        return "Something answered, but not as a backup endpoint: its listing is not JSON. Check the URL.";
      case ArchiveErrorCode.ENDPOINT_BROKEN:
        return `The backup endpoint does not keep files correctly: ${error.message}.`;
    }
  }
  return error.message;
}

/** A failed endpoint check: "cannot be reached" means the address, not a drive. */
function endpointCheckErrorText(error: SafeInvokeError): string {
  if (error.kind === "backend_error" && error.code === ArchiveErrorCode.UNAVAILABLE) {
    return "Nothing answers at that address. Check the URL and that the service is running.";
  }
  return errorText(error);
}

/**
 * Settings > History: where this account's history archive lives. Desktop only; the archive is
 * written from the local message cache, which the web app does not have.
 */
export function HistoryArchiveSettings() {
  const userId = useAuthStore((s) => s.session?.userId);
  const account = userId ? currentCacheAccount() : null;
  const qc = useQueryClient();
  const statusKey = ["historyArchiveStatus", account?.endpoint, account?.userId] as const;
  const { data: status, error } = useQuery({
    queryKey: statusKey,
    enabled: account !== null,
    retry: false,
    queryFn: async () => {
      const result = await getArchiveStatus(account!);
      if (!result.ok) throw new Error(errorText(result.error));
      return result.value;
    },
  });
  const setStatus = (next: ArchiveStatus) => qc.setQueryData(statusKey, next);
  // What the restore after connecting found, shown once the panel switches to the archive.
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">History</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Keep an encrypted copy of your message history in a folder you choose, in your own Google
          Drive or Dropbox, or on a server of your own, and get it back on another device. A folder
          that OneDrive or Syncthing keeps in sync carries it to your other computers too. RIM has
          no copy of it.
        </p>
      </div>

      {!account ? (
        <p className="text-sm text-rim-text-muted">
          The history archive is available in the desktop app.
        </p>
      ) : error && !status ? (
        <p role="alert" className="text-sm text-rim-danger">
          {error.message}
        </p>
      ) : !status ? (
        <p className="text-sm text-rim-text-muted">Loading...</p>
      ) : !status.configured ? (
        <SetupArchive
          account={account}
          onDone={(next, restored) => {
            setNotice(restored);
            setStatus(next);
          }}
        />
      ) : !status.unlocked ? (
        <UnlockArchive account={account} status={status} onChange={setStatus} />
      ) : (
        <ConnectedArchive
          account={account}
          status={status}
          notice={notice}
          onDisconnected={() => void qc.invalidateQueries({ queryKey: statusKey })}
        />
      )}
    </div>
  );
}

interface Notice {
  message: string | null;
  error: string | null;
}

/** After a restore the cached timelines are re-read, and the server is asked what is newer. */
function useAfterRestore() {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["cachedTimeline"] });
    if (workspaceId) requestCacheSync(workspaceId);
  }, [qc, workspaceId]);
}

/**
 * Where the archive being set up is: a folder, a cloud account just signed in to, or a backup
 * endpoint just checked.
 */
type Place =
  | { kind: "localFolder"; path: string; hasArchive: boolean }
  | {
      kind: "cloud";
      service: CloudKind;
      connectionId: string;
      account: string;
      hasArchive: boolean;
    }
  | { kind: "endpoint"; connectionId: string; url: string; hasArchive: boolean };

function placeTarget(place: Place): ConnectTarget {
  return place.kind === "localFolder"
    ? { kind: "localFolder", path: place.path }
    : { kind: "cloud", connectionId: place.connectionId };
}

function placeLabel(place: Place): string {
  switch (place.kind) {
    case "localFolder":
      return place.path;
    case "cloud":
      return `${CLOUD_SERVICE_NAMES[place.service]} (${place.account})`;
    case "endpoint":
      return `${ENDPOINT_NAME} (${place.url})`;
  }
}

const JOINING_SUBJECT: Record<Place["kind"], string> = {
  localFolder: "This folder",
  cloud: "This account",
  endpoint: "This endpoint",
};

/** The cloud services this build can sign in to. */
function useCloudServices(): CloudKind[] {
  const { data } = useQuery({
    queryKey: ["historyArchiveCloudServices"],
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const result = await listCloudServices();
      return result.ok ? result.value : [];
    },
  });
  return (data ?? []).filter((s) => s.available).map((s) => s.kind);
}

function SetupArchive({
  account,
  onDone,
}: {
  account: CacheAccount;
  onDone: (status: ArchiveStatus, restored: Notice | null) => void;
}) {
  const [place, setPlace] = useState<Place | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState<CloudKind | null>(null);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [checkingEndpoint, setCheckingEndpoint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const afterRestore = useAfterRestore();
  const cloudServices = useCloudServices();

  // A cloud sign-in or endpoint check that was not used is dropped (a Dropbox sign-in revoked)
  // when another place is chosen or the panel closes; a sign-in still waiting for the browser
  // is cancelled.
  const pendingCloud = useRef<string | null>(null);
  const mounted = useRef(true);
  const waitingForBrowser = useRef(false);
  const dropPendingCloud = useCallback(() => {
    if (pendingCloud.current) void discardCloudSignIn(pendingCloud.current);
    pendingCloud.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (waitingForBrowser.current) void cancelCloudSignIn();
      dropPendingCloud();
    };
  }, [dropPendingCloud]);

  function choosePlace(next: Place) {
    dropPendingCloud();
    if (next.kind !== "localFolder") pendingCloud.current = next.connectionId;
    setPlace(next);
    setPassphrase("");
    setConfirm("");
  }

  async function chooseFolder() {
    setError(null);
    const picked = await pickArchiveFolder();
    if (!picked.ok) return setError(errorText(picked.error));
    if (!picked.value) return;
    const inspected = await inspectArchiveFolder(picked.value);
    if (!inspected.ok) return setError(errorText(inspected.error));
    choosePlace({
      kind: "localFolder",
      path: picked.value,
      hasArchive: inspected.value.hasArchive,
    });
  }

  async function signIn(service: CloudKind) {
    setError(null);
    setSigningIn(service);
    waitingForBrowser.current = true;
    const result = await authorizeCloud(service);
    waitingForBrowser.current = false;
    if (!mounted.current) {
      if (result.ok) void discardCloudSignIn(result.value.connectionId);
      return;
    }
    setSigningIn(null);
    if (!result.ok) {
      const cancelled =
        result.error.kind === "backend_error" && result.error.code === ArchiveErrorCode.CANCELLED;
      if (!cancelled) setError(errorText(result.error));
      return;
    }
    const auth = result.value;
    choosePlace({
      kind: "cloud",
      service: auth.kind,
      connectionId: auth.connectionId,
      account: auth.account,
      hasArchive: auth.hasArchive,
    });
  }

  async function chooseEndpoint(setup: EndpointSetup) {
    setError(null);
    setCheckingEndpoint(true);
    const result = await checkEndpoint(setup);
    if (!mounted.current) {
      if (result.ok) void discardCloudSignIn(result.value.connectionId);
      return;
    }
    setCheckingEndpoint(false);
    if (!result.ok) return setError(endpointCheckErrorText(result.error));
    const check = result.value;
    setEndpointOpen(false);
    choosePlace({
      kind: "endpoint",
      connectionId: check.connectionId,
      url: check.url,
      hasArchive: check.hasArchive,
    });
  }

  const joining = place?.hasArchive ?? false;
  const length = passphraseLength(passphrase);
  const tooShort = length < MIN_PASSPHRASE_LENGTH;
  const mismatch = !joining && confirm !== passphrase;
  const canSubmit =
    place !== null && passphrase.length > 0 && (joining || (!tooShort && !mismatch));

  async function connect() {
    if (!place || !canSubmit) return;
    setBusy(true);
    setError(null);
    const connected = await connectArchive(account, placeTarget(place), passphrase);
    if (!connected.ok) {
      setBusy(false);
      return setError(errorText(connected.error));
    }
    // The sign-in is the archive's now; it is no longer this form's to drop.
    pendingCloud.current = null;
    let restored: Notice | null = null;
    if (!connected.value.created) {
      const result = await restoreArchive(account);
      if (result.ok) {
        afterRestore();
        restored = { message: describeRestore(result.value), error: null };
      } else {
        restored = { message: null, error: errorText(result.error) };
      }
    }
    // The first backup of this device's history starts right away, not at the next sync.
    void exportArchive(account);
    void backUpIdentityKeyQuietly();
    setBusy(false);
    onDone(connected.value.status, restored);
  }

  const choosing = busy || signingIn !== null || checkingEndpoint;

  return (
    <div className="space-y-4 rounded-lg border border-rim-line bg-rim-panel p-4">
      <div className="space-y-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rim-text">Where to keep it</p>
          <p
            className="truncate text-xs text-rim-text-muted"
            title={place ? placeLabel(place) : undefined}
          >
            {place ? placeLabel(place) : "Nothing chosen yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void chooseFolder()}
            disabled={choosing}
          >
            <span className="flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" />
              Choose folder
            </span>
          </Button>
          {cloudServices.map((service) => (
            <Button
              key={service}
              variant="secondary"
              size="sm"
              onClick={() => void signIn(service)}
              disabled={choosing}
              isLoading={signingIn === service}
            >
              <span className="flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5" />
                {CLOUD_SERVICE_NAMES[service]}
              </span>
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEndpointOpen((open) => !open)}
            disabled={choosing}
            aria-expanded={endpointOpen}
          >
            <span className="flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" />
              Your own server
            </span>
          </Button>
        </div>
        {endpointOpen && (
          <EndpointForm
            busy={checkingEndpoint}
            disabled={busy || signingIn !== null}
            onCheck={(setup) => void chooseEndpoint(setup)}
          />
        )}
        {signingIn && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-rim-text-muted">
              Finish signing in to {CLOUD_SERVICE_NAMES[signingIn]} in your browser. RIM only gets
              access to its own app folder there, not to your other files.
            </p>
            <Button variant="ghost" size="sm" onClick={() => void cancelCloudSignIn()}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {place && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <p className="text-xs text-rim-text-muted">
            {joining
              ? `${JOINING_SUBJECT[place.kind]} already holds a RIM history archive. Enter its passphrase to add this device; your history is restored from it.`
              : `Set a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters. Every device needs it to read your history, and nobody can recover it if you forget it.`}
          </p>
          <label className="block text-sm font-medium text-rim-text">
            Passphrase
            <input
              type="password"
              autoComplete={joining ? "current-password" : "new-password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={inputClass}
            />
          </label>
          {!joining && (
            <label className="block text-sm font-medium text-rim-text">
              Repeat passphrase
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </label>
          )}
          {!joining && passphrase.length > 0 && tooShort && (
            <p className="text-xs text-rim-text-faint">
              {MIN_PASSPHRASE_LENGTH - length} more characters needed.
            </p>
          )}
          {!joining && !tooShort && confirm.length > 0 && mismatch && (
            <p className="text-xs text-rim-text-faint">The passphrases do not match.</p>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit || signingIn !== null}
            isLoading={busy}
          >
            {joining ? "Connect and restore" : "Create archive"}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function UnlockArchive({
  account,
  status,
  onChange,
}: {
  account: CacheAccount;
  status: ArchiveStatus;
  onChange: (status: ArchiveStatus) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<"passphrase" | "keys" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether this device's identity key opens a copy of the archive key.
  const { data: withKeys } = useQuery({
    queryKey: ["historyArchiveUnlockWithKeys", account.endpoint, account.userId, status.archiveId],
    retry: false,
    queryFn: () => canUnlockArchiveWithKeys(account),
  });

  async function unlock(kind: "passphrase" | "keys") {
    setBusy(kind);
    setError(null);
    const result =
      kind === "passphrase"
        ? await unlockArchive(account, passphrase)
        : await unlockArchiveWithKeys(account);
    setBusy(null);
    if (result.ok) {
      onChange(result.value);
      void backUpIdentityKeyQuietly();
    } else {
      setError(errorText(result.error));
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void unlock("passphrase");
      }}
    >
      <p className="text-sm font-medium text-rim-text">Archive locked on this device</p>
      <p className="text-xs text-rim-text-muted">
        This device no longer has the key to the archive in {archiveLocation(status)} (the system
        secret vault was reset). Enter the passphrase to keep backing up.
      </p>
      <label className="block text-sm font-medium text-rim-text">
        Passphrase
        <input
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={passphrase.length === 0 || busy !== null}
          isLoading={busy === "passphrase"}
        >
          Unlock
        </Button>
        {withKeys && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            isLoading={busy === "keys"}
            onClick={() => void unlock("keys")}
          >
            Unlock with this device&apos;s keys
          </Button>
        )}
      </div>
      {withKeys && (
        <p className="text-xs text-rim-text-faint">
          This computer holds your identity key, which opens a copy of the archive key kept in the
          archive.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function ConnectedArchive({
  account,
  status,
  notice,
  onDisconnected,
}: {
  account: CacheAccount;
  status: ArchiveStatus;
  /** The outcome of the restore that ran when this device joined the archive. */
  notice: Notice | null;
  onDisconnected: () => void;
}) {
  const [busy, setBusy] = useState<"export" | "restore" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(notice?.message ?? null);
  const [error, setError] = useState<string | null>(notice?.error ?? null);
  const afterRestore = useAfterRestore();

  async function run(kind: "export" | "restore" | "disconnect") {
    setBusy(kind);
    setMessage(null);
    setError(null);
    if (kind === "export") {
      const result = await exportArchive(account);
      if (result.ok) setMessage(describeExport(result.value));
      else setError(errorText(result.error));
    } else if (kind === "restore") {
      const result = await restoreArchive(account);
      if (result.ok) {
        setMessage(describeRestore(result.value));
        afterRestore();
      } else {
        setError(errorText(result.error));
      }
    } else {
      const result = await disconnectArchive(account);
      if (result.ok) onDisconnected();
      else setError(errorText(result.error));
    }
    setBusy(null);
  }

  return (
    <div className="space-y-4 rounded-lg border border-rim-line bg-rim-panel p-4">
      <div className="space-y-1 text-sm">
        <p className="font-medium text-rim-text">Backing up to</p>
        <p
          className={`break-all text-xs text-rim-text-muted ${status.provider === "localFolder" ? "font-mono" : ""}`}
        >
          {archiveLocation(status)}
        </p>
        <p className="text-xs text-rim-text-faint">
          New history is written every few minutes. This device writes under{" "}
          <span className="font-mono">{status.deviceId.slice(0, 8)}</span>.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void run("export")}
          isLoading={busy === "export"}
          disabled={busy !== null}
        >
          Back up now
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void run("restore")}
          isLoading={busy === "restore"}
          disabled={busy !== null}
        >
          Restore from archive
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void run("disconnect")}
          isLoading={busy === "disconnect"}
          disabled={busy !== null}
        >
          Stop backing up
        </Button>
      </div>
      <p className="text-xs text-rim-text-faint">
        {status.provider === "googleDrive" || status.provider === "dropbox"
          ? `Stopping signs this device out of ${CLOUD_SERVICE_NAMES[status.provider]} and leaves the archive there; other devices keep using it.`
          : status.provider === "endpoint"
            ? "Stopping forgets this device's password or token for the endpoint and leaves the archive there; other devices keep using it."
            : "Stopping leaves the archive in the folder; other devices keep using it."}
      </p>
      {message && <p className="text-xs text-rim-success">{message}</p>}
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}
