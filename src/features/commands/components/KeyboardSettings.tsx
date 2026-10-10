import { useRef, useState } from "react";
import { Download, Keyboard, Upload } from "lucide-react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { cn } from "../../../shared/ui/cn";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import {
  BUILT_IN_PROFILES,
  BUILT_IN_PROFILE_IDS,
  type BuiltInProfileId,
} from "../profiles/builtInProfiles";
import { parseKeybindProfile } from "../profiles/keybindProfile";
import {
  openProfileFileOnDesktop,
  readProfileFile,
  saveProfileFile,
} from "../profiles/profileFiles";
import { useCommandStore } from "../state/useCommandStore";
import { matchingBuiltIn, useKeybindProfileStore } from "../state/useKeybindProfileStore";

type Notice = { kind: "info"; text: string } | { kind: "errors"; title: string; lines: string[] };

/**
 * The Keyboard settings: the active keybind profile (one of the built-in ones or an imported
 * file), the Vim layer switch, exporting and importing a profile file, and the shortcuts panel.
 */
export function KeyboardSettings() {
  const { platform } = useRuntime();
  const profile = useKeybindProfileStore((s) => s.profile);
  const setProfile = useKeybindProfileStore((s) => s.setProfile);
  const selectBuiltIn = useKeybindProfileStore((s) => s.selectBuiltIn);
  const setVimMode = useKeybindProfileStore((s) => s.setVimMode);
  const openShortcuts = useCommandStore((s) => s.setShortcutsPanelOpen);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const builtIn = matchingBuiltIn(profile);

  function importText(text: string, source: string) {
    const parsed = parseKeybindProfile(text);
    if (!parsed.ok) {
      setNotice({ kind: "errors", title: `${source} was not imported:`, lines: parsed.errors });
      return;
    }
    setProfile(parsed.profile);
    const count = parsed.profile.bindings.length;
    setNotice({
      kind: "info",
      text: `Imported "${parsed.profile.name}": ${count} ${count === 1 ? "binding" : "bindings"}, Vim mode ${parsed.profile.vimMode ? "on" : "off"}.`,
    });
  }

  async function handleExport() {
    setBusy(true);
    setNotice(null);
    try {
      const where = await saveProfileFile(profile, platform);
      if (where) setNotice({ kind: "info", text: `Saved the profile as ${where}.` });
    } catch (error) {
      setNotice({
        kind: "errors",
        title: "The profile was not saved:",
        lines: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setNotice(null);
    if (platform !== "desktop") {
      fileInputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const text = await openProfileFileOnDesktop();
      if (text !== null) importText(text, "The file");
    } catch (error) {
      setNotice({
        kind: "errors",
        title: "The file could not be read:",
        lines: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      importText(await readProfileFile(file), file.name);
    } catch (error) {
      setNotice({
        kind: "errors",
        title: `${file.name} could not be read:`,
        lines: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Keyboard</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          A profile sets the default shortcuts of this device and whether Vim mode is on. Your own
          keybinds, set in Keybinds, still win over it.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-rim-text">Profile</legend>
        {BUILT_IN_PROFILE_IDS.map((id: BuiltInProfileId) => {
          const option = BUILT_IN_PROFILES[id];
          return (
            <label
              key={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3",
                builtIn === id ? "border-rim-accent/40 bg-rim-accent/5" : "border-rim-line",
              )}
            >
              <input
                type="radio"
                name="keybind-profile"
                value={id}
                checked={builtIn === id}
                onChange={() => {
                  selectBuiltIn(id);
                  setNotice(null);
                }}
                className="mt-1 accent-rim-accent"
              />
              <span>
                <span className="block text-sm text-rim-text">{option.name}</span>
                <span className="block text-xs text-rim-text-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
        {builtIn === null && (
          <p className="rounded-lg border border-rim-accent/40 bg-rim-accent/5 px-4 py-3 text-sm text-rim-text">
            Active: {profile.name}
            <span className="block text-xs text-rim-text-muted">
              An imported profile. Choosing one above replaces it.
            </span>
          </p>
        )}
      </fieldset>

      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-rim-text">Vim mode</p>
          <p className="mt-1 text-xs text-rim-text-muted">
            Normal mode: h and l move between panes, j and k through lists, gg and G to either end,
            / searches, : opens the command palette, i or Enter goes to the composer. Insert mode
            leaves typing alone; Esc or Ctrl+[ goes back. Keys inside a plugin are the plugin's.
          </p>
        </div>
        <ToggleSwitch checked={profile.vimMode} onChange={setVimMode} label="Vim mode" />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-rim-text">Profile file</p>
        <p className="text-xs text-rim-text-muted">
          Share the active profile as a JSON file, or use one someone shared with you.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text transition hover:border-rim-accent/40 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export profile
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text transition hover:border-rim-accent/40 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Import profile
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFilePicked}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="keybind-profile-file"
          />
        </div>
        {notice?.kind === "info" && (
          <p role="status" className="text-xs text-rim-success">
            {notice.text}
          </p>
        )}
        {notice?.kind === "errors" && (
          <div role="alert" className="text-xs text-rim-danger">
            <p>{notice.title}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {notice.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-rim-text">Shortcuts</p>
          <p className="mt-1 text-xs text-rim-text-muted">
            Every shortcut that works right now. Press ? or Ctrl+/ anywhere outside a text field.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openShortcuts(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text transition hover:border-rim-accent/40"
        >
          <Keyboard className="h-3.5 w-3.5" />
          Show shortcuts
        </button>
      </div>
    </div>
  );
}
