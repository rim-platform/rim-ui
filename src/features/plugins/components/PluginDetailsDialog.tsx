import { Dialog } from "../../../shared/ui/Dialog";
import type { PluginInfo, PluginInstallSource } from "../types";
import { capabilityLabel } from "./consentText";
import { kindLabel, trustBadge } from "./pluginTrust";

interface PluginDetailsDialogProps {
  plugin: PluginInfo;
  onClose: () => void;
}

/**
 * Everything the app knows about an installed plugin: its whole description, set apart as
 * the author's claim and shown as plain text, its version, author, source and kind, the
 * permissions it asks for and holds, the sites it may reach and its commands. Esc, the
 * backdrop and the close button close it.
 */
export function PluginDetailsDialog({ plugin, onClose }: PluginDetailsDialogProps) {
  const name = plugin.display_name || plugin.plugin_id;
  const granted = new Set(plugin.approved_capabilities);
  const origins = plugin.network_origins ?? [];
  const commands = plugin.commands ?? [];

  return (
    <Dialog open onClose={onClose} title={name} maxWidth="max-w-lg">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-xs text-rim-text-muted">
        {/* The author's account of the plugin, labelled and set apart from the app's words. */}
        {plugin.description ? (
          <figure className="space-y-1">
            <figcaption className="text-[11px] text-rim-text-faint">
              From the plugin author:
            </figcaption>
            <blockquote className="whitespace-pre-line break-words border-l-2 border-rim-line pl-3">
              {plugin.description}
            </blockquote>
          </figure>
        ) : (
          <p>The plugin has no description.</p>
        )}

        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-rim-text-faint">ID</dt>
          <dd className="break-all font-mono">{plugin.plugin_id}</dd>
          <dt className="text-rim-text-faint">Version</dt>
          <dd>{plugin.version}</dd>
          <dt className="text-rim-text-faint">Author</dt>
          <dd>{plugin.author || "Not given"}</dd>
          <dt className="text-rim-text-faint">Kind</dt>
          <dd>{kindLabel(plugin)}</dd>
          <dt className="text-rim-text-faint">Source</dt>
          <dd className="break-all">{sourceText(plugin.source)}</dd>
          <dt className="text-rim-text-faint">Signature</dt>
          <dd>{trustBadge(plugin)}</dd>
        </dl>

        <section className="space-y-1">
          <h4 className="text-xs font-medium text-rim-text">Permissions</h4>
          {plugin.capabilities.length > 0 ? (
            <ul className="space-y-0.5">
              {plugin.capabilities.map((cap) => (
                <li key={cap} className="flex items-center justify-between gap-3">
                  <span>{capabilityLabel(cap)}</span>
                  <span className={granted.has(cap) ? "text-rim-success" : "text-rim-text-faint"}>
                    {granted.has(cap) ? "Granted" : "Not granted"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>The plugin asks for no permissions.</p>
          )}
        </section>

        {origins.length > 0 && (
          <section className="space-y-1">
            <h4 className="text-xs font-medium text-rim-text">Sites it may reach</h4>
            <ul className="space-y-0.5">
              {origins.map((origin) => (
                <li key={origin} className="break-all font-mono">
                  {origin}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-1">
          <h4 className="text-xs font-medium text-rim-text">Commands</h4>
          {commands.length > 0 ? (
            <ul className="space-y-2">
              {commands.map((command) => (
                <li key={command.id}>
                  <p className="text-rim-text">
                    {command.title || command.id}
                    {command.dangerous && <span className="ml-2 text-rim-warm">Dangerous</span>}
                  </p>
                  {command.description && (
                    <p className="whitespace-pre-line break-words">{command.description}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>The plugin has no commands.</p>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/**
 * Where a plugin was installed from, in full.
 *
 * @param source - The plugin's install source, `null` or absent when the app did not install it.
 * @returns The git or link URL, the registry endpoint, or a phrase for a folder or no source.
 */
function sourceText(source: PluginInstallSource | null | undefined): string {
  switch (source?.kind) {
    case "git":
      return `Git repository ${source.url}`;
    case "link":
      return `Link ${source.url} (SHA-256 ${source.sha256})`;
    case "registry":
      return `Workspace registry at ${source.endpoint}`;
    case "local":
      return "A folder on this computer";
    default:
      return "Not installed by the app";
  }
}
