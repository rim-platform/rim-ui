import { Button } from "../../../shared/ui/Button";
import { useRevokeCapability } from "../api/usePluginCapabilities";
import { EMPTY_AUDIT } from "../audit";
import type { PluginInfo } from "../types";
import { capabilityLabel, plainCapabilityOf } from "./consentText";

/** Grant events the panel lists, newest first. */
const SHOWN_EVENTS = 20;
/** Days of encrypted reads the panel lists, newest first. */
const SHOWN_DAYS = 14;

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

/**
 * A plugin's permissions and what it did with them: each approved capability with a
 * way to revoke it (which stops the plugin), when each was given and revoked, and how
 * many encrypted messages it read each day.
 */
export function PluginAuditPanel({ plugin }: { plugin: PluginInfo }) {
  const revoke = useRevokeCapability();
  const audit = plugin.audit ?? EMPTY_AUDIT;
  const events = [...audit.grants].reverse().slice(0, SHOWN_EVENTS);
  const days = Object.entries(audit.encrypted_reads)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, SHOWN_DAYS);
  // Revoking a plain chat capability takes its encrypted one with it.
  const dependents = (capability: string) =>
    plugin.approved_capabilities.filter((c) => plainCapabilityOf(c) === capability);

  async function revokeAll(capability: string) {
    // One at a time: each revocation rewrites the plugin's record.
    for (const c of [...dependents(capability), capability]) {
      await revoke.mutateAsync({ pluginId: plugin.plugin_id, capability: c }).catch(() => {});
    }
  }

  return (
    <div className="space-y-3 border-t border-rim-line px-4 py-3 text-xs">
      <section aria-label="Approved permissions">
        <h4 className="mb-1 font-medium text-rim-text">Approved permissions</h4>
        {plugin.approved_capabilities.length === 0 ? (
          <p className="text-rim-text-muted">None.</p>
        ) : (
          <ul className="space-y-1">
            {plugin.approved_capabilities.map((capability) => (
              <li key={capability} className="flex items-center justify-between gap-2">
                <span className="text-rim-text">{capabilityLabel(capability)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => void revokeAll(capability)}
                  aria-label={`Revoke ${capabilityLabel(capability)}`}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-rim-text-faint">
          Revoking a permission stops the plugin.
        </p>
      </section>

      <section aria-label="Encrypted messages read">
        <h4 className="mb-1 font-medium text-rim-text">Encrypted messages read</h4>
        {days.length === 0 ? (
          <p className="text-rim-text-muted">None.</p>
        ) : (
          <ul className="space-y-0.5">
            {days.map(([day, count]) => (
              <li key={day} className="flex justify-between text-rim-text-muted">
                <span>{day}</span>
                <span>
                  {count} {count === 1 ? "message" : "messages"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Permission history">
        <h4 className="mb-1 font-medium text-rim-text">Permission history</h4>
        {events.length === 0 ? (
          <p className="text-rim-text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {events.map((event, i) => (
              <li key={`${event.at}-${event.capability}-${i}`} className="text-rim-text-muted">
                <span className="text-rim-text">{capabilityLabel(event.capability)}</span>{" "}
                {event.action === "granted" ? "granted" : "revoked"} {when(event.at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
