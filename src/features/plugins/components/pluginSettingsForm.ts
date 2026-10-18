// The settings form's fields: what each shows when it opens, what the user
// typed, and the change a save sends for it.

import { settingValueError } from "../../../../sdk/plugin-sdk/src/manifestRules";
import type { PluginSetting, PluginSettingsFormState } from "../types";

/** What one field holds while the form is open. */
export type FieldDraft =
  /** A `string`, `path` or `integer` field: the text in it. */
  | { kind: "text"; text: string }
  | { kind: "boolean"; checked: boolean }
  /** An `enum` field: the picked option, `""` for none. */
  | { kind: "choice"; choice: string }
  /**
   * A secret field: keep the saved value, replace it with `text` (or set one,
   * when none is saved), or clear it.
   */
  | { kind: "secret"; action: "keep" | "replace" | "clear"; text: string }
  /** A secret the host cannot keep or read, or a value type this app does not know. */
  | { kind: "none" };

/** One field of the form, as it opened. */
export interface FormField {
  setting: PluginSetting;
  initial: FieldDraft;
  /** Whether a secret value is saved for this setting. */
  configured: boolean;
  /**
   * A saved value the setting no longer accepts, after an update changed its
   * type, bounds or options. The field shows the default instead, and a save
   * clears the saved value unless the user picks a new one.
   */
  stale: boolean;
}

/** What a save sends for one field. */
export type FieldChange =
  | { kind: "unchanged" }
  /** The new value, `null` clearing the saved one. */
  | { kind: "set"; value: unknown }
  | { kind: "invalid"; reason: string };

const WHOLE_NUMBER = /^-?\d+$/;
const unchanged: FieldChange = { kind: "unchanged" };

function own(values: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

/**
 * The fields of a plugin's settings form, in schema order.
 *
 * @param schema - The plugin's `settings_schema`.
 * @param state - The saved values and secret flags from the host.
 * @returns One field per setting.
 */
export function formFields(
  schema: readonly PluginSetting[],
  state: PluginSettingsFormState,
): FormField[] {
  return schema.map((setting) => {
    if (setting.is_secret) {
      const configured = state.secrets[setting.key] === true;
      const usable = state.secrets_available && state.secrets_error === null;
      const initial: FieldDraft = usable
        ? { kind: "secret", action: configured ? "keep" : "replace", text: "" }
        : { kind: "none" };
      return { setting, initial, configured, stale: false };
    }
    const saved = own(state.values, setting.key) ? state.values[setting.key] : undefined;
    const fits = saved !== undefined && settingValueError(setting, saved) === null;
    const shown = fits ? saved : setting.default;
    return {
      setting,
      initial: draftOf(setting, shown),
      configured: false,
      stale: saved !== undefined && !fits,
    };
  });
}

/** The draft a field opens with when it shows `value` (a saved value, a default or nothing). */
function draftOf(setting: PluginSetting, value: unknown): FieldDraft {
  switch (setting.value_type) {
    case "string":
    case "path":
      return { kind: "text", text: typeof value === "string" ? value : "" };
    case "integer":
      return { kind: "text", text: typeof value === "number" ? String(value) : "" };
    case "boolean":
      return { kind: "boolean", checked: value === true };
    case "enum":
      return { kind: "choice", choice: typeof value === "string" ? value : "" };
    default:
      return { kind: "none" };
  }
}

function sameDraft(a: FieldDraft, b: FieldDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The change a save sends for `field` now holding `draft`. An untouched field
 * sends nothing, except a stale one, which is cleared; an emptied text field or
 * an enum set to none clears the saved value; a secret sends a value only when
 * replaced with one, and `null` when cleared.
 *
 * @returns The change, or why the draft is not a value the setting accepts.
 */
export function fieldChange(field: FormField, draft: FieldDraft): FieldChange {
  if (draft.kind === "secret") {
    if (draft.action === "clear")
      return field.configured ? { kind: "set", value: null } : unchanged;
    if (draft.action === "replace" && draft.text !== "") {
      return checked(field.setting, draft.text);
    }
    return unchanged;
  }
  if (sameDraft(draft, field.initial)) {
    return field.stale ? { kind: "set", value: null } : unchanged;
  }
  switch (draft.kind) {
    case "text": {
      if (field.setting.value_type !== "integer") {
        return draft.text === ""
          ? { kind: "set", value: null }
          : checked(field.setting, draft.text);
      }
      const text = draft.text.trim();
      if (text === "") return { kind: "set", value: null };
      if (!WHOLE_NUMBER.test(text)) return { kind: "invalid", reason: "must be a whole number" };
      return checked(field.setting, Number(text));
    }
    case "boolean":
      return checked(field.setting, draft.checked);
    case "choice":
      return draft.choice === ""
        ? { kind: "set", value: null }
        : checked(field.setting, draft.choice);
    case "none":
      return unchanged;
  }
}

function checked(setting: PluginSetting, value: unknown): FieldChange {
  const reason = settingValueError(setting, value);
  return reason === null ? { kind: "set", value } : { kind: "invalid", reason };
}

/**
 * A reason as the line under a field shows it: "must be at least 5" becomes
 * "Must be at least 5.", and a host message that starts with the key loses it.
 */
export function reasonText(reason: string, key: string): string {
  const bare = reason.startsWith(`${key} `) ? reason.slice(key.length + 1) : reason;
  const sentence = bare.charAt(0).toUpperCase() + bare.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
