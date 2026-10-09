import { useState } from "react";
import { Link2 } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import {
  fetchLinkBundle,
  usePluginInstallFromLink,
  type FetchedLinkBundle,
} from "../api/usePluginActions";
import type { PluginInfo } from "../types";

interface InstallFromLinkProps {
  /** Installed plugins, to tell an update from a new install. */
  installed: readonly PluginInfo[];
  disabled?: boolean;
  /** Called with the plugin id once it is installed, so its permissions can be asked for. */
  onInstalled: (pluginId: string) => void;
}

/** What a bundle replacing an installed plugin changes, shown before it is installed. */
function changesOf(fetched: FetchedLinkBundle, current: PluginInfo) {
  const next = fetched.bundle.manifest;
  return {
    version: current.version === next.version ? null : `${current.version} → ${next.version}`,
    added: next.capabilities.filter((c) => !current.capabilities.includes(c)),
    removed: current.capabilities.filter((c) => !next.capabilities.includes(c)),
  };
}

/**
 * "Install from link": a pasted `https://…/name.rimbundle#sha256=…` link is
 * fetched without credentials, must hash to the value in the link, and goes
 * through manifest validation; then the permission prompt opens. A link for a
 * plugin already installed shows what changes and installs over it on a yes.
 */
export function InstallFromLink({ installed, disabled, onInstalled }: InstallFromLinkProps) {
  const install = usePluginInstallFromLink();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{
    fetched: FetchedLinkBundle;
    current: PluginInfo;
  } | null>(null);

  function reset() {
    setOpen(false);
    setLink("");
    setError(null);
    setReplacing(null);
  }

  function runInstall(fetched: FetchedLinkBundle, replace: boolean) {
    install.mutate(
      { fetched, replace },
      {
        onSuccess: (result) => {
          reset();
          onInstalled(result.plugin_id);
        },
        onError: (err) => {
          setReplacing(null);
          setError(err.message || "Install failed");
        },
      },
    );
  }

  async function handleFetch() {
    const trimmed = link.trim();
    if (!trimmed) return;
    setError(null);
    setFetching(true);
    try {
      const fetched = await fetchLinkBundle(trimmed);
      const current = installed.find((p) => p.plugin_id === fetched.bundle.manifest.plugin_id);
      if (current) setReplacing({ fetched, current });
      else runInstall(fetched, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  const busy = fetching || install.isPending;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
      >
        <Link2 className="mr-1.5 h-4 w-4" />
        Install from link
      </Button>

      {open && (
        <div className="basis-full space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://example.com/plugin.rimbundle#sha256=…"
              className="flex-1 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text placeholder:text-rim-text-faint focus:border-rim-accent focus:outline-none"
              aria-label="Plugin bundle link"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleFetch();
              }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleFetch()}
              disabled={!link.trim() || busy}
            >
              {busy ? "Installing..." : "Install"}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-rim-text-faint">
            The link must end with #sha256= and the bundle&apos;s hash. Plugins from links are not
            signed: install one only if you trust where the link came from.
          </p>
          {error && (
            <p className="text-xs text-rim-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {replacing && (
        <ReplaceDialog
          fetched={replacing.fetched}
          current={replacing.current}
          isPending={install.isPending}
          onConfirm={() => runInstall(replacing.fetched, true)}
          onCancel={() => setReplacing(null)}
        />
      )}
    </>
  );
}

function ReplaceDialog({
  fetched,
  current,
  isPending,
  onConfirm,
  onCancel,
}: {
  fetched: FetchedLinkBundle;
  current: PluginInfo;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const changes = changesOf(fetched, current);
  return (
    <Dialog open onClose={onCancel} title={`Replace ${current.display_name}?`} maxWidth="max-w-md">
      <div className="space-y-3 text-xs text-rim-text-muted">
        <p>
          This link installs another copy of {current.display_name} over the one installed. You
          approve its permissions again afterwards.
        </p>
        <ul className="space-y-1 text-rim-text">
          <li>Version: {changes.version ?? `${current.version} (unchanged)`}</li>
          {changes.added.length > 0 && <li>New permissions: {changes.added.join(", ")}</li>}
          {changes.removed.length > 0 && (
            <li>Permissions no longer asked for: {changes.removed.join(", ")}</li>
          )}
          {changes.added.length === 0 && changes.removed.length === 0 && (
            <li>Permissions: unchanged</li>
          )}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" isLoading={isPending} onClick={onConfirm}>
            Replace
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
