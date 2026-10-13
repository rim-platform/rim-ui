import { useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

const THROTTLE_MS = 3000;

const START_TYPING = gql`
  mutation StartTyping($serverId: ID!, $conversationId: ID!) {
    startTyping(serverId: $serverId, conversationId: $conversationId)
  }
`;

/**
 * Announces typing in a conversation through the startTyping mutation, at most once per
 * `THROTTLE_MS`. `handleKeystroke` takes the composer text after the keystroke and stays quiet
 * while it is blank; `markSent` lifts the throttle once a message went out, so the next
 * keystroke announces typing again at once.
 */
export function useTypingIndicator(workspaceId: string, conversationId: string) {
  const lastSentRef = useRef(0);
  // Use refs to always read the latest values without re-creating the callback
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const startTyping = useMutation({
    mutationFn: (vars: { serverId: string; conversationId: string }) =>
      graphqlClient.request(START_TYPING, vars),
  });

  const handleKeystroke = useCallback((text: string) => {
    if (!text.trim()) return;
    const now = Date.now();
    if (now - lastSentRef.current < THROTTLE_MS) return;
    lastSentRef.current = now;

    startTyping.mutate({
      serverId: workspaceIdRef.current,
      conversationId: conversationIdRef.current,
    });
    // startTyping.mutate is stable — only the variables change via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSent = useCallback(() => {
    lastSentRef.current = 0;
  }, []);

  return { handleKeystroke, markSent };
}
