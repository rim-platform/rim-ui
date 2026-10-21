import { useId } from "react";

import type { SignupMinimumAge } from "../api/useMinimumAge";

/**
 * "I am at least N" for the server's minimum age, and the server's refusal over it when there
 * was one. Nothing when the server asks for no age.
 */
export function MinimumAgeConfirmation({
  age,
  disabled,
}: {
  age: SignupMinimumAge;
  disabled?: boolean;
}) {
  const errorId = useId();
  if (age.minimumAge === null) return null;
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-rim-text">
        <input
          type="checkbox"
          checked={age.confirmed}
          onChange={(e) => age.setConfirmed(e.currentTarget.checked)}
          disabled={disabled}
          aria-describedby={age.error ? errorId : undefined}
        />
        I am at least {age.minimumAge}
      </label>
      {age.error && (
        <p id={errorId} role="alert" className="ml-6 text-xs text-rim-danger">
          {age.error}
        </p>
      )}
    </div>
  );
}
