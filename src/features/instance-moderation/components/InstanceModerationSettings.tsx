import { useState } from "react";
import { Loader2 } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  isOperatorRefusal,
  useInstanceIpBlocks,
  useInstancePrincipalBlocks,
  useInstanceReports,
  useIsInstanceOperator,
} from "../api/instanceModeration";
import { ClearProfileDialog } from "./ClearProfileDialog";
import { IpBlocksSection } from "./IpBlocksSection";
import { PrincipalBlocksSection, type BlockDraft } from "./PrincipalBlocksSection";
import { useLocalDirectSpaceId } from "../../relay/runtime/useDirectSpaceRuntime";
import { MessageReportsList } from "../../settings/components/ModerationSettings";
import { ReportsSection } from "./ReportsSection";
import { ERROR_BOX } from "./styles";

/**
 * Settings → Instance → Moderation: the server's abuse reports, the reports of messages in its
 * DMs and groups (its direct space, which has no moderators), blocked principals and the IP
 * deny list, for instance operators. Anyone else, and an operator the server refuses with
 * `FORBIDDEN`, sees that the page is for operators only.
 */
export function InstanceModerationSettings({
  onNavigateToWorkspaceModeration,
}: {
  onNavigateToWorkspaceModeration?: () => void;
}) {
  const { isOperator, isPending, error } = useIsInstanceOperator();
  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-rim-accent" aria-label="Checking your role" />
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className={ERROR_BOX}>
        {graphqlErrorMessage(error, "Could not check whether you operate this server.")}
      </p>
    );
  }
  if (!isOperator) return <OperatorsOnly />;
  return <ModerationQueue onNavigateToWorkspaceModeration={onNavigateToWorkspaceModeration} />;
}

function OperatorsOnly() {
  return (
    <div role="status" className="rounded-lg border border-rim-line bg-rim-panel p-5">
      <h2 className="text-base font-semibold text-rim-text">Instance operators only</h2>
      <p className="mt-1 text-sm text-rim-text-muted">
        The moderation queue of this server is open to its instance operators. The server&apos;s
        administrator grants the role from the server&apos;s command line.
      </p>
    </div>
  );
}

function ModerationQueue({
  onNavigateToWorkspaceModeration,
}: {
  onNavigateToWorkspaceModeration?: () => void;
}) {
  const [openOnly, setOpenOnly] = useState(true);
  const [draft, setDraft] = useState<BlockDraft>({ principalId: "", seq: 0 });
  const [clearing, setClearing] = useState<string | null>(null);
  const reports = useInstanceReports(openOnly);
  const principalBlocks = useInstancePrincipalBlocks();
  const ipBlocks = useInstanceIpBlocks();
  const directSpaceId = useLocalDirectSpaceId();
  const blockPrincipal = (principalId: string) =>
    setDraft((current) => ({ principalId, seq: current.seq + 1 }));

  if ([reports.error, principalBlocks.error, ipBlocks.error].some(isOperatorRefusal)) {
    return <OperatorsOnly />;
  }

  return (
    <section className="space-y-6" aria-labelledby="instance-moderation-heading">
      <div>
        <h2 id="instance-moderation-heading" className="text-base font-semibold text-rim-text">
          Instance moderation
        </h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Abuse reports, reported messages in direct messages and groups, blocked principals and
          blocked addresses for this whole server. Every action here is recorded in the
          server&apos;s audit log.
        </p>
      </div>
      <p className="text-sm text-rim-text-muted">
        Reports of messages in a workspace&apos;s channels go to that workspace&apos;s moderators.
        {onNavigateToWorkspaceModeration && (
          <button
            type="button"
            className="ml-2 text-rim-accent underline"
            onClick={onNavigateToWorkspaceModeration}
          >
            Open workspace moderation
          </button>
        )}
      </p>
      <ReportsSection
        reports={reports}
        openOnly={openOnly}
        onOpenOnlyChange={setOpenOnly}
        onBlockPrincipal={blockPrincipal}
        onClearProfile={setClearing}
      />
      {directSpaceId && (
        <MessageReportsList
          serverId={directSpaceId}
          title="Reported direct messages"
          onBlockPrincipal={blockPrincipal}
          onClearProfile={setClearing}
        />
      )}
      <PrincipalBlocksSection blocks={principalBlocks} draft={draft} />
      <IpBlocksSection blocks={ipBlocks} />
      {clearing && <ClearProfileDialog principalId={clearing} onClose={() => setClearing(null)} />}
    </section>
  );
}
