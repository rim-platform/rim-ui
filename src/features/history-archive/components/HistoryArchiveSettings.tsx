import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import type { SafeInvokeError } from "../../../core/tauri/safeInvoke";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { currentCacheAccount, type CacheAccount } from "../../messages/api/messageCache";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  ArchiveErrorCode,
  MIN_PASSPHRASE_LENGTH,
  connectArchive,
  disconnectArchive,
  exportArchive,
  getArchiveStatus,
  inspectArchiveFolder,
  pickArchiveFolder,
  restoreArchive,
  unlockArchive,
  type ArchiveStatus,
  type FolderInfo,
} from "../api/historyArchive";
import { describeExport, describeRestore } from "./archiveReports";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

function errorText(error: SafeInvokeError): string {
  if (error.kind === "backend_error") {
    switch (error.code) {
      case ArchiveErrorCode.WRONG_PASSPHRASE:
        return "That passphrase does not open this archive.";
      case ArchiveErrorCode.UNAVAILABLE:
        return "The archive folder cannot be reached. Is the drive connected?";
      case ArchiveErrorCode.MISMATCH:
        return "The folder now holds a different archive. Stop backing up here and choose it again.";
    }
  }
  return error.message;
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">History</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Keep an encrypted copy of your message history in a folder you choose, and get it back on
          another device. A folder that Dropbox, Google Drive, OneDrive or Syncthing keeps in sync
          carries it to your other computers. RIM has no copy of it.
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
        <SetupArchive account={account} onDone={setStatus} />
      ) : !status.unlocked ? (
        <UnlockArchive account={account} status={status} onChange={setStatus} />
      ) : (
        <ConnectedArchive
          account={account}
          status={status}
          onDisconnected={() => void qc.invalidateQueries({ queryKey: statusKey })}
        />
      )}
    </div>
  );
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

function SetupArchive({
  account,
  onDone,
}: {
  account: CacheAccount;
  onDone: (status: ArchiveStatus) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const afterRestore = useAfterRestore();

  async function choose() {
    setError(null);
    const picked = await pickArchiveFolder();
    if (!picked.ok) return setError(errorText(picked.error));
    if (!picked.value) return;
    const inspected = await inspectArchiveFolder(picked.value);
    if (!inspected.ok) return setError(errorText(inspected.error));
    setFolder(picked.value);
    setInfo(inspected.value);
    setPassphrase("");
    setConfirm("");
  }

  const joining = info?.hasArchive ?? false;
  const tooShort = passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = !joining && confirm !== passphrase;
  const canSubmit =
    folder !== null && passphrase.length > 0 && (joining || (!tooShort && !mismatch));

  async function connect() {
    if (!folder || !canSubmit) return;
    setBusy(true);
    setError(null);
    const connected = await connectArchive(account, folder, passphrase);
    if (!connected.ok) {
      setBusy(false);
      return setError(errorText(connected.error));
    }
    if (!connected.value.created) {
      const restored = await restoreArchive(account);
      if (restored.ok) {
        afterRestore();
      } else {
        setError(errorText(restored.error));
      }
    }
    // The first backup of this device's history starts right away, not at the next sync.
    void exportArchive(account);
    setBusy(false);
    onDone(connected.value.status);
  }

  return (
    <div className="space-y-4 rounded-lg border border-rim-line bg-rim-panel p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rim-text">Archive folder</p>
          <p className="truncate text-xs text-rim-text-muted" title={folder ?? undefined}>
            {folder ?? "No folder chosen"}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void choose()} disabled={busy}>
          <span className="flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            Choose folder
          </span>
        </Button>
      </div>

      {folder && info && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <p className="text-xs text-rim-text-muted">
            {joining
              ? "This folder already holds a RIM history archive. Enter its passphrase to add this device; your history is restored from it."
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
              {MIN_PASSPHRASE_LENGTH - passphrase.length} more characters needed.
            </p>
          )}
          {!joining && !tooShort && confirm.length > 0 && mismatch && (
            <p className="text-xs text-rim-text-faint">The passphrases do not match.</p>
          )}
          <Button type="submit" size="sm" disabled={!canSubmit} isLoading={busy}>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    const result = await unlockArchive(account, passphrase);
    setBusy(false);
    if (result.ok) onChange(result.value);
    else setError(errorText(result.error));
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void unlock();
      }}
    >
      <p className="text-sm font-medium text-rim-text">Archive locked on this device</p>
      <p className="text-xs text-rim-text-muted">
        This device no longer has the key to the archive in {status.folder} (the system keychain was
        reset). Enter the passphrase to keep backing up.
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
      <Button type="submit" size="sm" disabled={passphrase.length === 0} isLoading={busy}>
        Unlock
      </Button>
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
  onDisconnected,
}: {
  account: CacheAccount;
  status: ArchiveStatus;
  onDisconnected: () => void;
}) {
  const [busy, setBusy] = useState<"export" | "restore" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        <p className="break-all font-mono text-xs text-rim-text-muted">{status.folder}</p>
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
        Stopping leaves the archive in the folder; other devices keep using it.
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
