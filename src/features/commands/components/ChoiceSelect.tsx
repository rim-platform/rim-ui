import { CONTROL_CLASS, type ControlProps } from "./argumentControlParts";

/** One option of a `ChoiceSelect`, under `group` when it has one. */
export interface ChoiceOption {
  value: string;
  label: string;
  group?: string;
}

/**
 * A select over `options`, with an empty first option when `emptyLabel` is given. Options with a
 * `group` are listed under a heading, the groups in the order they first appear. A value not
 * among the options is shown as it is.
 */
export function ChoiceSelect({
  options,
  emptyLabel,
  value,
  onChange,
  controlId,
  describedBy,
  invalid,
  autoFocus,
  disabled,
}: {
  options: ChoiceOption[];
  emptyLabel: string | null;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
} & Pick<ControlProps, "controlId" | "describedBy" | "invalid" | "autoFocus">) {
  const known = value === "" || options.some((option) => option.value === value);
  const groups = [...new Set(options.flatMap((option) => (option.group ? [option.group] : [])))];
  const renderOption = (option: { value: string; label: string }) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );
  return (
    <select
      id={controlId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
      disabled={disabled}
      className={CONTROL_CLASS}
    >
      {emptyLabel !== null && <option value="">{emptyLabel}</option>}
      {!known && <option value={value}>{value}</option>}
      {groups.length === 0
        ? options.map(renderOption)
        : [
            ...options.filter((option) => !option.group).map(renderOption),
            ...groups.map((group) => (
              <optgroup key={group} label={group}>
                {options.filter((option) => option.group === group).map(renderOption)}
              </optgroup>
            )),
          ]}
    </select>
  );
}
