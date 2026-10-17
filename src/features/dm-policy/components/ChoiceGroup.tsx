import { useId } from "react";

import { cn } from "../../../shared/ui/cn";
import type { DmChoice } from "../labels";

interface ChoiceGroupProps<T extends string> {
  legend: string;
  hint?: React.ReactNode;
  choices: DmChoice<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** One DM setting as a set of radio cards, each with its sentence. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  choices,
  value,
  onChange,
  disabled = false,
}: ChoiceGroupProps<T>) {
  const name = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-rim-text">{legend}</legend>
      {hint && <div className="mt-0.5 text-xs text-rim-text-muted">{hint}</div>}
      <div
        className={cn(
          "mt-2 grid gap-2",
          choices.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "flex flex-col rounded-md border px-3 py-2 transition",
              disabled ? "cursor-default opacity-70" : "cursor-pointer",
              value === choice.value
                ? "border-rim-accent/60 bg-rim-accent/10"
                : cn("border-rim-line", !disabled && "hover:bg-white/5"),
            )}
          >
            <span className="flex items-center gap-2 text-sm text-rim-text">
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
                aria-describedby={`${name}-${choice.value}`}
                className="accent-rim-accent"
              />
              {choice.label}
            </span>
            <span id={`${name}-${choice.value}`} className="mt-0.5 text-xs text-rim-text-muted">
              {choice.description}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
