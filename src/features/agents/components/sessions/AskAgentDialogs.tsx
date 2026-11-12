import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import type { AgentSession } from "../../acp/agentSession";
import { askChipLabel } from "../../runtime/askContext";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import {
  answerGrantOffer,
  askInNewSession,
  askInSession,
  cancelAsk,
  useAskAgentStore,
  type GrantOffer,
} from "../../state/useAskAgentStore";
import {
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
} from "../../state/useAgentSessionsStore";
import { GRANT_PROVIDER_NOTE } from "../AgentGrantsDialog";
import { useStatuses } from "./useSessionStatuses";
import { cannotReadRimSentence, UNTITLED_SESSION } from "./sessionText";

/** The dialogs of "Ask agent…": the session chooser and the grant offer, while one is open. */
export function AskAgentHost() {
  const choosing = useAskAgentStore((s) => s.choosing !== null);
  const offer = useAskAgentStore((s) => s.offer);
  return (
    <>
      {choosing && <ChooseSessionDialog />}
      {offer && <GrantOfferDialog offer={offer} />}
    </>
  );
}

/** One running session the chooser lists. */
function SessionChoice({ sessionKey, session }: { sessionKey: string; session: AgentSession }) {
  const title = useAgentSessionsStore(
    (s) => s.recent.find((item) => item.key === sessionKey)?.title ?? null,
  );
  const { name, cwd, rimTools } = session.getSnapshot();
  const shownName = showInvisibleCharacters(name);
  return (
    <li>
      <button
        type="button"
        onClick={() => askInSession(sessionKey)}
        className="w-full rounded-lg border border-rim-line px-3 py-2 text-left hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        <span className="block text-sm text-rim-text">{shownName}</span>
        <span className="block truncate text-xs text-rim-text-muted">
          {title ? showInvisibleCharacters(title) : UNTITLED_SESSION}
        </span>
        {cwd && <code className="block truncate font-mono text-xs text-rim-text-faint">{cwd}</code>}
        {rimTools !== null && rimTools !== "available" && (
          <span className="mt-1 block text-xs text-rim-warm">
            {cannotReadRimSentence(shownName, rimTools)}
          </span>
        )}
      </button>
    </li>
  );
}

/** Lists the sessions that take a prompt, and New session…, for what is asked about. */
function ChooseSessionDialog() {
  const subject = useAskAgentStore((s) => s.choosing);
  const sessions = useRunningAgentSessionsStore((s) => s.sessions);
  const statuses = useStatuses(sessions);
  const open = Object.keys(sessions).filter(
    (key) => statuses[key] === "ready" || statuses[key] === "working",
  );
  if (!subject) return null;
  return (
    <Dialog open title="Ask an agent" maxWidth="max-w-lg" onClose={cancelAsk}>
      <p className="text-sm text-rim-text-muted">
        {showInvisibleCharacters(askChipLabel(subject))}. Choose a session, then write your question
        there. Nothing is sent until you press Enter.
      </p>
      <ul aria-label="Agent sessions" className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
        {open.map((key) => (
          <SessionChoice key={key} sessionKey={key} session={sessions[key]} />
        ))}
        <li>
          <button
            type="button"
            onClick={askInNewSession}
            className="w-full rounded-lg border border-dashed border-rim-line px-3 py-2 text-left text-sm text-rim-text hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
          >
            New session…
          </button>
        </li>
      </ul>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="secondary" onClick={cancelAsk}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/** Offers a read grant for one channel; only its button grants anything. */
function GrantOfferDialog({ offer }: { offer: GrantOffer }) {
  const agentName = showInvisibleCharacters(offer.agentName);
  const channel = `#${showInvisibleCharacters(offer.channelName)}`;
  return (
    <Dialog
      open
      title={`${agentName} can't read ${channel} yet`}
      maxWidth="max-w-md"
      onClose={() => answerGrantOffer(false)}
    >
      <p className="text-sm text-rim-text">Let it read {channel}?</p>
      <p className="mt-2 text-xs text-rim-text-muted">
        Only this channel. Reads in it don&apos;t prompt after this, and you can change this at any
        time in Settings → Agents.
      </p>
      <p className="mt-1 text-xs text-rim-text-muted">{GRANT_PROVIDER_NOTE}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => answerGrantOffer(false)}>
          Not now
        </Button>
        <Button type="button" onClick={() => answerGrantOffer(true)}>
          Let it read {channel}
        </Button>
      </div>
    </Dialog>
  );
}
