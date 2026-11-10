import { useState } from "react";

import { toast } from "../../../../shared/toast";
import type { SessionConfigOption } from "../../acp/acpClient";
import {
  MODEL_CATEGORY,
  type AgentSession,
  type AgentSessionSnapshot,
} from "../../acp/agentSession";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import {
  chooseAgentSessionModel,
  chooseAgentSessionOption,
} from "../../state/useAgentSessionsStore";

const SELECT_CLASS =
  "max-w-[12rem] truncate rounded border border-rim-line bg-rim-void px-1.5 py-0.5 text-xs text-rim-text disabled:opacity-60";

/** The config options in the order the header shows them: the model ones first, then the agent's order. */
function orderedOptions(options: readonly SessionConfigOption[]): readonly SessionConfigOption[] {
  return [
    ...options.filter((option) => option.category === MODEL_CATEGORY),
    ...options.filter((option) => option.category !== MODEL_CATEGORY),
  ];
}

/** One labelled select of the header. */
function SettingSelect({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 items-center gap-1 text-xs text-rim-text-muted">
      <span className="shrink-0">{showInvisibleCharacters(label)}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT_CLASS}
      >
        {children}
      </select>
    </label>
  );
}

/** A config option's values as `<option>`s, under their groups' names where they have them. */
function ConfigChoices({ option }: { option: SessionConfigOption }) {
  return option.groups.map((group, index) => {
    const choices = group.choices.map((choice) => (
      <option key={choice.value} value={choice.value} title={choice.description ?? undefined}>
        {showInvisibleCharacters(choice.name)}
      </option>
    ));
    return group.name === null ? (
      choices
    ) : (
      <optgroup key={`group-${index}`} label={showInvisibleCharacters(group.name)}>
        {choices}
      </optgroup>
    );
  });
}

/**
 * The agent's settings in a session's header, as the person's own controls: a select per config
 * option, the model first; without config options, the agent's older model list and modes. They
 * are off while a turn runs and while a change is on its way to the agent.
 */
export function SessionSettings({
  sessionKey,
  session,
  snapshot,
}: {
  sessionKey: string;
  session: AgentSession;
  snapshot: AgentSessionSnapshot;
}) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || snapshot.status !== "ready";

  const change = (apply: () => Promise<unknown>) => {
    setBusy(true);
    apply()
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "The setting did not change.");
      })
      .finally(() => setBusy(false));
  };

  if (snapshot.configOptions.length > 0) {
    return (
      <>
        {orderedOptions(snapshot.configOptions).map((option) => (
          <SettingSelect
            key={option.id}
            label={option.name}
            value={option.currentValue}
            disabled={disabled}
            onChange={(value) =>
              change(() => chooseAgentSessionOption(sessionKey, option.id, value))
            }
          >
            <ConfigChoices option={option} />
          </SettingSelect>
        ))}
      </>
    );
  }

  const { models, modes } = snapshot;
  return (
    <>
      {models && (
        <SettingSelect
          label="Model"
          value={models.currentModelId}
          disabled={disabled}
          onChange={(value) => change(() => chooseAgentSessionModel(sessionKey, value))}
        >
          {models.availableModels.map((model) => (
            <option
              key={model.modelId}
              value={model.modelId}
              title={model.description ?? undefined}
            >
              {showInvisibleCharacters(model.name)}
            </option>
          ))}
        </SettingSelect>
      )}
      {modes.length > 0 && (
        <SettingSelect
          label="Mode"
          value={snapshot.currentModeId ?? ""}
          disabled={busy || snapshot.status === "starting"}
          onChange={(value) => change(() => session.setMode(value))}
        >
          {modes.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {showInvisibleCharacters(mode.name)}
            </option>
          ))}
        </SettingSelect>
      )}
    </>
  );
}
