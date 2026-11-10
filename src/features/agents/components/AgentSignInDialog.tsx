import { useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { Dialog } from "../../../shared/ui/Dialog";
import { commandLine, findPreset } from "../acp/acpPresets";
import {
  openSignInTerminal,
  SignInProbe,
  signInWays,
  type SignInProbeDeps,
  type SignInWay,
} from "../acp/agentSignIn";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";

/** What the dialog says when the agent names no way to sign in and has no setup of its own. */
export const NO_SIGN_IN_WAY = "This agent didn't say how to sign in. Use its own instructions.";
/** What the dialog says once a terminal opened for signing in. */
export const FINISH_IN_TERMINAL = "Finish signing in in the terminal window, then come back.";
/** What the dialog says while the agent waits for the person in the browser. */
export const FINISH_IN_BROWSER = "Finish in your browser…";
/** What the dialog says once the agent signed in. */
export const SIGNED_IN = "Signed in.";

/** Where one way of signing in is. */
type WayState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "opened" }
  | { kind: "declined" }
  | { kind: "no_terminal"; commandLine: string }
  | { kind: "signed_in" }
  | { kind: "failed"; error: string };

type ProbeState =
  { kind: "asking" } | { kind: "ready"; ways: SignInWay[] } | { kind: "failed"; error: string };

function sentence(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/**
 * Signing in to an agent program: starts it briefly to ask which ways it offers, and offers
 * each, opening its sign-in in a terminal or asking it to sign in itself. The program stops when
 * the dialog closes.
 *
 * @param profile - The agent program.
 * @param onFinished - Called when a terminal opened for signing in or the agent signed in.
 * @param probeDeps - What the short run reaches outside itself, for tests.
 */
export function AgentSignInDialog({
  profile: given,
  onClose,
  onFinished,
  probeDeps,
}: {
  profile: AgentProgramProfile;
  onClose: () => void;
  onFinished?: () => void;
  probeDeps?: Partial<SignInProbeDeps>;
}) {
  // The profile as the dialog opened: a later change of the stored one doesn't start it again.
  const [profile] = useState(given);
  const name = showInvisibleCharacters(profile.name);
  const [probeState, setProbeState] = useState<ProbeState>({ kind: "asking" });
  const [states, setStates] = useState<Record<string, WayState>>({});
  const probeRef = useRef<SignInProbe | null>(null);
  const depsRef = useRef(probeDeps);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    let live = true;
    SignInProbe.open(profile, depsRef.current).then(
      (probe) => {
        if (!live) return void probe.stop().catch(() => {});
        const ways = signInWays(profile, probe.methods);
        if (ways.some((way) => way.kind === "agent")) probeRef.current = probe;
        else void probe.stop().catch(() => {});
        setProbeState({ kind: "ready", ways });
      },
      (error: unknown) => {
        if (live) {
          setProbeState({ kind: "failed", error: sentence(error, "The agent did not start.") });
        }
      },
    );
    return () => {
      live = false;
      void probeRef.current?.stop().catch(() => {});
      probeRef.current = null;
    };
  }, [profile]);

  const setWay = (key: string, state: WayState) =>
    setStates((current) => ({ ...current, [key]: state }));

  const openTerminal = async (
    key: string,
    way: Extract<SignInWay, { kind: "terminal" | "setup" }>,
  ) => {
    setWay(key, { kind: "busy" });
    try {
      const outcome = await openSignInTerminal(profile, way);
      if (outcome.kind === "opened") {
        setWay(key, { kind: "opened" });
        finishedRef.current?.();
      } else if (outcome.kind === "declined") {
        setWay(key, { kind: "declined" });
      } else {
        setWay(key, { kind: "no_terminal", commandLine: outcome.commandLine });
        finishedRef.current?.();
      }
    } catch (error) {
      setWay(key, { kind: "failed", error: sentence(error, "The terminal did not open.") });
    }
  };

  const authenticate = async (key: string, methodId: string) => {
    const probe = probeRef.current;
    if (!probe) {
      setWay(key, {
        kind: "failed",
        error: "The agent is no longer running. Close and try again.",
      });
      return;
    }
    setWay(key, { kind: "busy" });
    try {
      await probe.authenticate(methodId);
      setWay(key, { kind: "signed_in" });
      probeRef.current = null;
      void probe.stop().catch(() => {});
      finishedRef.current?.();
    } catch (error) {
      setWay(key, { kind: "failed", error: sentence(error, "Signing in did not work.") });
    }
  };

  const preset = findPreset(profile.presetId);

  return (
    <Dialog open title={`Sign in to ${name}`} maxWidth="max-w-lg" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-rim-text-muted">
          You sign in with {name} itself. It keeps what you sign in with; RIM never sees it.
        </p>
        {probeState.kind === "asking" && (
          <p className="text-sm text-rim-text-muted">Asking {name} how to sign in…</p>
        )}
        {probeState.kind === "failed" && (
          <div className="space-y-1">
            <p role="alert" className="text-sm text-rim-danger">
              {probeState.error}
            </p>
            {preset && <p className="text-xs text-rim-text-muted">{preset.signIn}</p>}
          </div>
        )}
        {probeState.kind === "ready" && probeState.ways.length === 0 && (
          <div className="space-y-1">
            <p className="text-sm text-rim-text">{NO_SIGN_IN_WAY}</p>
            {preset && <p className="text-xs text-rim-text-muted">{preset.signIn}</p>}
          </div>
        )}
        {probeState.kind === "ready" && probeState.ways.length > 0 && (
          <ul aria-label="Ways to sign in" className="space-y-2">
            {probeState.ways.map((way, index) => {
              const key = way.kind === "setup" ? "setup" : `${index}:${way.method.id}`;
              return (
                <WayCard
                  key={key}
                  way={way}
                  agentName={name}
                  program={profile.resolvedProgram ?? profile.program}
                  state={states[key] ?? { kind: "idle" }}
                  onOpenTerminal={(terminalWay) => void openTerminal(key, terminalWay)}
                  onAuthenticate={(methodId) => void authenticate(key, methodId)}
                />
              );
            })}
          </ul>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function WayCard({
  way,
  agentName,
  program,
  state,
  onOpenTerminal,
  onAuthenticate,
}: {
  way: SignInWay;
  agentName: string;
  program: string;
  state: WayState;
  onOpenTerminal: (way: Extract<SignInWay, { kind: "terminal" | "setup" }>) => void;
  onAuthenticate: (methodId: string) => void;
}) {
  const title =
    way.kind === "setup" ? `Set up ${agentName}` : showInvisibleCharacters(way.method.name);
  const description =
    way.kind === "setup"
      ? `Runs ${agentName}'s own setup in a terminal.`
      : way.method.description !== null
        ? showInvisibleCharacters(way.method.description)
        : null;
  const busy = state.kind === "busy";
  return (
    <li className="space-y-2 rounded-lg border border-rim-line bg-rim-panel px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="break-words text-sm font-medium text-rim-text">{title}</p>
          {description !== null && (
            <p className="break-words text-xs text-rim-text-muted">{description}</p>
          )}
        </div>
        {(way.kind === "terminal" || way.kind === "setup") && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            isLoading={busy}
            aria-label={`Open terminal: ${title}`}
            onClick={() => onOpenTerminal(way)}
          >
            Open terminal
          </Button>
        )}
        {way.kind === "agent" && state.kind !== "signed_in" && (
          <Button
            type="button"
            size="sm"
            isLoading={busy}
            aria-label={`Sign in: ${title}`}
            onClick={() => onAuthenticate(way.method.id)}
          >
            Sign in
          </Button>
        )}
      </div>
      {(way.kind === "terminal" || way.kind === "setup") && (
        <code className="block whitespace-pre-wrap break-all font-mono text-xs text-rim-text-muted">
          {[
            ...(way.kind === "terminal"
              ? Object.entries(way.env).map(([key, value]) => `${key}=${value}`)
              : []),
            commandLine(program, way.args),
          ].join(" ")}
        </code>
      )}
      {way.kind === "terminal_refused" && (
        <p className="text-xs text-rim-warm">
          {way.reason} Use {agentName}&apos;s own instructions.
        </p>
      )}
      {way.kind === "env_var" && (
        <p className="text-xs text-rim-text-muted">
          {way.method.vars.length > 0
            ? `Set ${way.method.vars.join(", ")} before starting RIM.`
            : "Set the variables its own instructions name before starting RIM."}
        </p>
      )}
      {way.kind === "other" && (
        <p className="text-xs text-rim-text-muted">
          RIM can&apos;t use this way of signing in. Use {agentName}&apos;s own instructions.
        </p>
      )}
      {way.kind === "agent" && busy && <p className="text-xs text-rim-text">{FINISH_IN_BROWSER}</p>}
      <WayStateLine state={state} />
    </li>
  );
}

function WayStateLine({ state }: { state: WayState }) {
  switch (state.kind) {
    case "idle":
      return null;
    case "busy":
      return null;
    case "opened":
      return <p className="text-xs text-rim-text">{FINISH_IN_TERMINAL}</p>;
    case "declined":
      return <p className="text-xs text-rim-text-muted">Not opened.</p>;
    case "no_terminal":
      return (
        <div className="space-y-1">
          <p className="text-xs text-rim-text-muted">
            RIM couldn&apos;t open a terminal on this computer. Run this in one, then come back:
          </p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 font-mono text-xs text-rim-text">
              {state.commandLine}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Copy the command"
              onClick={() => copyToClipboard(state.commandLine)}
            >
              Copy
            </Button>
          </div>
        </div>
      );
    case "signed_in":
      return <p className="text-xs text-rim-success">{SIGNED_IN}</p>;
    case "failed":
      return (
        <p role="alert" className="text-xs text-rim-danger">
          {state.error}
        </p>
      );
  }
}
