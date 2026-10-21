import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { graphqlErrorCode, graphqlErrorMessage, VALIDATION } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useServerInfo } from "../../updater/hooks/useServerInfo";

/** What a signup refused over the minimum age says at the checkbox. */
export const MINIMUM_AGE_REFUSED_MESSAGE =
  "The server did not accept this: confirm its current minimum age and try again.";

/** Whether a failed signup is the server refusing it over its minimum age. */
export function isMinimumAgeRefusal(err: unknown): boolean {
  return graphqlErrorCode(err) === VALIDATION && /minimum age/i.test(graphqlErrorMessage(err, ""));
}

/** A signup form's minimum age: the server's, and whether the person confirmed reaching it. */
export interface SignupMinimumAge {
  /** The age the server asks every signup to confirm; `null` when it asks for none. */
  minimumAge: number | null;
  confirmed: boolean;
  setConfirmed: (confirmed: boolean) => void;
  /** Whether a signup may be sent: the server asks for no age, or it is confirmed. */
  satisfied: boolean;
  /** What a signup input carries: `confirmedMinimumAge`, the server's age, once confirmed. */
  fields: { confirmedMinimumAge?: number };
  /** The refusal over the age to show at the checkbox; `null` otherwise. */
  error: string | null;
  /**
   * Takes a failed signup: a refusal over the minimum age unticks the box, says so at it and
   * rereads the server's minimum age, which may have changed. Returns whether it was one.
   */
  noteFailure: (err: unknown) => boolean;
}

/** The minimum age a signup form asks the person to confirm, from `serverInfo.minimumAge`. */
export function useSignupMinimumAge(): SignupMinimumAge {
  const qc = useQueryClient();
  const minimumAge = useServerInfo().info?.minimumAge ?? null;
  const [confirmed, setConfirmedState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setConfirmed(value: boolean) {
    setConfirmedState(value);
    setError(null);
  }

  function noteFailure(err: unknown): boolean {
    if (!isMinimumAgeRefusal(err)) return false;
    setConfirmedState(false);
    setError(MINIMUM_AGE_REFUSED_MESSAGE);
    void qc.invalidateQueries({ queryKey: queryKeys.serverInfo });
    return true;
  }

  return {
    minimumAge,
    confirmed,
    setConfirmed,
    satisfied: minimumAge === null || confirmed,
    fields: minimumAge !== null && confirmed ? { confirmedMinimumAge: minimumAge } : {},
    error,
    noteFailure,
  };
}
