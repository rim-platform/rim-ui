import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

import { detectPlatform } from "../../../../core/runtime/runtime";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { toast } from "../../../../shared/toast";
import { Button } from "../../../../shared/ui/Button";
import { copyToClipboard } from "../../../../shared/ui/contextMenu/menuActions";
import { ConfirmActionDialog } from "../../../conversations/components/ConfirmActionDialog";
import { DESKTOP_ONLY_MESSAGE } from "../../acp/agentRunner";
import {
  cannotReopenSentence,
  type AgentSession,
  type AgentSessionSnapshot,
} from "../../acp/agentSession";
import { askContext } from "../../runtime/askContext";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { useAgentProgramsStore } from "../../state/useAgentProgramsStore";
import {
  dismissAgentSession,
  isLiveStatus,
  markAgentSessionSeen,
  reopenAgentSession,
  requestStopAgentSession,
  retryAgentSession,
  stopAgentSession,
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
  type RecentAgentSession,
} from "../../state/useAgentSessionsStore";
import { removeAbout, setAbout, useAskAgentStore } from "../../state/useAskAgentStore";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { AgentSignInDialog } from "../AgentSignInDialog";
import { AgentTranscript } from "./AgentTranscript";
import { PageBar } from "./AgentSessionsPage";
import { ApprovalCard } from "./ApprovalCard";
import { AboutChip, RefusalCards } from "./AskAgentParts";
import { SessionStatusChip } from "./sessionParts";
import { SessionSettings } from "./SessionSettings";
import {
  agentCannotSentence,
  bridgeOffSentence,
  openAgentsSettings,
  PROFILE_GONE,
  sandboxSentence,
  UNTITLED_SESSION,
} from "./sessionText";
import { useSessionSnapshot } from "./useSessionSnapshot";

/** How close to the bottom, in pixels, still counts as following the transcript. */
const FOLLOW_SLACK = 40;

function backToList(): void {
  useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
}

/** One agent session's page, by its key. */
export function AgentSessionPage({ sessionKey }: { sessionKey: string }) {
  const session = useRunningAgentSessionsStore((s) => s.sessions[sessionKey]);
  const entry = useAgentSessionsStore((s) => s.recent.find((item) => item.key === sessionKey));
  const snapshot = useSessionSnapshot(session);
  const unseen = useRunningAgentSessionsStore((s) => s.unseen[sessionKey] === true);
  // The page being shown is the person looking at the session.
  useEffect(() => {
    markAgentSessionSeen(sessionKey);
  }, [sessionKey, unseen]);
  if (detectPlatform() !== "desktop") {
    return (
      <div className="flex h-full flex-col">
        <SessionBar name="Agent session" />
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          <p className="text-sm text-rim-text-muted">{DESKTOP_ONLY_MESSAGE}.</p>
        </div>
      </div>
    );
  }
  if (!session || !snapshot) return <NotRunning sessionKey={sessionKey} entry={entry} />;
  return (
    <LiveSession sessionKey={sessionKey} session={session} snapshot={snapshot} entry={entry} />
  );
}

function SessionBar({ name, children }: { name: string; children?: React.ReactNode }) {
  return (
    <PageBar>
      <button
        type="button"
        aria-label="Back to agent sessions"
        onClick={backToList}
        className="rounded p-1 text-rim-text-muted hover:text-rim-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h1 className="min-w-0 truncate text-sm font-medium text-rim-text">
        {showInvisibleCharacters(name)}
      </h1>
      {children}
    </PageBar>
  );
}

/** The folder's full path, with a Copy button. */
function FolderLine({ path }: { path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-rim-text" title={path}>
        {path}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Copy the folder's path"
        onClick={() => copyToClipboard(path)}
      >
        Copy
      </Button>
    </div>
  );
}

function SandboxNote({ folder }: { folder: string }) {
  return <p className="text-xs text-rim-text-muted">{sandboxSentence(folder)}</p>;
}

/** A session that isn't in memory: what is known of it, and opening it again where it can be. */
function NotRunning({
  sessionKey,
  entry,
}: {
  sessionKey: string;
  entry: RecentAgentSession | undefined;
}) {
  const profileThere = useAgentProgramsStore((s) =>
    entry ? s.profiles.some((profile) => profile.id === entry.profileId) : false,
  );
  const showStart = useStartAgentSessionStore((s) => s.show);
  if (!entry) {
    return (
      <div className="flex h-full flex-col">
        <SessionBar name="Agent session" />
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-5 sm:px-6">
          <p className="text-sm text-rim-text-muted">That agent session is no longer here.</p>
          <Button type="button" size="sm" variant="secondary" onClick={backToList}>
            Agent sessions
          </Button>
        </div>
      </div>
    );
  }
  const reopen = () => {
    const refused = reopenAgentSession(sessionKey);
    if (refused === "profile_gone") toast.error(PROFILE_GONE);
    else if (refused === "cannot_reopen") toast.error(cannotReopenSentence(entry.agentName));
  };
  return (
    <div className="flex h-full flex-col">
      <SessionBar name={entry.agentName}>
        <SessionStatusChip status="ended" />
      </SessionBar>
      <div className="space-y-2 border-b border-rim-line px-4 py-2">
        <FolderLine path={entry.cwd} />
        <SandboxNote folder={entry.cwd} />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-5 sm:px-6">
        <p className="text-sm font-medium text-rim-text">
          {entry.title ? showInvisibleCharacters(entry.title) : UNTITLED_SESSION}
        </p>
        {!profileThere ? (
          <p className="text-sm text-rim-text-muted">{PROFILE_GONE}</p>
        ) : entry.canReopen ? (
          <>
            <p className="text-sm text-rim-text-muted">
              This session isn&apos;t running. Reopening starts{" "}
              {showInvisibleCharacters(entry.agentName)} again, and it shows the session&apos;s
              history.
            </p>
            <Button type="button" size="sm" onClick={reopen}>
              Reopen
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-rim-text-muted">
              {cannotReopenSentence(showInvisibleCharacters(entry.agentName))}
            </p>
            <Button type="button" size="sm" onClick={showStart}>
              Start a session
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Whether the agent offers settings the header shows. */
function hasSettings(snapshot: AgentSessionSnapshot): boolean {
  return snapshot.configOptions.length > 0 || snapshot.models !== null || snapshot.modes.length > 0;
}

function LiveSession({
  sessionKey,
  session,
  snapshot,
  entry,
}: {
  sessionKey: string;
  session: AgentSession;
  snapshot: AgentSessionSnapshot;
  entry: RecentAgentSession | undefined;
}) {
  const { status, name, cwd } = snapshot;
  const live = isLiveStatus(status);
  const turnRunning = status === "working" || status === "waiting";
  const confirmingStop = useRunningAgentSessionsStore((s) => s.stopConfirmKey === sessionKey);
  const profileThere = useAgentProgramsStore((s) =>
    s.profiles.some((profile) => profile.id === snapshot.profileId),
  );
  const shownName = showInvisibleCharacters(name);
  const canReopen = !live && entry?.canReopen === true && profileThere;

  return (
    <div className="flex h-full flex-col">
      <SessionBar name={name}>
        <SessionStatusChip status={status} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {turnRunning && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void session.cancel()}
            >
              Cancel turn
            </Button>
          )}
          {live ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="border-rim-danger/50 text-rim-danger hover:text-rim-danger"
              onClick={() => requestStopAgentSession(sessionKey)}
            >
              Stop
            </Button>
          ) : (
            <>
              {canReopen && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => reopenAgentSession(sessionKey)}
                >
                  Reopen
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  dismissAgentSession(sessionKey);
                  backToList();
                }}
              >
                Close
              </Button>
            </>
          )}
        </div>
      </SessionBar>

      <div className="space-y-2 border-b border-rim-line px-4 py-2">
        {live && hasSettings(snapshot) && (
          <div
            role="group"
            aria-label={`${shownName}'s settings`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            <SessionSettings sessionKey={sessionKey} session={session} snapshot={snapshot} />
          </div>
        )}
        {cwd && <FolderLine path={cwd} />}
        {cwd && <SandboxNote folder={cwd} />}
      </div>

      <ToolsBanner state={snapshot.rimTools} agentName={shownName} />

      <Transcript snapshot={snapshot} agentName={name} />

      {live && (
        <RefusalCards
          sessionKey={sessionKey}
          profileId={snapshot.profileId}
          agentName={shownName}
        />
      )}

      {snapshot.needsSignIn && (
        <SignInBar sessionKey={sessionKey} snapshot={snapshot} agentName={shownName} />
      )}

      {snapshot.pendingPermissions.length > 0 && (
        <Approvals session={session} snapshot={snapshot} agentName={name} />
      )}

      <Composer
        sessionKey={sessionKey}
        session={session}
        snapshot={snapshot}
        agentName={shownName}
      />

      {confirmingStop && (
        <ConfirmActionDialog
          title={`Stop ${shownName}?`}
          description={`${shownName} is in the middle of a turn. Stopping ends the agent program, and what it was doing stops where it is.`}
          confirmLabel="Stop"
          danger
          onConfirm={() => void stopAgentSession(sessionKey)}
          onClose={() => useRunningAgentSessionsStore.setState({ stopConfirmKey: null })}
        />
      )}
    </div>
  );
}

/**
 * Signing in to the session's agent when it said it needs it, then trying again in a new run of
 * it, which sends the refused prompt again.
 */
function SignInBar({
  sessionKey,
  snapshot,
  agentName,
}: {
  sessionKey: string;
  snapshot: AgentSessionSnapshot;
  agentName: string;
}) {
  const profile = useAgentProgramsStore((s) =>
    s.profiles.find((item) => item.id === snapshot.profileId),
  );
  const [open, setOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  if (!profile) return null;
  const retry = () => {
    void retryAgentSession(sessionKey).then((refused) => {
      if (refused === "profile_gone") toast.error(PROFILE_GONE);
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-rim-line bg-rim-panel px-4 py-2">
      <p className="min-w-0 flex-[1_1_16rem] text-xs text-rim-warm">
        {finished
          ? `Once you've signed in, try again: RIM starts ${agentName} again in the same folder.`
          : `Sign in once so ${agentName} can work, then try again.`}
      </p>
      <Button
        type="button"
        size="sm"
        variant={finished ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
      >
        Sign in to {agentName}
      </Button>
      {finished && (
        <Button type="button" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
      {open && (
        <AgentSignInDialog
          profile={profile}
          onClose={() => setOpen(false)}
          onFinished={() => setFinished(true)}
        />
      )}
    </div>
  );
}

/** What the session says about RIM's tools: nothing while the agent has them. */
function ToolsBanner({
  state,
  agentName,
}: {
  state: AgentSessionSnapshot["rimTools"];
  agentName: string;
}) {
  if (state === "bridge_off") {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-rim-line bg-rim-panel px-4 py-2">
        <p className="min-w-0 flex-[1_1_16rem] text-xs text-rim-warm">
          {bridgeOffSentence(agentName)}
        </p>
        <Button type="button" size="sm" variant="secondary" onClick={openAgentsSettings}>
          Open Settings &gt; Agents
        </Button>
      </div>
    );
  }
  if (state === "agent_cannot") {
    return (
      <div className="border-b border-rim-line bg-rim-panel px-4 py-2">
        <p className="text-xs text-rim-text-muted">{agentCannotSentence(agentName)}</p>
      </div>
    );
  }
  return null;
}

/** The transcript, following new content unless the person scrolled up. */
function Transcript({
  snapshot,
  agentName,
}: {
  snapshot: AgentSessionSnapshot;
  agentName: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [behind, setBehind] = useState(false);
  const { transcript, status, error, stderrTail } = snapshot;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (following.current) element.scrollTop = element.scrollHeight;
    else setBehind(true);
  }, [transcript, status]);

  const jump = () => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    following.current = true;
    setBehind(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          const atEnd =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK;
          following.current = atEnd;
          if (atEnd) setBehind(false);
        }}
      >
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-4 sm:px-6">
          {transcript.length === 0 && status === "starting" && (
            <p className="text-sm text-rim-text-muted">
              Starting {showInvisibleCharacters(agentName)}…
            </p>
          )}
          <AgentTranscript items={transcript} agentName={agentName} />
          {status === "failed" && error && <StartFailure error={error} stderrTail={stderrTail} />}
          {status === "ended" && <p className="text-xs text-rim-text-muted">Session ended.</p>}
        </div>
      </div>
      {behind && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={jump}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 shadow"
        >
          <ArrowDown className="h-3 w-3" />
          Jump to latest
        </Button>
      )}
    </div>
  );
}

/** Why the session failed, with the program's last output lines folded away. */
export function StartFailure({
  error,
  stderrTail,
}: {
  error: string;
  stderrTail: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <p role="alert" className="text-sm text-rim-danger">
        {error}
      </p>
      {stderrTail.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 rounded text-xs text-rim-text-faint hover:text-rim-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            The program&apos;s last output
          </button>
          {open && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-rim-void px-2 py-1 font-mono text-xs text-rim-text-muted">
              {stderrTail.join("\n")}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/** The permission requests waiting for the person; the first takes focus when it appears. */
function Approvals({
  session,
  snapshot,
  agentName,
}: {
  session: AgentSession;
  snapshot: AgentSessionSnapshot;
  agentName: string;
}) {
  const firstRef = useRef<HTMLDivElement>(null);
  const firstId = snapshot.pendingPermissions[0]?.requestId;
  useEffect(() => {
    if (firstId !== undefined) firstRef.current?.focus();
  }, [firstId]);
  return (
    <div
      aria-label="Waiting for your answer"
      className="max-h-[50%] shrink-0 space-y-2 overflow-y-auto border-t border-rim-line px-4 py-3"
    >
      <div className="mx-auto max-w-3xl space-y-2">
        {snapshot.pendingPermissions.map((pending, index) => (
          <ApprovalCard
            key={pending.requestId}
            ref={index === 0 ? firstRef : undefined}
            session={session}
            agentName={agentName}
            pending={pending}
          />
        ))}
      </div>
    </div>
  );
}

/** Why the composer is off, or `null` when it takes a prompt. */
function composerHint(snapshot: AgentSessionSnapshot, agentName: string): string | null {
  switch (snapshot.status) {
    case "ready":
      return null;
    case "starting":
      return `${agentName} is starting…`;
    case "working":
      return `${agentName} is working…`;
    case "waiting":
      return "Waiting for your answer above";
    case "ended":
    case "failed":
      return "Session ended";
  }
}

/**
 * Where the person writes the next prompt: only what is typed here is sent, with the link and
 * hint of what the chip above says it is about.
 */
function Composer({
  sessionKey,
  session,
  snapshot,
  agentName,
}: {
  sessionKey: string;
  session: AgentSession;
  snapshot: AgentSessionSnapshot;
  agentName: string;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hint = composerHint(snapshot, agentName);
  const ready = hint === null;
  const focusWanted = useRunningAgentSessionsStore((s) => s.focusComposerKey === sessionKey);

  useEffect(() => {
    if (!ready || !focusWanted) return;
    inputRef.current?.focus();
    useRunningAgentSessionsStore.setState({ focusComposerKey: null });
  }, [ready, focusWanted]);

  const about = useAskAgentStore((s) => s.about[sessionKey]);

  const send = () => {
    if (!ready || text.trim() === "") return;
    const prompt = text;
    setText("");
    if (about) removeAbout(sessionKey);
    session.prompt(prompt, about ? askContext(about) : undefined).catch((error: unknown) => {
      setText(prompt);
      if (about) setAbout(sessionKey, about);
      toast.error(error instanceof Error ? error.message : "The prompt did not reach the agent.");
    });
  };

  return (
    <div className="shrink-0 border-t border-rim-line px-4 py-3">
      <div className="mx-auto max-w-3xl space-y-1">
        <AboutChip sessionKey={sessionKey} />
        <textarea
          ref={inputRef}
          rows={3}
          value={text}
          disabled={!ready}
          aria-label={`Prompt for ${agentName}`}
          aria-describedby={hint !== null ? `${sessionKey}-composer-hint` : undefined}
          placeholder={`Tell ${agentName} what to do…`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
          className="w-full resize-y rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40 disabled:opacity-60"
        />
        <p id={`${sessionKey}-composer-hint`} className="min-h-4 text-xs text-rim-text-muted">
          {hint ?? "Enter sends, Shift+Enter adds a line."}
        </p>
      </div>
    </div>
  );
}
