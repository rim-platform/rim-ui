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
 * Hook that tracks keystrokes and calls startTyping mutation (throttled).
 * Returns an onKeyDown handler to attach to the Composer textarea.
 */
export function useTypingIndicator(
  workspaceId: string,
  conversationId: string,
) {
  const lastSentRef = useRef(0);

  const startTyping = useMutation({
    mutationFn: () =>
      graphqlClient.request(START_TYPING, {
        serverId: workspaceId,
        conversationId,
      }),
  });

  const handleKeystroke = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < THROTTLE_MS) return;
    lastSentRef.current = now;

    startTyping.mutate();
  }, [startTyping]);

  return { handleKeystroke };
}
