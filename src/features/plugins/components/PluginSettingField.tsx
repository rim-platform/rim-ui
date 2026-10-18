import { useId } from "react";

import { Button } from "../../../shared/ui/Button";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import type { FieldDraft, FormField } from "./pluginSettingsForm";

const fieldClass =
  "w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";
const inputClass = `mt-1.5 ${fieldClass}`;

interface PluginSettingFieldProps {
  field: FormField;
  draft: FieldDraft;
  onChange: (draft: FieldDraft) => void;
  /** Why the value cannot be saved, shown under the field. */
  error?: string;
  /** Why a secret setting cannot be used here: the web app, or a vault that does not open. */
  secretNotice?: string;
}

/**
 * One setting of a plugin's settings form, built from its schema entry: a text
 * field for `string` and `path`, a number field for `integer`, a switch for
 * `boolean`, a list for `enum`, and for a secret a masked field that says only
 * whether a value is saved, with Replace and Clear. The title labels it, the
 * description sits under it, and the placeholder fills it while empty.
 */
export function PluginSettingField({
  field,
  draft,
  onChange,
  error,
  secretNotice,
}: PluginSettingFieldProps) {
  const { setting } = field;
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [setting.description ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  const label = (
    <label htmlFor={id} className="block text-sm font-medium text-rim-text">
      {setting.title}
    </label>
  );
  const help = setting.description ? (
    <p id={helpId} className="mt-1 text-xs text-rim-text-muted">
      {setting.description}
    </p>
  ) : null;
  const notes = (
    <>
      {field.stale && (
        <p className="mt-1 text-xs text-rim-warm">
          The saved value no longer fits this setting; saving clears it unless you choose a new one.
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-rim-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );

  if (setting.is_secret) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span id={id} className="text-sm font-medium text-rim-text">
            {setting.title}
          </span>
          <span className="rounded-full bg-rim-panel-soft px-1.5 py-0.5 text-[10px] text-rim-text-muted">
            Secret
          </span>
        </div>
        {help}
        {draft.kind === "secret" ? (
          <SecretInput field={field} draft={draft} onChange={onChange} labelId={id} />
        ) : (
          <p className="mt-1.5 text-xs text-rim-text-muted">{secretNotice}</p>
        )}
        {notes}
      </div>
    );
  }

  switch (draft.kind) {
    case "boolean":
      return (
        <div>
          <div className="flex items-center justify-between gap-4">
            <span id={id} className="text-sm font-medium text-rim-text">
              {setting.title}
            </span>
            <ToggleSwitch
              checked={draft.checked}
              onChange={(checked) => onChange({ kind: "boolean", checked })}
              label={setting.title}
            />
          </div>
          {help}
          {notes}
        </div>
      );
    case "choice":
      return (
        <div>
          {label}
          <select
            id={id}
            value={draft.choice}
            onChange={(e) => onChange({ kind: "choice", choice: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={inputClass}
          >
            <option value="">Not set</option>
            {(setting.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {help}
          {notes}
        </div>
      );
    case "text": {
      const integer = setting.value_type === "integer";
      return (
        <div>
          {label}
          <input
            id={id}
            type={integer ? "number" : "text"}
            inputMode={integer ? "numeric" : undefined}
            step={integer ? 1 : undefined}
            min={integer ? setting.min : undefined}
            max={integer ? setting.max : undefined}
            value={draft.text}
            placeholder={setting.placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange({ kind: "text", text: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={inputClass}
          />
          {help}
          {notes}
        </div>
      );
    }
    default:
      return (
        <div>
          <span className="text-sm font-medium text-rim-text">{setting.title}</span>
          {help}
          <p className="mt-1.5 text-xs text-rim-text-muted">
            This version of RIM cannot edit a setting of type {setting.value_type}.
          </p>
        </div>
      );
  }
}

/**
 * A secret's controls. A saved value is never shown or fetched: the field says
 * "Configured" and offers Replace and Clear; with none saved it is an empty
 * masked field.
 */
function SecretInput({
  field,
  draft,
  onChange,
  labelId,
}: {
  field: FormField;
  draft: Extract<FieldDraft, { kind: "secret" }>;
  onChange: (draft: FieldDraft) => void;
  labelId: string;
}) {
  const keep = () => onChange({ kind: "secret", action: "keep", text: "" });
  if (draft.action === "keep") {
    return (
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex-1 rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text-muted">
          Configured
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange({ kind: "secret", action: "replace", text: "" })}
        >
          Replace
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ kind: "secret", action: "clear", text: "" })}
        >
          Clear
        </Button>
      </div>
    );
  }
  if (draft.action === "clear") {
    return (
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex-1 text-xs text-rim-warm">Cleared when you save.</span>
        <Button type="button" variant="ghost" size="sm" onClick={keep}>
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <input
        type="password"
        aria-labelledby={labelId}
        value={draft.text}
        placeholder={
          field.configured ? "Enter a new value to replace it" : (field.setting.placeholder ?? "")
        }
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ kind: "secret", action: "replace", text: e.target.value })}
        className={fieldClass}
      />
      {field.configured && (
        <Button type="button" variant="ghost" size="sm" onClick={keep}>
          Keep current
        </Button>
      )}
    </div>
  );
}
