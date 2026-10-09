import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import {
  accountIdInKit,
  defaultDeviceName,
  forgetDeviceKeys,
  listDeviceKeyAccounts,
  recoverAccount,
  signInWithDeviceKey,
  type LocalKeyAccount,
} from "../api/keyIdentity";

const inputClass =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";

function accountLabel(account: LocalKeyAccount): string {
  return account.username ?? `${account.principalId.slice(0, 14)}…`;
}

/**
 * "Sign in with this device" on the sign-in screen, for each account on this server this
 * computer holds a key for. Renders nothing in the web app or without such keys.
 */
export function DeviceKeySignIn({ onSuccess }: { onSuccess: (userId: string) => void }) {
  const { capabilities } = useRuntime();
  const qc = useQueryClient();
  const endpoint = getGraphqlEndpoint();
  const accounts = useQuery({
    queryKey: queryKeys.deviceKeyAccounts(endpoint),
    queryFn: listDeviceKeyAccounts,
    enabled: capabilities.deviceKeys,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<{
    principalId: string;
    text: string;
    revoked: boolean;
  } | null>(null);

  if (!capabilities.deviceKeys || !accounts.data?.length) return null;

  async function signIn(account: LocalKeyAccount) {
    setPendingId(account.principalId);
    setError(null);
    try {
      onSuccess(await signInWithDeviceKey(account.principalId));
    } catch (err) {
      const revoked = graphqlErrorCode(err) === "FORBIDDEN";
      setError({
        principalId: account.principalId,
        revoked,
        text: revoked
          ? "This device was removed from the account, so its key no longer signs in."
          : graphqlErrorMessage(err, "Signing in with this device's key failed."),
      });
    } finally {
      setPendingId(null);
    }
  }

  async function forget(principalId: string) {
    await forgetDeviceKeys(principalId).catch(() => undefined);
    setError(null);
    await qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(endpoint) });
  }

  return (
    <div className="space-y-3">
      {accounts.data.map((account) => (
        <div key={account.principalId} className="space-y-2">
          <Button
            className="w-full"
            isLoading={pendingId === account.principalId}
            disabled={pendingId !== null}
            onClick={() => void signIn(account)}
          >
            <span className="flex items-center justify-center gap-2">
              <KeyRound className="h-4 w-4" />
              Sign in as {accountLabel(account)} with this device
            </span>
          </Button>
          {error?.principalId === account.principalId && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
            >
              <p>{error.text}</p>
              {error.revoked && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void forget(account.principalId)}
                >
                  Remove this device&apos;s keys from this computer
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * "Recover an account" on the sign-in screen: a link that opens the recovery kit form.
 * Desktop only; renders nothing in the web app.
 */
export function RecoverAccount({ onSuccess }: { onSuccess: (userId: string) => void }) {
  const { capabilities } = useRuntime();
  const [open, setOpen] = useState(false);
  if (!capabilities.deviceKeys) return null;
  return open ? (
    <RecoverAccountForm onSuccess={onSuccess} onCancel={() => setOpen(false)} />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="block w-full text-center text-sm text-rim-text-muted transition hover:text-rim-text"
    >
      Lost your devices? Recover an account with its recovery kit
    </button>
  );
}

function RecoverAccountForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (userId: string) => void;
  onCancel: () => void;
}) {
  const [kit, setKit] = useState("");
  const [accountId, setAccountId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idInKit = accountIdInKit(kit);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSuccess(await recoverAccount(kit, accountId.trim() || null, deviceName));
    } catch (err) {
      setError(graphqlErrorMessage(err, "Recovery failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void recover(e)}
      className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4"
    >
      <p className="text-sm font-medium text-rim-text">Recover an account</p>
      <p className="text-xs text-rim-text-muted">
        Paste the recovery kit you saved when you set up key sign-in. This computer becomes the
        account&apos;s new device with a new identity key, and every other device and session of the
        account is signed out.
      </p>
      <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        Recovery kit
        <textarea
          value={kit}
          onChange={(e) => setKit(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={"RIM recovery kit (v1)\nAccount id: rimp1_…\nRecovery key: RK1-…"}
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>
      {!idInKit && (
        <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
          Account id
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="rimp1_…"
            spellCheck={false}
            className={`mt-1 font-mono ${inputClass}`}
          />
        </label>
      )}
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
        <Button
          type="submit"
          isLoading={busy}
          disabled={!kit.trim() || !deviceName.trim() || (!idInKit && !accountId.trim())}
        >
          Recover account
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
