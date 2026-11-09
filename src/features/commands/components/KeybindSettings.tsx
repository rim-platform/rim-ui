import { Fragment, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Pencil,
  Plug,
  Plus,
  Search,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

import { errorSentence } from "../../../core/graphql/errors";
import { useResolvedKeybinds } from "../api/useKeybinds";
import {
  useCreateKeybindMutation,
  useUpdateKeybindMutation,
  useDeleteKeybindMutation,
} from "../api/useKeybindSettings";
import { useCommands } from "../api/useCommands";
import { useKeybindableCommands } from "../api/useKeybindableCommands";
import { usePluginCommands } from "../../plugins/api/usePluginCommands";
import { usePluginSuggestedKeybinds } from "../../plugins/api/usePluginKeybinds";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  bindsOnDevice,
  isDeviceKeybind,
  useDeviceKeybindStore,
} from "../state/useDeviceKeybindStore";
import { useActiveKeybindProfile } from "../state/useKeybindProfileStore";
import { cn } from "../../../shared/ui/cn";
import { Dialog } from "../../../shared/ui/Dialog";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { commandOfferedHere } from "../../agent/agentAvailability";
import { KEYBIND_CONTEXTS as CONTEXTS, KEYBIND_CONTEXT_LABELS } from "../profiles/keybindProfile";
import { listedKeybinds, slotHolders, unboundCommands } from "../runtime/effectiveKeybinds";
import { KEYSTROKE_RECORDER_ATTRIBUTE, parseKeystroke } from "../runtime/keybindEngine";
import { BUILT_IN_COMMAND_TITLES, withClientLabel } from "../runtime/localCommands";
import { NEEDS_ARGUMENTS_NOTE, takesPresetFields } from "../runtime/commandRunnable";
import {
  presetArgsOf,
  presetFields,
  presetFieldValues,
  presetWorkspace,
  readFields,
  type FieldValue,
  type FieldValues,
} from "../runtime/argumentValues";
import type { CommandDefinition, KeybindContext, ResolvedKeybind } from "../types";
import { PresetArgumentsSection } from "./ArgumentFields";

type CategoryKey = "navigation" | "chat" | "panels" | "agent" | "plugins" | "other";

interface Category {
  key: CategoryKey;
  label: string;
  match: (commandId: string) => boolean;
}

const CATEGORIES: Category[] = [
  {
    key: "navigation",
    label: "Navigation",
    match: (id) =>
      id.startsWith("workspace.open_") ||
      id.startsWith("workspace.navigate_") ||
      id.startsWith("workspace.switch_") ||
      id.startsWith("workspace.previous_") ||
      id.startsWith("workspace.next_") ||
      id.startsWith("workspace.cycle_"),
  },
  {
    key: "chat",
    label: "Chat",
    match: (id) => id.startsWith("chat."),
  },
  {
    key: "panels",
    label: "Panels",
    match: (id) =>
      id.startsWith("workspace.toggle_") ||
      id.startsWith("workspace.close_") ||
      id.startsWith("workspace.focus_") ||
      id.startsWith("workspace.reopen_"),
  },
  {
    key: "agent",
    label: "Agent",
    match: (id) => id === "workspace.open_agent",
  },
  {
    key: "plugins",
    label: "Plugins",
    match: (id) => id.startsWith("plugin."),
  },
  {
    key: "other",
    label: "Other",
    match: () => true, // fallback
  },
];

/** What an empty required argument of a keybind does. */
const ASKED_ON_PRESS = "asked for when the key is pressed";

/** The fields a keybind's saved arguments show in, with what each holds and why it cannot save. */
interface PresetDraft {
  /** The values, or `null` when the saved arguments do not fit the fields. */
  values: FieldValues | null;
  problems: Record<string, string>;
}

const NO_PRESET: PresetDraft = { values: {}, problems: {} };

/** The draft that shows `presetArgs` of a keybind to `command`. */
function presetDraftOf(command: CommandDefinition | undefined, presetArgs: unknown): PresetDraft {
  return command ? { values: presetFieldValues(command, presetArgs), problems: {} } : NO_PRESET;
}

/** `draft` with the field `name` holding `value`, and its problem cleared. */
function withFieldValue(draft: PresetDraft, name: string, value: FieldValue): PresetDraft {
  const problems = { ...draft.problems };
  delete problems[name];
  return { values: { ...(draft.values ?? {}), [name]: value }, problems };
}

/** Keys re-recorded on a listed binding that wait for the user to confirm taking them over. */
interface PendingRecord {
  keybindId: string;
  keystroke: string;
}

/**
 * Whether a keydown carries no Ctrl, Alt or Meta, so it is a plain key such as Tab or Escape.
 */
function noCommandModifier(event: React.KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * The note under keys another listed binding holds: who holds them and what saving does.
 *
 * @param holder - The first binding the save would displace; a workspace keybind cannot be.
 * @param title - The holder's command title.
 * @param keystroke - The recorded keys.
 * @param keepsOtherKeys - Whether the holder's command is still bound on other keys afterwards.
 */
function ConflictNote({
  holder,
  title,
  keystroke,
  keepsOtherKeys,
}: {
  holder: ResolvedKeybind;
  title: string;
  keystroke: string;
  keepsOtherKeys: boolean;
}) {
  if (holder.source === "WORKSPACE") {
    return (
      <p className="text-[11px] text-rim-danger">
        {keystroke} is used by {title}, a workspace keybind. Choose other keys.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-rim-warm">
      {keystroke} is used by {title}.{" "}
      {keepsOtherKeys
        ? `Saving moves it here; ${title} keeps its other keys.`
        : `Saving moves it here and leaves ${title} without a key.`}
    </p>
  );
}

function categorizeKeybind(commandId: string): CategoryKey {
  for (const cat of CATEGORIES) {
    if (cat.key !== "other" && cat.match(commandId)) return cat.key;
  }
  return "other";
}

export function KeybindSettings() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const { data: serverKeybinds, isLoading } = useResolvedKeybinds(workspaceId ?? undefined);
  // Keybinds to plugin commands are kept on this device (the server knows no plugin commands).
  const deviceKeybinds = useDeviceKeybindStore((s) => s.keybinds);
  const addDeviceKeybind = useDeviceKeybindStore((s) => s.add);
  const updateDeviceKeybind = useDeviceKeybindStore((s) => s.update);
  const removeDeviceKeybind = useDeviceKeybindStore((s) => s.remove);
  const profile = useActiveKeybindProfile();
  const keybinds = useMemo(
    () =>
      listedKeybinds(deviceKeybinds, serverKeybinds, profile).filter((kb) =>
        commandOfferedHere(kb.commandId),
      ),
    [deviceKeybinds, serverKeybinds, profile],
  );
  // PALETTE surface filters out commands with `visible_in_palette: false` (e.g.
  // `workspace.open_command_palette`), which causes their titles to fall back to
  // raw IDs in the keybind list. KEYBIND_PICKER surface returns all commands
  // that are keybind-capable regardless of palette visibility, so it is used
  // here exclusively to build the title lookup map.
  const { data: commands } = useCommands("KEYBIND_PICKER");
  const pluginCommands = usePluginCommands();
  const pluginSuggestions = usePluginSuggestedKeybinds();
  const createMutation = useCreateKeybindMutation();
  const updateMutation = useUpdateKeybindMutation();
  const deleteMutation = useDeleteKeybindMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [newKeystroke, setNewKeystroke] = useState("");
  const [newCommandId, setNewCommandId] = useState("");
  const [newContext, setNewContext] = useState<KeybindContext>("GLOBAL");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<CategoryKey>>(new Set());
  const [capturingKeybindId, setCapturingKeybindId] = useState<string | null>(null);
  const [editingKeybindId, setEditingKeybindId] = useState<string | null>(null);
  const [editCommandId, setEditCommandId] = useState("");
  const [editContext, setEditContext] = useState<KeybindContext>("GLOBAL");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null);
  const [reassignError, setReassignError] = useState<string | null>(null);
  // The keys the add form held when recording started, which Escape puts back.
  const recordStartRef = useRef("");
  const [newPreset, setNewPreset] = useState<PresetDraft>(NO_PRESET);
  const [editPreset, setEditPreset] = useState<PresetDraft>(NO_PRESET);

  const {
    builtIn: builtInKeybindable,
    device: deviceKeybindable,
    all: keybindableCommands,
    needsArguments,
  } = useKeybindableCommands();

  /** The server command `commandId` names when a keybind to it saves arguments in fields. */
  function presetCommand(commandId: string): CommandDefinition | undefined {
    const command = builtInKeybindable.find((cmd) => cmd.id === commandId);
    return command && takesPresetFields(command) ? command : undefined;
  }

  /**
   * The arguments a keybind to `commandId` saves from `draft`, or `null` after showing why a
   * field cannot be saved. `kept` is saved when the fields do not apply or cannot show it.
   */
  function presetArgsFrom(
    commandId: string,
    draft: PresetDraft,
    setDraft: (draft: PresetDraft) => void,
    kept: unknown,
    fieldsWorkspace: string | undefined,
  ): { presetArgs: unknown } | null {
    const command = presetCommand(commandId);
    if (!command || draft.values === null) return { presetArgs: kept ?? undefined };
    const read = readFields(presetFields(command), draft.values, false);
    if (!read.ok) {
      setDraft({ ...draft, problems: read.problems });
      return null;
    }
    return { presetArgs: presetArgsOf(command, read.args, fieldsWorkspace) };
  }

  // Build a lookup from command ID to title (built-in + plugin)
  const commandTitleMap = useMemo(() => {
    const map = new Map<string, string>(Object.entries(BUILT_IN_COMMAND_TITLES));
    if (commands) {
      for (const cmd of commands) {
        map.set(cmd.id, withClientLabel(cmd).title);
      }
    }
    for (const cmd of pluginCommands) {
      map.set(cmd.id, cmd.title);
    }
    return map;
  }, [commands, pluginCommands]);

  // Filter plugin suggestions to only those not already bound
  const unboundSuggestions = useMemo(() => {
    const boundCommands = new Set(keybinds.map((kb) => kb.commandId));
    return pluginSuggestions.filter((s) => !boundCommands.has(s.commandId));
  }, [pluginSuggestions, keybinds]);

  // Filter keybinds by search query
  const filteredKeybinds = useMemo(() => {
    if (!searchQuery.trim()) return keybinds;
    const q = searchQuery.toLowerCase();
    return keybinds.filter((kb) => {
      const title = commandTitleMap.get(kb.commandId) ?? kb.commandId;
      return (
        title.toLowerCase().includes(q) ||
        kb.keystroke.toLowerCase().includes(q) ||
        kb.commandId.toLowerCase().includes(q)
      );
    });
  }, [keybinds, searchQuery, commandTitleMap]);

  // Commands whose default keys a binding took, listed with no key
  const unbound = useMemo(
    () =>
      unboundCommands(deviceKeybinds, serverKeybinds, profile).filter((c) =>
        commandOfferedHere(c.commandId),
      ),
    [deviceKeybinds, serverKeybinds, profile],
  );
  const filteredUnbound = useMemo(() => {
    if (!searchQuery.trim()) return unbound;
    const q = searchQuery.toLowerCase();
    return unbound.filter((c) => {
      const title = commandTitleMap.get(c.commandId) ?? c.commandId;
      return title.toLowerCase().includes(q) || c.commandId.toLowerCase().includes(q);
    });
  }, [unbound, searchQuery, commandTitleMap]);

  // Group keybinds by category
  const categorizedKeybinds = useMemo(() => {
    const groups = new Map<CategoryKey, ResolvedKeybind[]>();
    for (const cat of CATEGORIES) {
      groups.set(cat.key, []);
    }
    for (const kb of filteredKeybinds) {
      const cat = categorizeKeybind(kb.commandId);
      groups.get(cat)!.push(kb);
    }
    return groups;
  }, [filteredKeybinds]);

  function toggleSection(key: CategoryKey) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function resetCreateForm() {
    setShowCreate(false);
    setNewKeystroke("");
    setNewCommandId("");
    setNewContext("GLOBAL");
    setNewPreset(NO_PRESET);
    setReassignError(null);
  }

  /**
   * The listed bindings that saving `commandId` on `keystroke` in `context` displaces. A default
   * of the same command is left out: overriding it replaces it on purpose.
   *
   * @param exceptId - The binding being re-recorded, which does not displace itself.
   */
  function conflictsFor(
    context: KeybindContext,
    keystroke: string,
    commandId: string,
    exceptId?: string,
  ): ResolvedKeybind[] {
    if (!keystroke) return [];
    return slotHolders(keybinds, context, keystroke, exceptId).filter(
      (kb) => !(kb.source === "DEFAULT" && kb.commandId === commandId),
    );
  }

  /** The note under the recorded `keystroke` that `conflicts` hold, naming the binding that matters most. */
  function conflictNote(conflicts: ResolvedKeybind[], keystroke: string) {
    const holder = conflicts.find((kb) => kb.source === "WORKSPACE") ?? conflicts[0];
    if (!holder) return null;
    const keepsOtherKeys = keybinds.some(
      (kb) => kb.commandId === holder.commandId && !conflicts.some((c) => c.id === kb.id),
    );
    return (
      <ConflictNote
        holder={holder}
        title={commandTitleMap.get(holder.commandId) ?? holder.commandId}
        keystroke={keystroke}
        keepsOtherKeys={keepsOtherKeys}
      />
    );
  }

  /**
   * Frees the keys `conflicts` hold, then runs `save`: a device binding is removed from this
   * device, a binding of the user's is deleted on the server first, and a default needs nothing
   * because the new binding takes its place. Runs `save` at once when nothing is deleted on the
   * server; on a failed delete it saves nothing and shows why.
   */
  function reassign(conflicts: ResolvedKeybind[], save: () => void) {
    setReassignError(null);
    const onDevice = conflicts.filter((kb) => isDeviceKeybind(kb.id));
    const onServer = conflicts.filter((kb) => !isDeviceKeybind(kb.id) && kb.source === "USER");
    const finish = () => {
      for (const kb of onDevice) removeDeviceKeybind(kb.id);
      save();
    };
    if (onServer.length === 0) {
      finish();
      return;
    }
    void (async () => {
      try {
        for (const kb of onServer) await deleteMutation.mutateAsync({ keybindId: kb.id });
      } catch (err) {
        setReassignError(graphqlErrorMessage(err, "The other keybind could not be removed."));
        return;
      }
      finish();
    })();
  }

  /**
   * Opens the add form prefilled with `keystroke`, `commandId` and `context`: an override of a
   * default's keys, or, with no keys, the first keys of a command left without any.
   */
  function openCreateForm(keystroke: string, commandId: string, context: KeybindContext) {
    setNewKeystroke(keystroke);
    setNewCommandId(commandId);
    setNewPreset(presetDraftOf(presetCommand(commandId), undefined));
    setNewContext(context);
    setShowCreate(true);
  }

  function handleCreate() {
    if (!newKeystroke || !newCommandId || workspaceConflict) return;
    const preset = presetArgsFrom(
      newCommandId,
      newPreset,
      setNewPreset,
      undefined,
      workspaceId ?? undefined,
    );
    if (!preset) return;
    reassign(createConflicts, () => {
      if (bindsOnDevice(newCommandId)) {
        addDeviceKeybind({ keystroke: newKeystroke, commandId: newCommandId, context: newContext });
        resetCreateForm();
        return;
      }
      createMutation.mutate(
        {
          scope: "USER",
          keystroke: newKeystroke,
          commandId: newCommandId,
          context: newContext,
          ...(preset.presetArgs !== undefined && { presetArgs: preset.presetArgs }),
        },
        { onSuccess: resetCreateForm },
      );
    });
  }

  function handleToggle(keybind: ResolvedKeybind) {
    if (isDeviceKeybind(keybind.id)) {
      updateDeviceKeybind(keybind.id, { isEnabled: !keybind.isEnabled });
      return;
    }
    updateMutation.mutate({
      keybindId: keybind.id,
      keystroke: keybind.keystroke,
      commandId: keybind.commandId,
      context: keybind.context,
      presetArgs: keybind.presetArgs ?? undefined,
      isEnabled: !keybind.isEnabled,
    });
  }

  function handleDelete(keybindId: string) {
    setPendingDeleteId(keybindId);
  }

  function confirmDelete() {
    if (pendingDeleteId && isDeviceKeybind(pendingDeleteId)) {
      removeDeviceKeybind(pendingDeleteId);
      setPendingDeleteId(null);
    } else if (pendingDeleteId) {
      deleteMutation.mutate({ keybindId: pendingDeleteId });
      setPendingDeleteId(null);
    }
  }

  function handleKeystrokeCapture(event: React.KeyboardEvent<HTMLInputElement>) {
    // Tab still moves on, so the form stays usable without a mouse.
    if (event.key === "Tab" && noCommandModifier(event)) return;
    event.preventDefault();
    event.stopPropagation();
    // Escape alone stops recording and puts back the keys the field held before.
    if (event.key === "Escape" && noCommandModifier(event) && !event.shiftKey) {
      setNewKeystroke(recordStartRef.current);
      event.currentTarget.blur();
      return;
    }
    const keystroke = parseKeystroke(event);
    if (keystroke) setNewKeystroke(keystroke);
  }

  /** Saves keys re-recorded on a listed binding, on this device or on the server. */
  function saveRecorded(kb: ResolvedKeybind, keystroke: string) {
    if (isDeviceKeybind(kb.id)) {
      updateDeviceKeybind(kb.id, { keystroke });
      return;
    }
    updateMutation.mutate({
      keybindId: kb.id,
      keystroke,
      commandId: kb.commandId,
      context: kb.context,
      presetArgs: kb.presetArgs ?? undefined,
      isEnabled: kb.isEnabled,
    });
  }

  /** Saves the pending re-recorded keys of `kb` after freeing them. */
  function confirmPendingRecord(kb: ResolvedKeybind, keystroke: string) {
    reassign(conflictsFor(kb.context, keystroke, kb.commandId, kb.id), () => {
      setPendingRecord(null);
      saveRecorded(kb, keystroke);
    });
  }

  function handleInlineKeystrokeCapture(kb: ResolvedKeybind, event: React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setCapturingKeybindId(null);
      return;
    }

    const keystroke = parseKeystroke(event);
    if (!keystroke) return;

    setCapturingKeybindId(null);
    // Keys another binding holds wait under the row until the user confirms taking them.
    if (conflictsFor(kb.context, keystroke, kb.commandId, kb.id).length > 0) {
      setReassignError(null);
      setPendingRecord({ keybindId: kb.id, keystroke });
      return;
    }
    saveRecorded(kb, keystroke);
  }

  /** The confirmation under a row whose re-recorded keys another binding holds. */
  function pendingRecordNote(kb: ResolvedKeybind) {
    if (pendingRecord?.keybindId !== kb.id) return null;
    const conflicts = conflictsFor(kb.context, pendingRecord.keystroke, kb.commandId, kb.id);
    const blocked = conflicts.some((holder) => holder.source === "WORKSPACE");
    return (
      <div className="space-y-1 rounded-md border border-rim-line bg-rim-void px-2 py-1.5">
        <p className="text-[11px] text-rim-text-muted">
          New keys: <kbd className="font-mono">{pendingRecord.keystroke}</kbd>
        </p>
        {conflictNote(conflicts, pendingRecord.keystroke)}
        <div className="flex gap-2">
          <button
            onClick={() => confirmPendingRecord(kb, pendingRecord.keystroke)}
            disabled={blocked || updateMutation.isPending}
            className="rounded bg-rim-text px-2 py-0.5 text-[11px] font-medium text-rim-panel hover:bg-rim-text/90 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => {
              setPendingRecord(null);
              setReassignError(null);
            }}
            className="rounded px-2 py-0.5 text-[11px] text-rim-text-muted hover:text-rim-text"
          >
            Cancel
          </button>
        </div>
        {reassignError && <p className="text-[11px] text-rim-danger">{reassignError}</p>}
      </div>
    );
  }

  function startEditing(kb: ResolvedKeybind) {
    setEditingKeybindId(kb.id);
    setEditCommandId(kb.commandId);
    setEditContext(kb.context);
    setEditPreset(presetDraftOf(presetCommand(kb.commandId), kb.presetArgs));
  }

  function cancelEditing() {
    setEditingKeybindId(null);
    setEditCommandId("");
    setEditContext("GLOBAL");
    setEditPreset(NO_PRESET);
  }

  /** Picks the command of the binding being edited; its saved arguments stay with its own. */
  function changeEditCommand(kb: ResolvedKeybind, commandId: string) {
    setEditCommandId(commandId);
    setEditPreset(
      presetDraftOf(
        presetCommand(commandId),
        commandId === kb.commandId ? kb.presetArgs : undefined,
      ),
    );
  }

  /** The workspace whose members and conversations the fields of `kb`'s arguments offer. */
  function editWorkspace(kb: ResolvedKeybind): string | undefined {
    const command = presetCommand(kb.commandId);
    return (command && presetWorkspace(command, kb.presetArgs)) ?? workspaceId ?? undefined;
  }

  function handleSaveEdit(kb: ResolvedKeybind) {
    if (!editCommandId) return;
    if (isDeviceKeybind(kb.id)) {
      updateDeviceKeybind(kb.id, { commandId: editCommandId, context: editContext });
      cancelEditing();
      return;
    }
    const preset = presetArgsFrom(
      editCommandId,
      editPreset,
      setEditPreset,
      editCommandId === kb.commandId ? kb.presetArgs : undefined,
      editCommandId === kb.commandId ? editWorkspace(kb) : (workspaceId ?? undefined),
    );
    if (!preset) return;
    updateMutation.mutate(
      {
        keybindId: kb.id,
        keystroke: kb.keystroke,
        commandId: editCommandId,
        context: editContext,
        presetArgs: preset.presetArgs,
        isEnabled: kb.isEnabled,
      },
      {
        onSuccess: () => cancelEditing(),
      },
    );
  }

  const createConflicts = conflictsFor(newContext, newKeystroke, newCommandId);
  const workspaceConflict = createConflicts.some((kb) => kb.source === "WORKSPACE");

  if (isLoading) {
    return <div className="p-4 text-sm text-rim-text-muted">Loading keybinds...</div>;
  }

  return (
    <div className="p-3">
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rim-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search keybinds..."
          className="w-full rounded-lg border border-rim-line bg-rim-void pl-8 pr-3 py-1.5 text-xs text-rim-text outline-none transition placeholder:text-rim-text-muted focus:border-rim-accent/40"
        />
      </div>

      {/* Add button */}
      <button
        className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted hover:text-rim-text transition-colors"
        onClick={() => setShowCreate(!showCreate)}
        aria-label="Add keybind"
      >
        <Plus className="h-3.5 w-3.5" />
        Add keybind
      </button>

      {/* Create form */}
      {showCreate && (
        <div className="mb-3 rounded-md border border-rim-line bg-rim-void p-3 space-y-2">
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">Keystroke</label>
            <input
              type="text"
              value={newKeystroke}
              onKeyDown={handleKeystrokeCapture}
              onFocus={() => (recordStartRef.current = newKeystroke)}
              onChange={() => {}}
              placeholder="Press a key combination..."
              aria-label="Keystroke"
              {...{ [KEYSTROKE_RECORDER_ATTRIBUTE]: "" }}
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
              readOnly
            />
            {conflictNote(createConflicts, newKeystroke)}
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">Command</label>
            <select
              aria-label="Command"
              value={newCommandId}
              onChange={(e) => {
                setNewCommandId(e.target.value);
                setNewPreset(presetDraftOf(presetCommand(e.target.value), undefined));
              }}
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
            >
              <option value="">Select command...</option>
              {newCommandId && !keybindableCommands.some((cmd) => cmd.id === newCommandId) && (
                <option value={newCommandId}>
                  {commandTitleMap.get(newCommandId) ?? newCommandId}
                </option>
              )}
              {keybindableCommands.map((cmd) => (
                <option key={cmd.id} value={cmd.id}>
                  {cmd.title}
                </option>
              ))}
            </select>
          </div>
          {presetCommand(newCommandId) && (
            <PresetArgumentsSection
              fields={presetFields(presetCommand(newCommandId)!)}
              values={newPreset.values}
              onChange={(name, value) => setNewPreset(withFieldValue(newPreset, name, value))}
              problems={newPreset.problems}
              workspaceId={workspaceId ?? undefined}
              emptyNote={ASKED_ON_PRESS}
              size="xs"
            />
          )}
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">Context</label>
            <select
              aria-label="Context"
              value={newContext}
              onChange={(e) => setNewContext(e.target.value as KeybindContext)}
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
            >
              {CONTEXTS.map((ctx) => (
                <option key={ctx} value={ctx}>
                  {KEYBIND_CONTEXT_LABELS[ctx]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={
                !newKeystroke || !newCommandId || workspaceConflict || createMutation.isPending
              }
              className="flex-1 rounded bg-rim-text px-2 py-1 text-xs font-medium text-rim-panel hover:bg-rim-text/90 disabled:opacity-50"
            >
              {createMutation.isPending ? "Saving..." : "Save"}
            </button>
            <button
              onClick={resetCreateForm}
              className="rounded px-2 py-1 text-xs text-rim-text-muted hover:text-rim-text"
            >
              Cancel
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-[11px] text-rim-danger">
              {errorSentence(createMutation.error, "The keybind could not be created.")}
            </p>
          )}
          {reassignError && <p className="text-[11px] text-rim-danger">{reassignError}</p>}
        </div>
      )}

      {/* Categorized keybind sections */}
      {CATEGORIES.map((cat) => {
        const items = categorizedKeybinds.get(cat.key) ?? [];
        const unboundItems = filteredUnbound.filter(
          (c) => categorizeKeybind(c.commandId) === cat.key,
        );
        if (items.length + unboundItems.length === 0) return null;
        const isCollapsed = collapsedSections.has(cat.key);

        return (
          <div key={cat.key} className="border-b border-rim-line pb-2 mb-2">
            <button
              type="button"
              onClick={() => toggleSection(cat.key)}
              className="flex w-full items-center gap-1.5 py-1.5 text-xs font-medium uppercase tracking-wider text-rim-text-muted hover:text-rim-text transition-colors"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  !isCollapsed && "rotate-90",
                )}
              />
              <span>{cat.label}</span>
              <span className="text-rim-text-faint">({items.length + unboundItems.length})</span>
            </button>

            {!isCollapsed && (
              <div className="space-y-1 mt-1">
                {items.map((kb) => {
                  const isEditing = editingKeybindId === kb.id;

                  if (isEditing) {
                    return (
                      <div
                        key={kb.id}
                        className="rounded-md border border-rim-accent/30 bg-rim-void px-2 py-2 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <kbd
                            ref={(el) => {
                              if (capturingKeybindId === kb.id && el) el.focus();
                            }}
                            tabIndex={0}
                            role="button"
                            {...(capturingKeybindId === kb.id && {
                              [KEYSTROKE_RECORDER_ATTRIBUTE]: "",
                            })}
                            onClick={() => setCapturingKeybindId(kb.id)}
                            onKeyDown={(e) => {
                              if (capturingKeybindId === kb.id) {
                                handleInlineKeystrokeCapture(kb, e);
                              } else if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setCapturingKeybindId(kb.id);
                              }
                            }}
                            onBlur={() => {
                              if (capturingKeybindId === kb.id) setCapturingKeybindId(null);
                            }}
                            className={cn(
                              "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] cursor-pointer transition",
                              capturingKeybindId === kb.id
                                ? "border-rim-accent bg-rim-void text-rim-accent outline outline-1 outline-rim-accent"
                                : "border-rim-line bg-rim-void hover:border-rim-accent/40",
                            )}
                          >
                            {capturingKeybindId === kb.id ? "Press a key..." : kb.keystroke}
                          </kbd>
                        </div>
                        {pendingRecordNote(kb)}
                        <div>
                          <label className="block text-[11px] text-rim-text-muted mb-1">
                            Command
                          </label>
                          <select
                            aria-label="Command"
                            value={editCommandId}
                            onChange={(e) => changeEditCommand(kb, e.target.value)}
                            className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
                          >
                            <option value="">Select command...</option>
                            {editCommandId &&
                              !(
                                isDeviceKeybind(kb.id) ? deviceKeybindable : builtInKeybindable
                              ).some((cmd) => cmd.id === editCommandId) && (
                                <option value={editCommandId}>
                                  {commandTitleMap.get(editCommandId) ?? editCommandId}
                                </option>
                              )}
                            {/* A device keybind stays a device command; a server one a built-in. */}
                            {(isDeviceKeybind(kb.id) ? deviceKeybindable : builtInKeybindable).map(
                              (cmd) => (
                                <option key={cmd.id} value={cmd.id}>
                                  {cmd.title}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        {!isDeviceKeybind(kb.id) && presetCommand(editCommandId) && (
                          <PresetArgumentsSection
                            fields={presetFields(presetCommand(editCommandId)!)}
                            values={editPreset.values}
                            saved={kb.presetArgs}
                            onChange={(name, value) =>
                              setEditPreset(withFieldValue(editPreset, name, value))
                            }
                            problems={editPreset.problems}
                            workspaceId={
                              editCommandId === kb.commandId
                                ? editWorkspace(kb)
                                : (workspaceId ?? undefined)
                            }
                            emptyNote={ASKED_ON_PRESS}
                            size="xs"
                          />
                        )}
                        <div>
                          <label className="block text-[11px] text-rim-text-muted mb-1">
                            Context
                          </label>
                          <select
                            aria-label="Context"
                            value={editContext}
                            onChange={(e) => setEditContext(e.target.value as KeybindContext)}
                            className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
                          >
                            {CONTEXTS.map((ctx) => (
                              <option key={ctx} value={ctx}>
                                {KEYBIND_CONTEXT_LABELS[ctx]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleSaveEdit(kb)}
                            disabled={!editCommandId || updateMutation.isPending}
                            className="flex-1 rounded bg-rim-text px-2 py-1 text-xs font-medium text-rim-panel hover:bg-rim-text/90 disabled:opacity-50"
                          >
                            {updateMutation.isPending ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="rounded px-2 py-1 text-xs text-rim-text-muted hover:text-rim-text"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // The server makes up a default row's id on every resolve, so a default
                  // cannot be updated: it is shown read-only, with an override instead.
                  if (kb.source === "DEFAULT") {
                    const title = commandTitleMap.get(kb.commandId) ?? kb.commandId;
                    return (
                      <div
                        key={kb.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-rim-text"
                      >
                        <kbd className="shrink-0 rounded border border-rim-line bg-rim-void px-1.5 py-0.5 font-mono text-[11px]">
                          {kb.keystroke}
                        </kbd>
                        <span className="flex-1 truncate">{title}</span>
                        {needsArguments(kb.commandId, kb.presetArgs) && (
                          <span className="shrink-0 text-[10px] text-rim-text-muted">
                            {NEEDS_ARGUMENTS_NOTE}
                          </span>
                        )}
                        <span
                          className="shrink-0 rounded border border-rim-line px-1 text-[10px] text-rim-text-faint"
                          title="A default binding. A binding of yours on the same keys and context takes its place."
                        >
                          Default
                        </span>
                        <span className="shrink-0 text-[10px] text-rim-text-muted">
                          {KEYBIND_CONTEXT_LABELS[kb.context]}
                        </span>
                        <button
                          onClick={() => openCreateForm(kb.keystroke, kb.commandId, kb.context)}
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-rim-accent transition hover:bg-rim-accent/10"
                          title="Make a binding of your own on these keys"
                          aria-label={`Override ${kb.keystroke} ${title}`}
                        >
                          Override
                        </button>
                      </div>
                    );
                  }

                  return (
                    <Fragment key={kb.id}>
                      <div
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                          kb.isEnabled ? "text-rim-text" : "text-rim-text-muted opacity-60",
                        )}
                      >
                        <kbd
                          ref={(el) => {
                            if (capturingKeybindId === kb.id && el) el.focus();
                          }}
                          tabIndex={0}
                          role="button"
                          {...(capturingKeybindId === kb.id && {
                            [KEYSTROKE_RECORDER_ATTRIBUTE]: "",
                          })}
                          onClick={() => setCapturingKeybindId(kb.id)}
                          onKeyDown={(e) => {
                            if (capturingKeybindId === kb.id) {
                              handleInlineKeystrokeCapture(kb, e);
                            } else if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setCapturingKeybindId(kb.id);
                            }
                          }}
                          onBlur={() => {
                            if (capturingKeybindId === kb.id) setCapturingKeybindId(null);
                          }}
                          className={cn(
                            "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] cursor-pointer transition",
                            capturingKeybindId === kb.id
                              ? "border-rim-accent bg-rim-void text-rim-accent outline outline-1 outline-rim-accent"
                              : "border-rim-line bg-rim-void hover:border-rim-accent/40",
                          )}
                        >
                          {capturingKeybindId === kb.id ? "Press a key..." : kb.keystroke}
                        </kbd>
                        {kb.commandId.startsWith("plugin.") && (
                          <Plug className="h-3 w-3 shrink-0 text-rim-accent" />
                        )}
                        <span className="flex-1 truncate">
                          {commandTitleMap.get(kb.commandId) ?? kb.commandId}
                        </span>
                        {needsArguments(kb.commandId, kb.presetArgs) && (
                          <span className="shrink-0 text-[10px] text-rim-text-muted">
                            {NEEDS_ARGUMENTS_NOTE}
                          </span>
                        )}
                        {isDeviceKeybind(kb.id) && (
                          <span
                            className="shrink-0 rounded border border-rim-line px-1 text-[10px] text-rim-text-faint"
                            title="Kept on this device, like the plugin it runs"
                          >
                            This device
                          </span>
                        )}
                        <span className="shrink-0 text-[10px] text-rim-text-muted">
                          {KEYBIND_CONTEXT_LABELS[kb.context]}
                        </span>
                        <button
                          onClick={() => startEditing(kb)}
                          className="shrink-0 text-rim-text-muted hover:text-rim-text"
                          title="Edit"
                          aria-label="Edit keybind"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggle(kb)}
                          className="shrink-0 text-rim-text-muted hover:text-rim-text"
                          title={kb.isEnabled ? "Disable" : "Enable"}
                          aria-label={kb.isEnabled ? "Disable keybind" : "Enable keybind"}
                        >
                          {kb.isEnabled ? (
                            <ToggleRight className="h-4 w-4 text-rim-accent" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(kb.id)}
                          className="shrink-0 text-rim-text-muted hover:text-rim-danger"
                          title="Delete"
                          aria-label="Delete keybind"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {pendingRecordNote(kb)}
                    </Fragment>
                  );
                })}
                {unboundItems.map((c) => {
                  const title = commandTitleMap.get(c.commandId) ?? c.commandId;
                  return (
                    <div
                      key={`unbound-${c.commandId}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-rim-text-muted"
                    >
                      <kbd className="shrink-0 rounded border border-dashed border-rim-line px-1.5 py-0.5 font-mono text-[11px] text-rim-text-faint">
                        No key
                      </kbd>
                      <span className="flex-1 truncate">{title}</span>
                      <span className="shrink-0 text-[10px] text-rim-text-muted">
                        {KEYBIND_CONTEXT_LABELS[c.context]}
                      </span>
                      <button
                        onClick={() => openCreateForm("", c.commandId, c.context)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-rim-accent transition hover:bg-rim-accent/10"
                        title="Give this command keys of its own"
                        aria-label={`Set a key for ${title}`}
                      >
                        Set key
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {filteredKeybinds.length + filteredUnbound.length === 0 && (
        <p className="text-xs text-rim-text-muted py-4 text-center">
          {searchQuery ? "No keybinds match your search." : "No keybinds configured."}
        </p>
      )}

      {/* Plugin suggested keybinds */}
      {!searchQuery && unboundSuggestions.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-rim-text-muted">
            <Plug className="h-3 w-3" />
            Plugin Suggestions
          </h3>
          <div className="space-y-1">
            {unboundSuggestions.map((suggestion) => (
              <div
                key={suggestion.commandId}
                className="flex items-center gap-2 rounded-md bg-rim-void/50 px-2 py-1.5 text-xs"
              >
                <Plug className="h-3 w-3 shrink-0 text-rim-accent" />
                <kbd className="shrink-0 rounded border border-rim-line bg-rim-void px-1.5 py-0.5 font-mono text-[11px] text-rim-text-muted">
                  {suggestion.keystroke}
                </kbd>
                <span className="flex-1 truncate text-rim-text">{suggestion.commandTitle}</span>
                <span className="shrink-0 text-[10px] text-rim-text-muted">
                  {suggestion.pluginName}
                </span>
                <button
                  onClick={() => {
                    addDeviceKeybind({
                      keystroke: suggestion.keystroke,
                      commandId: suggestion.commandId,
                      context: suggestion.context,
                    });
                  }}
                  className="shrink-0 rounded bg-rim-accent/10 px-2 py-0.5 text-[10px] font-medium text-rim-accent transition hover:bg-rim-accent/20 disabled:opacity-50"
                  title="Assign this keybind"
                  aria-label={`Assign ${suggestion.keystroke} to ${suggestion.commandTitle}`}
                >
                  Assign
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Delete confirmation dialog */}
      <Dialog
        open={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        title="Delete keybind?"
      >
        <p className="text-xs text-rim-text-muted mb-4">
          This keybind will be removed. You can always create a new one later.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setPendingDeleteId(null)}
            className="rounded-md px-3 py-1.5 text-xs text-rim-text-muted hover:text-rim-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            className="rounded-md bg-rim-danger-solid px-3 py-1.5 text-xs font-medium text-white hover:bg-rim-danger-solid/90 transition-colors"
          >
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}
