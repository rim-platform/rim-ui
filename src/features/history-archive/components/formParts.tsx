/** The text inputs of the archive's setup forms. */
export const archiveInputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

/**
 * The user's consent to plain HTTP to another computer; `secret` names what travels in the
 * clear.
 */
export function InsecureConsent({
  checked,
  onChange,
  secret,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  secret: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-rim-text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-rim-accent"
      />
      <span>
        Allow an unencrypted connection. The archive stays encrypted, but {secret} travels in the
        clear: only on a network you trust.
      </span>
    </label>
  );
}
