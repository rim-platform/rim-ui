import { cn } from "../../../shared/ui/cn";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — the switch has no visible text of its own. */
  label: string;
  disabled?: boolean;
}

/** On/off switch used by settings rows (`role="switch"`, design tokens only). */
export function ToggleSwitch({ checked, onChange, label, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-rim-accent" : "bg-rim-panel-soft",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-rim-text shadow-sm ring-0 transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
