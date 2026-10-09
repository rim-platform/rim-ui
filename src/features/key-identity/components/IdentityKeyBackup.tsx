import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import type { SafeInvokeError } from "../../../core/tauri/safeInvoke";
import { Button } from "../../../shared/ui/Button";
import { ArchiveErrorCode } from "../../history-archive/api/historyArchive";
import {
  IdentityBackupErrorCode,
  enableIdentityBackup,
  syncIdentityBackup,
  takeOverIdentityKey,
  type IdentityBackupStatus,
} from "../api/identityBackup";
import type { MyKeyIdentity } from "../api/keyIdentity";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 font-mono text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

function takeoverErrorText(error: SafeInvokeError): string {
  if (error.kind === "backend_error") {
    switch (error.code) {
      case IdentityBackupErrorCode.NOT_FOUND:
        return "Your history archive holds no copy of the identity key yet. Open Settings > Security on the computer that holds it, with the archive set up there.";
      case IdentityBackupErrorCode.STALE:
        return "The copy in your history archive is of an older identity key. Open Settings > Security on the computer that holds the current one so it backs it up.";
      case ArchiveErrorCode.LOCKED:
        return "The history archive is locked on this computer. Unlock it in Settings > History first.";
      case ArchiveErrorCode.UNAVAILABLE:
        return "The history archive cannot be reached. Is the drive connected, and are you online?";
    }
  }
  return error.message;
}

/**
 * Settings > Security: the identity key's backup in the history archive. On the computer that
 * holds the identity key it says whether the archive holds a copy (and turns the backup on with
 * the recovery phrase where this computer cannot seal one yet); on a computer that holds only a
 * device key it offers to take the identity key over from that copy.
 */
export function IdentityKeyBackup({
  identity,
  principalId,
  holdsIdentityKey,
}: {
  identity: MyKeyIdentity;
  principalId: string;
  holdsIdentityKey: boolean;
}) {
  const qc = useQueryClient();
  // Also keyed on whether this computer holds the identity key, so a takeover checks again.
  const statusKey = [
    ...queryKeys.identityBackupStatus(principalId, identity.keySeq),
    holdsIdentityKey,
  ] as const;
  const status = useQuery({
    queryKey: statusKey,
    retry: false,
    queryFn: () => syncIdentityBackup(identity),
  });
  const [form, setForm] = useState(false);

  async function tookOver() {
    setForm(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["deviceKeyStatus"] }),
      qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity }),
    ]);
  }

  if (status.isPending) {
    return (
      <section className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-sm font-medium text-rim-text">Identity key backup</p>
        <p className="mt-1 text-xs text-rim-text-muted">Checking the backup...</p>
      </section>
    );
  }
  if (status.error) {
    return (
      <section className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-sm font-medium text-rim-text">Identity key backup</p>
        <p role="alert" className="mt-1 text-xs text-rim-danger">
          {graphqlErrorMessage(status.error, "Could not check the identity key backup.")}
        </p>
      </section>
    );
  }
  const backup = status.data;
  if (!backup) return null;

  return (
    <section className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-4">
      <p className="text-sm font-medium text-rim-text">Identity key backup</p>
      {backup.holdsIdentityKey ? (
        <HolderBackup
          identity={identity}
          backup={backup}
          onEnabled={(next) => qc.setQueryData(statusKey, next)}
        />
      ) : backup.archive === "ready" ? (
        <>
          <p className="text-xs text-rim-text-muted">
            If the computer that holds the identity key is gone, take the key over from its copy in
            your history archive with your recovery phrase. Then this computer can add devices,
            replace the key and publish your profile card. The other computer keeps its copy.
          </p>
          {form ? (
            <PhraseForm
              submitLabel="Take over"
              onCancel={() => setForm(false)}
              onSubmit={async (secret) => {
                const result = await takeOverIdentityKey(identity, secret);
                if (!result.ok) return takeoverErrorText(result.error);
                await tookOver();
                return null;
              }}
            />
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setForm(true)}>
              Take over the identity key...
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-rim-text-muted">
          {backup.archive === "locked"
            ? "Unlock the history archive in Settings > History to take the identity key over from its copy there."
            : "If the computer that holds the identity key is lost, this one can take the key over from a copy in your history archive. Set up the archive here first, in Settings > History."}
        </p>
      )}
    </section>
  );
}

function HolderBackup({
  identity,
  backup,
  onEnabled,
}: {
  identity: MyKeyIdentity;
  backup: IdentityBackupStatus;
  onEnabled: (status: IdentityBackupStatus) => void;
}) {
  if (backup.archive === "notConfigured") {
    return (
      <p className="text-xs text-rim-text-muted">
        Set up the history archive in Settings &gt; History to keep a copy of the identity key
        there, sealed with your recovery phrase. Then another of your computers can take the key
        over if this one is lost.
      </p>
    );
  }
  if (backup.archive === "locked") {
    return (
      <p className="text-xs text-rim-text-muted">
        The history archive is locked on this computer. Unlock it in Settings &gt; History to back
        up the identity key.
      </p>
    );
  }
  if (!backup.hasBackupKey) {
    return (
      <>
        <p className="text-xs text-rim-text-muted">
          Enter your recovery phrase to keep a copy of the identity key in your history archive,
          sealed with the phrase. Nobody can open it without the phrase, not even with the
          archive&apos;s passphrase.
        </p>
        <PhraseForm
          submitLabel="Turn on backup"
          onSubmit={async (secret) => {
            try {
              onEnabled(await enableIdentityBackup(identity, secret));
              return null;
            } catch (err) {
              return graphqlErrorMessage(err, "Could not turn on the backup.");
            }
          }}
        />
      </>
    );
  }
  return (
    <p className="text-xs text-rim-text-muted">
      Your history archive holds a copy of the identity key, sealed with your recovery phrase.
      Another of your computers can take the key over with the phrase if this one is lost.
    </p>
  );
}

/**
 * The recovery phrase (or `RK1-` key), typed once and handed to the Tauri side. `onSubmit`
 * resolves to an error to show, or `null` when it worked.
 */
function PhraseForm({
  submitLabel,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  onSubmit: (secret: string) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const failure = await onSubmit(secret);
    setBusy(false);
    if (failure) {
      setError(failure);
    } else {
      setSecret("");
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="block text-sm font-medium text-rim-text">
        Recovery phrase
        <textarea
          value={secret}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          placeholder="12 words, or the RK1- key of an older kit"
          onChange={(e) => setSecret(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" isLoading={busy} disabled={!secret.trim()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
