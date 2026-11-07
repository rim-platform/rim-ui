/** A labelled drop-down row of the device settings. */
export function DeviceSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  description,
  disabled,
  describedBy,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  label: string;
  description: string;
  disabled?: boolean;
  /** The id of an element that explains the row, such as why an option is disabled. */
  describedBy?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium text-rim-text">{label}</span>
        <span className="block text-xs text-rim-text-muted">{description}</span>
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
