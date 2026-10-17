import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { INBOUND_CHOICES, OUTBOUND_CHOICES, choiceOf } from "../labels";

/**
 * The operator's DM settings for this server, read-only: the floor for DMs from other servers
 * and from outside a shared workspace, which servers people here may start DMs with, and the
 * partner servers both name. Nothing for a server that reports none.
 */
export function OperatorDmPolicy() {
  const { info } = useServerInfo();
  if (!info?.dmInbound || !info.dmOutbound) return null;
  const inbound = choiceOf(INBOUND_CHOICES, info.dmInbound);
  const outbound = choiceOf(OUTBOUND_CHOICES, info.dmOutbound);
  const partners = info.dmPartners ?? [];
  return (
    <div>
      <p className="text-xs font-medium text-rim-text-faint">Direct messages on this server</p>
      <dl aria-label="Direct messages on this server" className="mt-1.5 space-y-1 text-xs">
        <div>
          <dt className="inline text-rim-text">Incoming: </dt>
          <dd className="inline text-rim-text-muted">
            {inbound.label}. {inbound.description}
          </dd>
        </div>
        <div>
          <dt className="inline text-rim-text">Outgoing: </dt>
          <dd className="inline text-rim-text-muted">
            {outbound.label}. {outbound.description}
          </dd>
        </div>
        {partners.length > 0 && (
          <div>
            <dt className="inline text-rim-text">Partner servers: </dt>
            <dd className="inline break-all font-mono text-rim-text-muted">
              {partners.join(", ")}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-1 text-xs text-rim-text-faint">Set by the server&apos;s operator.</p>
    </div>
  );
}
