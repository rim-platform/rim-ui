import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { graphqlErrorCode, graphqlErrorMessage, VALIDATION } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useServerInfo } from "../../updater/hooks/useServerInfo";

/** What a signup refused over its terms of service says at the checkbox. */
export const TERMS_REFUSED_MESSAGE =
  "The server did not accept this: accept its current terms of use and try again.";

/** Whether a failed signup is the server refusing it over the terms of service. */
export function isTermsRefusal(err: unknown): boolean {
  return graphqlErrorCode(err) === VALIDATION && /terms/i.test(graphqlErrorMessage(err, ""));
}

/** A signup form's terms of service: the server's URL and whether the person accepted it. */
export interface SignupTerms {
  /** The server's terms of service URL; `null` when it has none, or has not said. */
  termsUrl: string | null;
  accepted: boolean;
  setAccepted: (accepted: boolean) => void;
  /** Whether a signup may be sent: the server has no terms, or they are accepted. */
  satisfied: boolean;
  /** What a signup input carries: `acceptedTermsUrl`, the terms URL unchanged, once accepted. */
  fields: { acceptedTermsUrl?: string };
  /** The refusal over the terms to show at the checkbox; `null` otherwise. */
  error: string | null;
  /**
   * Takes a failed signup: a refusal over the terms unticks the box, says so at it and rereads
   * the server's terms URL, which may have changed. Returns whether it was one.
   */
  noteFailure: (err: unknown) => boolean;
}

/** The terms of service a signup form asks the person to accept, from `serverInfo.termsUrl`. */
export function useSignupTerms(): SignupTerms {
  const qc = useQueryClient();
  const termsUrl = useServerInfo().info?.termsUrl ?? null;
  const [accepted, setAcceptedState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAccepted(value: boolean) {
    setAcceptedState(value);
    setError(null);
  }

  function noteFailure(err: unknown): boolean {
    if (!isTermsRefusal(err)) return false;
    setAcceptedState(false);
    setError(TERMS_REFUSED_MESSAGE);
    void qc.invalidateQueries({ queryKey: queryKeys.serverInfo });
    return true;
  }

  return {
    termsUrl,
    accepted,
    setAccepted,
    satisfied: termsUrl === null || accepted,
    fields: termsUrl !== null && accepted ? { acceptedTermsUrl: termsUrl } : {},
    error,
    noteFailure,
  };
}
