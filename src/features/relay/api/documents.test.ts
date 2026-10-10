import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSchema, parse, validate } from "graphql";

import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import * as documents from "./documents";

const schema = buildSchema(readFileSync(resolve(__dirname, "../../../../schema.graphql"), "utf8"));

describe("relay documents", () => {
  const entries = Object.entries(documents);

  it("covers every operation of the relay", () => {
    expect(entries.map(([name]) => name).sort()).toEqual([
      "ACCEPT_DM_REQUEST_MUTATION",
      "ACK_RELAY_ITEMS_MUTATION",
      "ADD_CONTACT_MUTATION",
      "APPLY_REMOTE_REVOCATION_MUTATION",
      "BLOCK_PRINCIPAL_MUTATION",
      "CONTACTS_QUERY",
      "CONVERSATION_PREDECESSOR_QUERY",
      "DEVICE_REVOCATION_STATUS_QUERY",
      "DIRECT_SPACE_CONVERSATIONS_QUERY",
      "DM_REQUESTS_QUERY",
      "IGNORE_DM_REQUEST_MUTATION",
      "JOIN_REMOTE_WORKSPACE_MUTATION",
      "KEY_LOGIN_CHALLENGE_MUTATION",
      "LEAVE_RELAY_MUTATION",
      "LOGIN_WITH_KEY_MUTATION",
      "PUBLISH_PROFILE_CARD_MUTATION",
      "RELAY_INFO_QUERY",
      "RELAY_ITEMS_QUERY",
      "RELAY_ME_QUERY",
      "RELAY_STREAM_SUBSCRIPTION",
      "REMOTE_IDENTITY_QUERY",
      "REMOTE_JOIN_CHALLENGE_MUTATION",
      "REMOTE_SERVER_QUERY",
      "REMOTE_SUBSCRIPTIONS_QUERY",
      "REMOTE_WORKSPACE_QUERY",
      "REMOVE_CONTACT_MUTATION",
      "RENEW_DELEGATIONS_MUTATION",
      "REPORT_DM_REQUEST_MUTATION",
      "SIGNUP_WITH_KEY_MUTATION",
      "STREAM_HEADS_QUERY",
      "UNBLOCK_PRINCIPAL_MUTATION",
      "WORKSPACE_EVENTS_SUBSCRIPTION",
    ]);
  });

  it.each(entries)("%s is valid against the schema", (_name, document) => {
    expect(validate(schema, parse(String(document)))).toEqual([]);
  });

  it("asks for a remote member list in createConversation's input", () => {
    const create = parse(`
      mutation($input: CreateConversationInput!) { createConversation(input: $input) { ...ConversationFields } }
      ${CONVERSATION_FIELDS}
    `);
    expect(validate(schema, create)).toEqual([]);
    const input = schema.getType("CreateConversationInput");
    expect(input && "getFields" in input ? Object.keys(input.getFields()) : []).toEqual(
      expect.arrayContaining(["remoteMembers", "predecessor"]),
    );
  });
});
