import { useState } from "react";

import { cn } from "../../../shared/ui/cn";
import { COMMAND_RELATIVE_MINUTES } from "../../updater/api/serverCapabilities";
import { useSpaceHasCapability } from "../../updater/hooks/useSpaceHasCapability";
import type { ArgumentPicker } from "../runtime/argumentPickers";
import { argumentLabel, type FieldValue } from "../runtime/argumentValues";
import {
  chosenTimeChoice,
  countInputOf,
  isoOfLocalInput,
  localInputOfIso,
  storedCountOf,
  timeField,
  valuesForChoice,
  type CountInput,
  type CountSpec,
  type DurationUnit,
  type TimeFieldKind,
} from "../runtime/timeChoices";
import {
  CONTROL_CLASS,
  emptyPresetLabel,
  selectPropsOf,
  useFieldWorkspace,
  type ControlProps,
} from "./argumentControlParts";
import { ChoiceSelect } from "./ChoiceSelect";

function textOf(value: FieldValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A length of time: a whole number and its unit, stored in the argument's own unit. The typed
 * number and unit are kept as typed, and follow the stored length when it changes from outside.
 */
function CountField({
  spec,
  stored,
  label,
  onChange,
}: {
  spec: CountSpec;
  stored: string;
  label: string;
  onChange: (stored: string) => void;
}) {
  const [input, setInput] = useState<CountInput>(() => countInputOf(spec, stored));
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    if (storedCountOf(spec, input) !== stored) setInput(countInputOf(spec, stored));
  }
  const units: readonly DurationUnit[] =
    input.unit === "seconds" ? ["seconds", ...spec.units] : spec.units;

  function update(next: CountInput) {
    setInput(next);
    const nextStored = storedCountOf(spec, next);
    setSeen(nextStored);
    onChange(nextStored);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        aria-label={`${label}: how many`}
        value={input.count}
        onChange={(e) => update({ ...input, count: e.target.value })}
        className={cn(CONTROL_CLASS, "w-24 shrink-0")}
      />
      <select
        aria-label={`${label}: unit`}
        value={input.unit}
        onChange={(e) => update({ ...input, unit: e.target.value as DurationUnit })}
        className={cn(CONTROL_CLASS, "w-auto")}
      >
        {units.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A date and time on this device's clock, stored as RFC 3339. The typed text is kept while it is
 * not a full date and time yet, and follows the stored time when it changes from outside.
 */
function DateTimeField({
  stored,
  label,
  onChange,
}: {
  stored: string;
  label: string;
  onChange: (stored: string) => void;
}) {
  const [local, setLocal] = useState(() => localInputOfIso(stored));
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    if (isoOfLocalInput(local) !== stored) setLocal(localInputOfIso(stored));
  }
  return (
    <input
      type="datetime-local"
      aria-label={`${label}: date and time`}
      value={local}
      onChange={(e) => {
        const next = isoOfLocalInput(e.target.value);
        setLocal(e.target.value);
        setSeen(next);
        onChange(next);
      }}
      className={CONTROL_CLASS}
    />
  );
}

/**
 * When something ends or how long it lasts: a select of the field's choices, and under it the
 * number and unit, or the date and time, that the chosen one takes. It sets every argument the
 * field covers, emptying those its choice does not use. Choices that count from now are offered
 * only by a server that lists `command_relative_minutes`, unless one is already chosen.
 */
export function TimeChoiceField(
  props: ControlProps & { picker: ArgumentPicker; kind: TimeFieldKind },
) {
  const { picker, kind, mode, argument, onChangeFields } = props;
  const field = timeField(kind, picker.valueLabels);
  const values = { ...props.formValues, [argument.name]: props.value };
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const relative = useSpaceHasCapability(workspaceId, COMMAND_RELATIVE_MINUTES);
  const chosen = chosenTimeChoice(field, values);
  const lead = field.names[0];
  const allowed = argument.allowedValues?.length ? argument.allowedValues : null;
  const offered = field.choices.filter(
    (choice) =>
      choice === chosen ||
      ((!choice.relative || relative) &&
        (!allowed || choice.values[lead] === undefined || allowed.includes(choice.values[lead]))),
  );
  const fixedOnly = !relative && field.choices.some((choice) => choice.relative);
  const label = argumentLabel(argument, props.commandId);
  const emptyLabel = !field.emptyChoice
    ? null
    : mode === "preset"
      ? emptyPresetLabel(argument)
      : chosen
        ? null
        : "Choose…";
  const count = field.count;
  const at = field.at;

  return (
    <div className="space-y-1.5">
      <ChoiceSelect
        {...selectPropsOf(props)}
        value={chosen?.id ?? ""}
        onChange={(id) =>
          onChangeFields(
            valuesForChoice(
              field,
              field.choices.find((choice) => choice.id === id),
              values,
            ),
          )
        }
        options={offered.map((choice) => ({ value: choice.id, label: choice.label }))}
        emptyLabel={emptyLabel}
      />
      {chosen?.input === "count" && count && (
        <CountField
          spec={count}
          stored={textOf(values[count.name])}
          label={label}
          onChange={(stored) => onChangeFields({ [count.name]: stored })}
        />
      )}
      {chosen?.input === "at" && at && (
        <DateTimeField
          stored={textOf(values[at])}
          label={label}
          onChange={(stored) => onChangeFields({ [at]: stored })}
        />
      )}
      {fixedOnly && (
        <p className="text-xs text-rim-text-faint">This server only takes a fixed end.</p>
      )}
    </div>
  );
}
