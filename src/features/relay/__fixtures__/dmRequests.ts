import { DmRequestStatus } from "../../../core/graphql/generated/schema-types";
import type { DmRequestView } from "../api/relayApi";

/**
 * A pending DM request filed by `hostServerId` for a conversation of the space `spaceId`, its
 * held invite carrying that space; `overrides` over the rest.
 */
export function makeDmRequest(
  id: string,
  hostServerId: string,
  spaceId: string,
  overrides: Partial<DmRequestView> = {},
): DmRequestView {
  return {
    id,
    fromPrincipalId: `rimp1_sender_${id}`,
    card: { payload: JSON.stringify({ relays: [] }), signature: "s" },
    hostServerId,
    conversationId: `conv-${id}`,
    heldItems: [
      {
        id: `item-${id}`,
        hostServerId,
        workspaceId: spaceId,
        envelope: { payload: "", signature: "" },
      },
    ],
    status: DmRequestStatus.PENDING,
    createdAt: "",
    expiresAt: "",
    ...overrides,
  };
}
