interface JoinFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  maxLength?: number;
}

/** A labelled text input of the join forms, with an inline error or a hint below it. */
export function JoinField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
  error,
  required,
  maxLength,
}: JoinFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
      />
      {error && <span className="mt-1 block text-xs text-rim-danger">{error}</span>}
      {!error && hint && <span className="mt-1 block text-xs text-rim-text-faint">{hint}</span>}
    </label>
  );
}
