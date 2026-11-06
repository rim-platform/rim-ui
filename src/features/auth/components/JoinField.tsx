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
  disabled?: boolean;
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
  disabled,
}: JoinFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-rim-text">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className="w-full rounded-[9px] border border-rim-line-strong bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent disabled:opacity-50 aria-[invalid=true]:border-rim-danger"
      />
      {error && <span className="mt-1 block text-xs text-rim-danger">{error}</span>}
      {!error && hint && (
        <span className="mt-1 block text-xs leading-snug text-rim-text-muted">{hint}</span>
      )}
    </label>
  );
}
