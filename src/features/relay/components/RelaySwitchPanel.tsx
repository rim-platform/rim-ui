import { useEffect, useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { KeepSignedInCheckbox, PasswordInput } from "../../auth/components/PasswordFields";
import { keepSignedInByDefault } from "../../auth/password";
import type { MyKeyIdentity } from "../../key-identity/api/keyIdentity";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { SWITCH_STEPS } from "../remote/relaySwitch";
import { validOrigin } from "../remote/inviteLink";
import {
  beginSwitch,
  continueSwitch,
  forgetSwitch,
  loadSwitch,
  onNewRelay,
  useRelaySwitchStore,
} from "../remote/relaySwitchLive";
import { useRelayStore } from "../state/useRelayStore";

const inputClass =
  "mt-1 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

/**
 * Settings > Security > "Switch relays": move to another relay in six steps, with progress,
 * resumable after a restart. Workspaces, history and keys stay where they are; only the server
 * that carries this person's traffic changes. The account password is asked for each run: the
 * new relay checks it, or registers it with the account it opens there.
 */
export function RelaySwitchPanel({
  identity,
  displayName,
}: {
  identity: MyKeyIdentity;
  displayName: string;
}) {
  const relayOn = useRelayStore((s) => s.account?.deviceId != null);
  const state = useRelaySwitchStore((s) => s.state);
  const running = useRelaySwitchStore((s) => s.running);
  const { data: user } = useCurrentUser();
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");
  const [goesAway, setGoesAway] = useState(false);
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(() => keepSignedInByDefault(true));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (identity.principalId) void loadSwitch(identity.principalId).catch(() => undefined);
  }, [identity.principalId]);

  if (!relayOn || !identity.principalId) return null;

  async function start() {
    setError(null);
    const target = origin.trim().replace(/\/+$/, "");
    if (!validOrigin(target)) {
      setError("Enter the relay's address, like https://relay.example.");
      return;
    }
    try {
      const fresh = await beginSwitch({
        newOrigin: target,
        username: username.trim() || user?.username || "",
        oldGoesAway: goesAway,
      });
      void continueSwitch(fresh, displayName, { password, keep });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const done = state !== null && state.step >= SWITCH_STEPS.length;
  const passwordFields = (
    <div className="space-y-2">
      <PasswordInput label="Your password or PIN" value={password} onChange={setPassword} />
      <p className="text-xs text-rim-text-faint">
        The new relay checks it, or sets it for the account it opens there.
      </p>
      <KeepSignedInCheckbox checked={keep} onChange={setKeep} />
    </div>
  );
  return (
    <section className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-4">
      <p className="text-sm font-medium text-rim-text">Switch relays</p>
      <p className="text-xs text-rim-text-muted">
        Move to another relay with the same account id. Your workspaces stay on their servers and
        your history and keys stay on your devices, so nothing is lost.
      </p>

      {!state ? (
        <div className="space-y-2">
          <label className="block text-xs text-rim-text-muted">
            New relay
            <input
              className={inputClass}
              value={origin}
              placeholder="https://relay.example"
              onChange={(e) => setOrigin(e.currentTarget.value)}
            />
          </label>
          <label className="block text-xs text-rim-text-muted">
            Username there
            <input
              className={inputClass}
              value={username}
              placeholder={user?.username ?? ""}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-rim-text-muted">
            <input
              type="checkbox"
              checked={goesAway}
              onChange={(e) => setGoesAway(e.currentTarget.checked)}
            />
            This relay is going away: continue its direct messages on the new one
          </label>
          {passwordFields}
          <Button size="sm" onClick={() => void start()} disabled={!origin.trim() || !password}>
            Switch relays
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-rim-text-muted">
            From {state.oldOrigin} to {state.newOrigin}
          </p>
          <ol className="space-y-1">
            {SWITCH_STEPS.map((label, at) => {
              const finished = state.step > at;
              const current = state.step === at;
              return (
                <li key={label} className="flex items-center gap-2 text-xs">
                  {finished ? (
                    <Check className="h-3.5 w-3.5 text-rim-success" />
                  ) : current && running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-rim-accent" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-rim-text-faint" />
                  )}
                  <span className={finished ? "text-rim-text" : "text-rim-text-muted"}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
          {state.error && (
            <p role="alert" className="text-xs text-rim-danger">
              {state.error}
            </p>
          )}
          {!done && !running && passwordFields}
          {done ? (
            onNewRelay(state) ? (
              <p className="text-xs text-rim-text-muted">
                {state.successors.length > 0
                  ? `Continuing ${state.successors.length} conversations here...`
                  : "Done."}
              </p>
            ) : (
              <Button size="sm" onClick={() => window.location.reload()}>
                Restart on {state.newOrigin}
              </Button>
            )
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                isLoading={running}
                disabled={!password}
                onClick={() => void continueSwitch(state, displayName, { password, keep })}
              >
                {state.step === 0 && !state.error ? "Start" : "Continue"}
              </Button>
              {!running && state.step < 5 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void forgetSwitch(state.principalId)}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </section>
  );
}
