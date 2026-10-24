import { useId } from "react";

import { cn } from "../../../shared/ui/cn";
import {
  PASSPHRASE_MIN_CHARS,
  PIN_MIN_DIGITS,
  type NewPassword,
  type PasswordKind,
} from "../password";

const inputClass =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40 disabled:opacity-50";

const labelClass = "block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** What the person reads before choosing a password. */
export const PASSWORD_EXPLANATION =
  "You'll enter this every time you sign in. If you forget it, your recovery phrase resets it.";

/** One password field: the account's current password, typed once. */
export function PasswordInput({
  label,
  value,
  onChange,
  disabled,
  autoFocus,
  autoComplete = "current-password",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className={`mt-1 normal-case tracking-normal ${inputClass}`}
      />
    </label>
  );
}

/**
 * Choosing a new password: a PIN of at least 6 digits or a passphrase of at least 12
 * characters, typed twice, with what it is for. `problem` is shown under the fields.
 */
export function NewPasswordFields({
  value,
  onChange,
  problem,
  disabled,
  label = "Password",
}: {
  value: NewPassword;
  onChange: (value: NewPassword) => void;
  problem?: string | null;
  disabled?: boolean;
  label?: string;
}) {
  const name = useId();
  const pin = value.kind === "pin";

  function choose(kind: PasswordKind) {
    onChange({ kind, password: "", repeat: "" });
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className={labelClass}>{label}</legend>
      <p className="text-xs text-rim-text-muted">{PASSWORD_EXPLANATION}</p>
      <div role="radiogroup" className="flex gap-2">
        {(
          [
            ["pin", `PIN (at least ${PIN_MIN_DIGITS} digits)`],
            ["passphrase", `Passphrase (at least ${PASSPHRASE_MIN_CHARS} characters)`],
          ] as const
        ).map(([kind, text]) => (
          <label
            key={kind}
            className={cn(
              "flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs",
              value.kind === kind
                ? "border-rim-accent/40 bg-rim-panel text-rim-text"
                : "border-rim-line text-rim-text-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              checked={value.kind === kind}
              onChange={() => choose(kind)}
            />
            {text}
          </label>
        ))}
      </div>
      <input
        type="password"
        aria-label={pin ? "PIN" : "Passphrase"}
        placeholder={pin ? "PIN" : "Passphrase"}
        inputMode={pin ? "numeric" : undefined}
        autoComplete="new-password"
        value={value.password}
        onChange={(e) => onChange({ ...value, password: e.currentTarget.value })}
        className={inputClass}
      />
      <input
        type="password"
        aria-label={pin ? "PIN again" : "Passphrase again"}
        placeholder={pin ? "PIN again" : "Passphrase again"}
        inputMode={pin ? "numeric" : undefined}
        autoComplete="new-password"
        value={value.repeat}
        onChange={(e) => onChange({ ...value, repeat: e.currentTarget.value })}
        className={inputClass}
      />
      {problem && <p className="text-xs text-rim-danger">{problem}</p>}
    </fieldset>
  );
}

/** "Keep me signed in on this device". */
export function KeepSignedInCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-rim-text-muted">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      Keep me signed in on this device
    </label>
  );
}
