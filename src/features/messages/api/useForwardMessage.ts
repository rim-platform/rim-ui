import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import { queryKeys } from "../../../core/query/keys";
import { refusePlaintextIfEncrypted } from "../../e2ee/runtime/pins";

const FORWARD_MESSAGE = gql`
  mutation ForwardMessage($input: ForwardMessageInput!) {
    forwardMessage(input: $input) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

interface ForwardMessageVars {
  serverId: string;
  sourceConversationId: string;
  targetConversationId: string;
  messageId: string;
}

export function useForwardMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: ForwardMessageVars) => {
      await refusePlaintextIfEncrypted(qc, vars.serverId, vars.targetConversationId);
      return graphqlClient.request(FORWARD_MESSAGE, {
        input: {
          serverId: vars.serverId,
          sourceConversationId: vars.sourceConversationId,
          targetConversationId: vars.targetConversationId,
          messageId: vars.messageId,
        },
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.messages(vars.serverId, vars.targetConversationId),
      });
    },
  });
}
