import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import {
  usePluginSettingsReset,
  usePluginSettingsSave,
  usePluginSettingsState,
} from "../api/usePluginSettings";
import { PluginSettingsError } from "../pluginSettings";
import type { PluginInfo, PluginSettingsFormState } from "../types";
import { PluginSettingField } from "./PluginSettingField";
import {
  fieldChange,
  formFields,
  reasonText,
  type FieldDraft,
  type FormField,
} from "./pluginSettingsForm";

interface PluginSettingsDialogProps {
  plugin: PluginInfo;
  onClose: () => void;
}

/** The notice a secret field shows in the web app, which keeps no secret settings. */
export const WEB_SECRET_NOTICE = "Secret settings are only available in the desktop app.";

/**
 * The settings form of one plugin, built from its `settings_schema`. Save checks
 * every changed field and sends only those, Cancel closes without saving, and
 * Reset to defaults clears every saved value, secret ones included, after the
 * user confirms. A saved secret is never shown or fetched.
 */
export function PluginSettingsDialog({ plugin, onClose }: PluginSettingsDialogProps) {
  const name = plugin.display_name || plugin.plugin_id;
  const state = usePluginSettingsState(plugin.plugin_id);

  return (
    <Dialog open onClose={onClose} title={`${name} settings`} maxWidth="max-w-lg">
      {state.isPending ? (
        <p className="text-sm text-rim-text-muted">Loading settings...</p>
      ) : state.isError ? (
        <p className="flex items-center gap-1.5 text-xs text-rim-danger" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {state.error.message}
        </p>
      ) : (
        <SettingsForm
          // A reset or a save loads the state again and opens the form afresh.
          key={state.dataUpdatedAt}
          plugin={plugin}
          state={state.data}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function SettingsForm({
  plugin,
  state,
  onClose,
}: {
  plugin: PluginInfo;
  state: PluginSettingsFormState;
  onClose: () => void;
}) {
  const save = usePluginSettingsSave();
  const reset = usePluginSettingsReset();
  const [fields] = useState<FormField[]>(() => formFields(plugin.settings_schema ?? [], state));
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>(() =>
    Object.fromEntries(fields.map((f) => [f.setting.key, f.initial])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const secretNotice = !state.secrets_available
    ? WEB_SECRET_NOTICE
    : state.secrets_error !== null
      ? `Secret settings cannot be read: ${state.secrets_error}`
      : undefined;

  function setDraft(key: string, draft: FieldDraft) {
    setDrafts((prev) => ({ ...prev, [key]: draft }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const changes: Record<string, unknown> = {};
    const invalid: Record<string, string> = {};
    for (const field of fields) {
      const key = field.setting.key;
      const change = fieldChange(field, drafts[key]);
      if (change.kind === "invalid") invalid[key] = reasonText(change.reason, key);
      else if (change.kind === "set") changes[key] = change.value;
    }
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    save.mutate(
      { pluginId: plugin.plugin_id, changes },
      {
        onSuccess: onClose,
        onError: (error) => {
          const key = error instanceof PluginSettingsError ? error.key : null;
          if (key !== null && fields.some((f) => f.setting.key === key)) {
            setErrors({ [key]: reasonText(error.message, key) });
          } else {
            setFormError(error.message);
          }
        },
      },
    );
  }

  function handleReset() {
    setFormError(null);
    reset.mutate(plugin.plugin_id, {
      onSuccess: () => setConfirmingReset(false),
      onError: (error) => {
        setConfirmingReset(false);
        setFormError(error.message);
      },
    });
  }

  return (
    <form onSubmit={handleSave} noValidate>
      <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        {fields.map((field) => (
          <PluginSettingField
            key={field.setting.key}
            field={field}
            draft={drafts[field.setting.key]}
            onChange={(draft) => setDraft(field.setting.key, draft)}
            error={errors[field.setting.key]}
            secretNotice={secretNotice}
          />
        ))}
      </div>

      {formError && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-rim-danger" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {formError}
        </p>
      )}

      {confirmingReset && (
        <div
          className="mt-4 rounded-md border border-rim-warm/30 bg-rim-warm/5 px-3 py-2"
          role="alertdialog"
          aria-label="Reset to defaults"
        >
          <p className="text-xs text-rim-text">
            Reset every setting of this plugin to its default? Saved secrets are cleared too.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingReset(false)}
            >
              Keep my settings
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleReset}
              isLoading={reset.isPending}
            >
              Reset
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-rim-line pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirmingReset(true)}
          disabled={confirmingReset || save.isPending}
        >
          Reset to defaults
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={save.isPending}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
