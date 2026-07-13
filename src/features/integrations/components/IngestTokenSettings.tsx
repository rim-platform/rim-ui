import { useMemo, useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { toast } from "../../../shared/toast";
import { getApiOrigin } from "../../../core/graphql/config";
import { useChannels } from "../../conversations/api/useChannels";
import { IncidentSeverityGql } from "../../../core/graphql/generated/schema-types";
import { formatTime, formatRelativeTime } from "../../../shared/utils/formatTime";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import {
  useIngestTokens,
  useCreateIngestToken,
  useRevokeIngestToken,
  type IngestToken,
  type CreateIngestTokenResult,
} from "../api/useIngestTokens";

const SEVERITY_OPTIONS = [
  IncidentSeverityGql.SEV_1,
  IncidentSeverityGql.SEV_2,
  IncidentSeverityGql.SEV_3,
  IncidentSeverityGql.SEV_4,
];

const INGEST_ENDPOINTS = ["generic", "alertmanager", "grafana"] as const;

interface IngestTokenSettingsProps {
  serverId: string | null;
}

/**
 * Settings tab for managing alert-ingest tokens (Track B2): tokens let
 * external monitors (Prometheus/Alertmanager, Grafana, or a generic webhook)
 * open and update incidents in this workspace.
 *
 * **Owner-only gating:** the backend enforces owner-only (`ensure_server_owner`) on the
 * `ingestTokens` query and the create/revoke mutations regardless of what the client does.
 * This component now gates its create-token form and revoke buttons on
 * {@link useIsOwner} (Track C1's `Server.viewerRole`), retiring the earlier best-effort gap
 * where the tab rendered unconditionally for any member. The query itself is only issued
 * for owners — a non-owner never round-trips to a forbidden response. The list/loading/error
 * states are kept as a belt-and-suspenders fallback in case role and server state disagree.
 */
export function IngestTokenSettings({ serverId }: IngestTokenSettingsProps) {
  const isOwner = useIsOwner(serverId ?? undefined);
  const {
    data: tokens,
    isPending,
    isError,
  } = useIngestTokens(isOwner ? (serverId ?? undefined) : undefined);
  const { data: channelsData } = useChannels(serverId ?? undefined);
  const createToken = useCreateIngestToken();
  const revokeToken = useRevokeIngestToken();

  const [label, setLabel] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [severityDefault, setSeverityDefault] = useState<IncidentSeverityGql | "">("");
  const [created, setCreated] = useState<CreateIngestTokenResult | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<IngestToken | null>(null);

  const channelNameById = useMemo(
    () => new Map((channelsData?.items ?? []).map((ch) => [ch.id, ch.title ?? ch.id])),
    [channelsData],
  );

  function handleCreate() {
    if (!serverId || !label.trim() || !conversationId) return;
    createToken.mutate(
      {
        serverId,
        conversationId,
        label: label.trim(),
        ...(severityDefault ? { severityDefault } : {}),
      },
      {
        onSuccess: (result) => {
          setCreated(result);
          setCopiedToken(false);
          setLabel("");
          setConversationId("");
          setSeverityDefault("");
        },
      },
    );
  }

  function handleCopyToken() {
    if (!created) return;
    navigator.clipboard
      .writeText(created.rawToken)
      .then(() => {
        setCopiedToken(true);
        toast.success("Token copied");
        setTimeout(() => setCopiedToken(false), 2000);
      })
      .catch(() => toast.error("Couldn't copy — copy manually"));
  }

  function handleCopyEndpoint(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Endpoint URL copied"))
      .catch(() => toast.error("Couldn't copy — copy manually"));
  }

  function handleConfirmRevoke() {
    if (!serverId || !revokeTarget) return;
    revokeToken.mutate(
      { serverId, tokenId: revokeTarget.id },
      { onSuccess: () => setRevokeTarget(null) },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Integrations</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Alert-ingest tokens let external monitors (Prometheus/Alertmanager, Grafana, or a generic
          webhook) open and update incidents in this channel.
        </p>
      </div>

      {!isOwner && (
        <p className="rounded-lg border border-rim-line bg-rim-panel-soft px-3 py-2 text-sm text-rim-text-muted">
          Ingest-token management is owner-only. Ask a workspace owner to create or revoke tokens
          for this server.
        </p>
      )}

      {isOwner && isPending && <p className="text-sm text-rim-text-muted">Loading tokens…</p>}
      {isOwner && isError && (
        <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
          Failed to load ingest tokens. If you're not a workspace owner, this is expected —
          ingest-token management is owner-only.
        </p>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="space-y-2">
          {tokens.map((token) => {
            const revoked = Boolean(token.revokedAt);
            return (
              <li
                key={token.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-rim-line bg-rim-panel p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-rim-text">
                    {token.label}{" "}
                    {revoked && (
                      <span className="ml-1 rounded bg-rim-danger/10 px-1.5 py-0.5 text-[10px] text-rim-danger">
                        Revoked
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-rim-text-muted">
                    # {channelNameById.get(token.conversationId) ?? token.conversationId}
                  </p>
                  <p className="text-[11px] text-rim-text-faint">
                    Created {formatTime(token.createdAt)} · Last used{" "}
                    {token.lastUsedAt ? formatRelativeTime(token.lastUsedAt) : "never"}
                  </p>
                </div>
                {!revoked && isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevokeTarget(token)}
                    aria-label={`Revoke ${token.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isOwner && (
        <div className="rounded-lg border border-rim-line bg-rim-panel p-4 space-y-3">
          <h3 className="text-sm font-medium text-rim-text">Create ingest token</h3>

          {!created ? (
            <>
              <div>
                <label className="mb-1 block text-[11px] text-rim-text-muted">Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Production Alertmanager"
                  className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-rim-text-muted">Target channel</label>
                <select
                  value={conversationId}
                  onChange={(e) => setConversationId(e.target.value)}
                  className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                >
                  <option value="">Select channel…</option>
                  {(channelsData?.items ?? []).map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      # {ch.title ?? ch.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-rim-text-muted">
                  Default severity (optional)
                </label>
                <select
                  value={severityDefault}
                  onChange={(e) => setSeverityDefault(e.target.value as IncidentSeverityGql | "")}
                  className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                >
                  <option value="">No default</option>
                  {SEVERITY_OPTIONS.map((sev) => (
                    <option key={sev} value={sev}>
                      {sev}
                    </option>
                  ))}
                </select>
              </div>
              {createToken.error && (
                <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                  {import.meta.env.DEV && createToken.error instanceof Error
                    ? createToken.error.message
                    : "Failed to create token"}
                </p>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreate}
                disabled={!label.trim() || !conversationId || createToken.isPending}
                isLoading={createToken.isPending}
              >
                Create token
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-rim-text-muted">
                Copy this token now — it's shown only once and can't be retrieved again.
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-rim-text">
                  {created.rawToken}
                </span>
                <button
                  type="button"
                  onClick={handleCopyToken}
                  className="shrink-0 rounded p-1 text-rim-text-muted transition hover:text-rim-text"
                  aria-label="Copy token"
                >
                  {copiedToken ? (
                    <Check className="h-4 w-4 text-rim-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>

              <p className="text-xs text-rim-text-muted">
                Send it as{" "}
                <code className="rounded bg-rim-void px-1 py-0.5">
                  Authorization: Bearer &lt;token&gt;
                </code>{" "}
                (or <code className="rounded bg-rim-void px-1 py-0.5">X-RIM-Ingest-Token</code> if
                the monitor can't set a custom Authorization header — see{" "}
                <code className="rounded bg-rim-void px-1 py-0.5">rim-server/docs/alerts.md</code>).
              </p>

              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wider text-rim-text-faint">
                  Ingest endpoints
                </p>
                {INGEST_ENDPOINTS.map((kind) => {
                  const url = `${getApiOrigin()}/api/hooks/alerts/${kind}`;
                  return (
                    <div
                      key={kind}
                      className="flex items-center gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-rim-text">
                        {url}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyEndpoint(url)}
                        className="shrink-0 rounded p-1 text-rim-text-muted transition hover:text-rim-text"
                        aria-label={`Copy ${kind} endpoint`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCreated(null);
                  createToken.reset();
                }}
              >
                Done
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revoke ingest token?"
      >
        <div className="space-y-4">
          <p className="text-sm text-rim-text-muted">
            {revokeTarget?.label ? `"${revokeTarget.label}"` : "This token"} will stop working
            immediately. Any monitor still configured with it will get{" "}
            <code className="rounded bg-rim-void px-1 py-0.5">401</code> responses. This can't be
            undone.
          </p>
          {revokeToken.error && (
            <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
              Failed to revoke token.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmRevoke}
              isLoading={revokeToken.isPending}
            >
              Revoke
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
