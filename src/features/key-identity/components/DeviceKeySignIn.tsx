import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { KeyRound } from "lucide-react";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { FORBIDDEN, graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { PasswordLockedError, PasswordWaitError } from "../../auth/api/passwordApi";
import {
  KeepSignedInCheckbox,
  NewPasswordFields,
  PasswordInput,
} from "../../auth/components/PasswordFields";
import { PasswordSignInForm } from "../../auth/components/PasswordSignIn";
import {
  EMPTY_NEW_PASSWORD,
  keepSignedInByDefault,
  newPasswordProblem,
  signInFailure,
} from "../../auth/password";
import { KeysUnopenedError } from "../../auth/runtime/accountUnlock";
import { resetPassword } from "../../auth/runtime/passwordChanges";
import {
  accountIdInKit,
  defaultDeviceName,
  forgetDeviceKeys,
  forgetKeysTheServerNeverSaw,
  NoDeviceKeysError,
  recoverDeviceKeys,
  signInWithPassword,
  SignInCancelled,
  type LocalKeyAccount,
} from "../api/keyIdentity";
import { useDeviceKeyAccounts } from "../api/useDeviceKeyAccounts";
import { parseRecoveryPhrase } from "../browser/recoveryKit";
import { BrowserKeyNotice } from "./BrowserKeyNotice";

const inputClass =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";

/** The start of an account's id, for an account this device knows no username for. */
function idLabel(account: LocalKeyAccount): string {
  return `${account.principalId.slice(0, 14)}…`;
}

/**
 * How the sign-in list names an account: its username, or, before the first sign-in after a
 * recovery or a link, which of the two it is.
 */
function accountLabel(account: LocalKeyAccount): string {
  if (account.username) return account.username;
  return account.hasIdentityKey ? "your recovered account" : "your linked account";
}

/** The sign-in button's label for an account. */
function signInLabel(account: LocalKeyAccount): string {
  return account.username
    ? `Sign in as ${account.username}`
    : `Sign in to ${accountLabel(account)}`;
}

/**
 * The sign-in screen's list of the accounts on this server that this computer, or this browser
 * once linked, holds a key for. Each opens a password prompt: the account password and this
 * device's key sign in together. Renders nothing without such keys.
 */
export function DeviceKeySignIn({ onSuccess }: { onSuccess: (userId: string) => void }) {
  const { capabilities, platform } = useRuntime();
  const inBrowser = platform === "web";
  const here = inBrowser ? "this browser" : "this computer";
  const qc = useQueryClient();
  const endpoint = getGraphqlEndpoint();
  const accounts = useDeviceKeyAccounts();
  const [openId, setOpenId] = useState<string | null>(null);
  const [revokedId, setRevokedId] = useState<string | null>(null);
  // Said after keys the server never saw were removed, when their account is gone from the list.
  const [notice, setNotice] = useState<string | null>(null);

  if (!capabilities.deviceKeys || (!accounts.data?.length && !notice)) return null;

  /**
   * The failures this list shows itself: keys no longer on this device, keys the server never
   * saw, and a revoked device.
   */
  async function failed(account: LocalKeyAccount, err: unknown): Promise<boolean> {
    if (err instanceof NoDeviceKeysError) {
      setOpenId(null);
      setNotice(
        `The keys of ${accountLabel(account)} are not in ${here}, so it was taken off this list. Recover the account with its recovery kit, or link ${here} from a device that is signed in.`,
      );
      await qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(endpoint) });
      return true;
    }
    if (
      !(err instanceof PasswordWaitError) &&
      !(err instanceof PasswordLockedError) &&
      !(err instanceof SignInCancelled) &&
      !(err instanceof KeysUnopenedError) &&
      (await forgetKeysTheServerNeverSaw(account).catch(() => false))
    ) {
      setOpenId(null);
      setNotice(
        `The sign-up of ${account.username ?? idLabel(account)} never completed, so its keys were removed from ${here}. Create the account again.`,
      );
      await qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(endpoint) });
      return true;
    }
    if (graphqlErrorCode(err) === FORBIDDEN) {
      setOpenId(null);
      setRevokedId(account.principalId);
      return true;
    }
    return false;
  }

  async function forget(principalId: string) {
    await forgetDeviceKeys(principalId).catch(() => undefined);
    setRevokedId(null);
    await qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(endpoint) });
  }

  return (
    <div className="space-y-3">
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-sm text-rim-text-muted"
        >
          {notice}
        </p>
      )}
      {accounts.data?.map((account) => (
        <div key={account.principalId} className="space-y-2">
          {openId === account.principalId ? (
            <PasswordSignInForm
              principalId={account.principalId}
              accountLabel={accountLabel(account)}
              onSignedIn={(result) => onSuccess(result.userId)}
              onCancel={() => setOpenId(null)}
              onFailure={(err) => failed(account, err)}
            />
          ) : (
            <Button
              className="w-full"
              disabled={openId !== null}
              onClick={() => {
                setOpenId(account.principalId);
                setRevokedId(null);
                setNotice(null);
              }}
            >
              <span className="flex items-center justify-center gap-2">
                <KeyRound className="h-4 w-4" />
                {signInLabel(account)}
              </span>
              {!account.username && (
                <span className="block font-mono text-[11px] opacity-75">{idLabel(account)}</span>
              )}
            </Button>
          )}
          {revokedId === account.principalId && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
            >
              <p>This device was removed from the account, so its key no longer signs in.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void forget(account.principalId)}
              >
                Remove this device&apos;s keys from {here}
              </Button>
            </div>
          )}
        </div>
      ))}
      {inBrowser && <BrowserKeyNotice />}
    </div>
  );
}

/**
 * "Recover an account" on the sign-in screen: a link that opens the recovery kit form, which
 * takes a whole kit (either version), a bare 12-word recovery phrase or a bare `RK1-` key, and
 * the account id, filled in from a pasted kit. Renders nothing where this app cannot hold keys.
 */
export function RecoverAccount({ onSuccess }: { onSuccess: (userId: string) => void }) {
  const { capabilities } = useRuntime();
  const [open, setOpen] = useState(false);
  if (!capabilities.identityKeys) return null;
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

/** Which password the recovered account signs in with. */
type RecoveryPath = "known" | "new";

function RecoverAccountForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (userId: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [kit, setKit] = useState("");
  const [accountId, setAccountId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [path, setPath] = useState<RecoveryPath>("known");
  const [password, setPassword] = useState("");
  const [next, setNext] = useState(EMPTY_NEW_PASSWORD);
  const [problem, setProblem] = useState<string | null>(null);
  const [keep, setKeep] = useState(() => keepSignedInByDefault(isTauri()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The account this device holds new keys for once the recovery landed: a retry signs in.
  const [recovered, setRecovered] = useState<string | null>(null);
  // Set once a new password is set: a retry only signs in with it.
  const [reset, setReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function changeKit(text: string) {
    setKit(text);
    // A pasted kit names its account: its id wins over one typed before.
    const idInKit = accountIdInKit(text);
    if (idInKit) setAccountId(idInKit);
  }

  /** The phrase's 16 bytes, or `null` for an older kit's `RK1-` key, which has none. */
  async function entropyOf(text: string): Promise<Uint8Array | null> {
    try {
      return await parseRecoveryPhrase(text);
    } catch {
      return null;
    }
  }

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nextProblem = path === "new" && !reset ? newPasswordProblem(next) : null;
    setProblem(nextProblem);
    if (nextProblem) return;
    const entropy = await entropyOf(kit);
    if (path === "new" && !entropy) {
      setError("Setting a new password needs the 12-word recovery phrase.");
      return;
    }
    setBusy(true);
    try {
      let principalId = recovered;
      if (!principalId) {
        try {
          principalId = await recoverDeviceKeys(kit, accountId.trim() || null, deviceName);
        } catch (err) {
          setError(graphqlErrorMessage(err, "Recovery failed."));
          return;
        }
        setRecovered(principalId);
      }
      const entry = { password: path === "new" ? next.password : password, keep };
      if (path === "new" && entropy && !reset) {
        try {
          await resetPassword(principalId, entropy, entry.password);
        } catch (err) {
          setError(graphqlErrorMessage(err, "The new password could not be set."));
          return;
        }
        setReset(true);
      }
      const result = await signInWithPassword(principalId, entry, {
        ...(entropy && { recoveryEntropy: entropy }),
      });
      onSuccess(result.userId);
    } catch (err) {
      setPassword("");
      const message = signInFailure(err);
      if (message)
        setError(`This device now holds the account's keys, but signing in failed: ${message}`);
    } finally {
      setBusy(false);
      // A recovery that landed but could not sign in leaves keys to sign in with.
      void qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(getGraphqlEndpoint()) });
    }
  }

  const passwordReady = path === "known" ? password.length > 0 : next.password.length > 0;

  return (
    <form
      onSubmit={(e) => void recover(e)}
      className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4"
    >
      <p className="text-sm font-medium text-rim-text">Recover an account</p>
      <p className="text-xs text-rim-text-muted">
        Paste the recovery kit you saved when you created the account, or type its 12-word recovery
        phrase (an older kit has a recovery key starting with RK1- instead). This device becomes the
        account&apos;s new device with a new identity key, and every other device and session of the
        account is signed out.
      </p>
      <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        Recovery kit or phrase
        <textarea
          value={kit}
          onChange={(e) => changeKit(e.target.value)}
          rows={4}
          spellCheck={false}
          disabled={recovered !== null}
          placeholder={"RIM recovery kit (v2)\nAccount id: rimp1_…\nRecovery phrase: 12 words"}
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>
      <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        Account id
        <input
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="rimp1_…"
          spellCheck={false}
          disabled={recovered !== null}
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>
      <label className="block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        Name of this device
        <input
          value={deviceName}
          maxLength={64}
          onChange={(e) => setDeviceName(e.target.value)}
          disabled={recovered !== null}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <div
        role="radiogroup"
        aria-label="Which password"
        className="space-y-1 text-sm text-rim-text-muted"
      >
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="recovery-password"
            checked={path === "known"}
            disabled={reset}
            onChange={() => setPath("known")}
          />
          I know my password or PIN
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="recovery-password"
            checked={path === "new"}
            onChange={() => setPath("new")}
          />
          Set a new password
        </label>
      </div>
      {path === "known" ? (
        <PasswordInput
          label="Password or PIN"
          value={password}
          onChange={setPassword}
          disabled={busy}
        />
      ) : (
        <NewPasswordFields
          label="New password"
          value={next}
          onChange={(value) => {
            setNext(value);
            setProblem(null);
          }}
          problem={problem}
          disabled={busy || reset}
        />
      )}
      <KeepSignedInCheckbox checked={keep} onChange={setKeep} disabled={busy} />
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
          disabled={!kit.trim() || !deviceName.trim() || !accountId.trim() || !passwordReady}
        >
          {recovered ? "Sign in" : "Recover account"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
