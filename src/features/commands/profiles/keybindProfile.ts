import type { KeybindContext, ResolvedKeybind } from "../types";

/** The `format` field every keybind profile file carries. */
export const PROFILE_FORMAT = "rim.keybind-profile";

/** The profile schema version this app reads and writes. */
export const PROFILE_VERSION = 1;

export const KEYBIND_CONTEXTS: readonly KeybindContext[] = [
  "GLOBAL",
  "COMPOSER",
  "MESSAGE_LIST",
  "THREAD_VIEW",
  "CONVERSATION_VIEW",
  "PANEL",
  "COMMAND_PALETTE",
];

/** The name Settings shows for each keybind context. */
export const KEYBIND_CONTEXT_LABELS: Readonly<Record<KeybindContext, string>> = {
  GLOBAL: "Global",
  COMPOSER: "Composer",
  MESSAGE_LIST: "Message list",
  THREAD_VIEW: "Thread view",
  CONVERSATION_VIEW: "Conversation view",
  PANEL: "Panel",
  COMMAND_PALETTE: "Command palette",
};

/**
 * One default binding of a profile. A `null` command frees the keystroke: nothing below the
 * profile (the server's defaults) binds it either.
 */
export interface ProfileBinding {
  keystroke: string;
  commandId: string | null;
  context: KeybindContext;
}

/**
 * A keybind profile: the default bindings of this device and whether the Vim layer is on. The
 * user's own bindings on the server, and plugin bindings on this device, still win over it.
 */
export interface KeybindProfile {
  format: typeof PROFILE_FORMAT;
  version: typeof PROFILE_VERSION;
  name: string;
  description: string;
  vimMode: boolean;
  bindings: ProfileBinding[];
}

export type ProfileParseResult =
  { ok: true; profile: KeybindProfile } | { ok: false; errors: string[] };

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BINDINGS = 500;
const MAX_KEYSTROKE_LENGTH = 64;
const MAX_COMMAND_ID_LENGTH = 200;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt"] as const;

/** Modifier names a profile may use, in any case, and the modifier each one means. */
const MODIFIER_NAMES: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  meta: "Ctrl",
  cmd: "Ctrl",
  shift: "Shift",
  alt: "Alt",
};

/** Key names that mean the same key, mapped to the name `KeyboardEvent.key` uses. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  Esc: "Escape",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Del: "Delete",
  Return: "Enter",
};

/**
 * The keystroke in the form the keybind engine compares: modifiers in Ctrl, Shift, Alt order,
 * Meta as Ctrl, a letter in upper case, and no Shift for a character that implies it.
 */
export function canonicalKeystroke(
  keystroke: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = keystroke.trim();
  if (!trimmed) return { ok: false, error: "is empty" };
  if (trimmed.length > MAX_KEYSTROKE_LENGTH) {
    return { ok: false, error: `is longer than ${MAX_KEYSTROKE_LENGTH} characters` };
  }
  const cut = trimmed.endsWith("++") ? trimmed.length - 1 : trimmed.lastIndexOf("+") + 1;
  let key = trimmed.slice(cut);
  if (!key) return { ok: false, error: `"${trimmed}" does not end with a key` };
  if (/\s/.test(key)) return { ok: false, error: `"${key}" is not a key name` };
  const modifiers = new Set<string>();
  for (const raw of trimmed.slice(0, cut).split("+").filter(Boolean)) {
    const modifier = MODIFIER_NAMES[raw.toLowerCase()];
    if (modifier === undefined) {
      return { ok: false, error: `"${raw}" is not a modifier (use Ctrl, Shift, Alt or Meta)` };
    }
    modifiers.add(modifier);
  }
  key = KEY_ALIASES[key] ?? key;
  if (key === " ") key = "Space";
  if (key.length === 1) {
    if (key.toLowerCase() === key.toUpperCase()) modifiers.delete("Shift");
    key = key.toUpperCase();
  }
  return {
    ok: true,
    value: [...MODIFIER_ORDER.filter((m) => modifiers.has(m)), key].join("+"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check a parsed JSON value against the profile schema, collecting every problem found. */
export function validateKeybindProfile(value: unknown): ProfileParseResult {
  if (!isRecord(value)) {
    return { ok: false, errors: ["The file is not a keybind profile: it is not a JSON object."] };
  }
  if (value.format !== PROFILE_FORMAT) {
    return {
      ok: false,
      errors: [`The file is not a keybind profile: "format" must be "${PROFILE_FORMAT}".`],
    };
  }
  if (value.version !== PROFILE_VERSION) {
    const newer = typeof value.version === "number" && value.version > PROFILE_VERSION;
    return {
      ok: false,
      errors: [
        newer
          ? `The profile is version ${String(value.version)}, made by a newer RIM. This app reads version ${PROFILE_VERSION}.`
          : `"version" must be ${PROFILE_VERSION}.`,
      ],
    };
  }

  const errors: string[] = [];
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) errors.push('"name" must be a non-empty text.');
  else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`"name" is longer than ${MAX_NAME_LENGTH} characters.`);
  }
  let description = "";
  if (value.description !== undefined) {
    if (typeof value.description !== "string") errors.push('"description" must be text.');
    else if (value.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`"description" is longer than ${MAX_DESCRIPTION_LENGTH} characters.`);
    } else description = value.description;
  }
  if (typeof value.vimMode !== "boolean") errors.push('"vimMode" must be true or false.');

  const bindings: ProfileBinding[] = [];
  if (!Array.isArray(value.bindings)) {
    errors.push('"bindings" must be a list.');
  } else if (value.bindings.length > MAX_BINDINGS) {
    errors.push(`"bindings" has more than ${MAX_BINDINGS} entries.`);
  } else {
    const seen = new Map<string, number>();
    value.bindings.forEach((entry: unknown, index) => {
      const at = `bindings[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${at} must be an object.`);
        return;
      }
      const context = entry.context === undefined ? "GLOBAL" : entry.context;
      if (!KEYBIND_CONTEXTS.includes(context as KeybindContext)) {
        errors.push(`${at}.context must be one of ${KEYBIND_CONTEXTS.join(", ")}.`);
        return;
      }
      if (typeof entry.keystroke !== "string") {
        errors.push(`${at}.keystroke must be text, such as "Ctrl+K".`);
        return;
      }
      const keystroke = canonicalKeystroke(entry.keystroke);
      if (!keystroke.ok) {
        errors.push(`${at}.keystroke ${keystroke.error}.`);
        return;
      }
      const commandId = entry.commandId;
      if (commandId !== null) {
        if (typeof commandId !== "string" || !COMMAND_ID_PATTERN.test(commandId)) {
          errors.push(`${at}.commandId must be a command id, such as "workspace.open_settings".`);
          return;
        }
        if (commandId.length > MAX_COMMAND_ID_LENGTH) {
          errors.push(`${at}.commandId is longer than ${MAX_COMMAND_ID_LENGTH} characters.`);
          return;
        }
      }
      const slot = `${context} ${keystroke.value}`;
      const earlier = seen.get(slot);
      if (earlier !== undefined) {
        errors.push(`${at} binds ${keystroke.value} again; bindings[${earlier}] already does.`);
        return;
      }
      seen.set(slot, index);
      bindings.push({
        keystroke: keystroke.value,
        commandId: commandId as string | null,
        context: context as KeybindContext,
      });
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      format: PROFILE_FORMAT,
      version: PROFILE_VERSION,
      name,
      description,
      vimMode: value.vimMode as boolean,
      bindings,
    },
  };
}

/** Parse the text of a profile file. */
export function parseKeybindProfile(text: string): ProfileParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`The file is not valid JSON: ${detail}`] };
  }
  return validateKeybindProfile(value);
}

/** The text of a profile file. */
export function serializeKeybindProfile(profile: KeybindProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** A file name for the profile, such as `rim-keybinds-vim.json`. */
export function profileFileName(profile: KeybindProfile): string {
  const slug = profile.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `rim-keybinds-${slug || "profile"}.json`;
}

/** Id prefix of the keybinds a profile contributes. */
export const PROFILE_KEYBIND_PREFIX = "profile:";

/**
 * The profile's bindings as keybinds. A freed keystroke becomes a disabled keybind with no
 * command, which hides the same keystroke in the layers below.
 */
export function profileKeybinds(profile: KeybindProfile): ResolvedKeybind[] {
  return profile.bindings.map((binding) => ({
    id: `${PROFILE_KEYBIND_PREFIX}${binding.context}:${binding.keystroke}`,
    keystroke: binding.keystroke,
    commandId: binding.commandId ?? "",
    context: binding.context,
    source: "DEFAULT",
    scope: "USER",
    isEnabled: binding.commandId !== null,
    presetArgs: null,
  }));
}

/** Whether two profiles bind the same keys and set the same Vim mode, ignoring order. */
export function sameBindings(a: KeybindProfile, b: KeybindProfile): boolean {
  if (a.vimMode !== b.vimMode || a.bindings.length !== b.bindings.length) return false;
  const key = (binding: ProfileBinding) =>
    `${binding.context} ${binding.keystroke} ${binding.commandId ?? ""}`;
  const theirs = new Set(b.bindings.map(key));
  return a.bindings.every((binding) => theirs.has(key(binding)));
}
