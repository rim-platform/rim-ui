import { readFileSync } from "node:fs";

import { buildASTSchema, parse, visit } from "graphql";
import { describe, expect, it } from "vitest";

import { collectDocuments, refusedOperations } from "./skew-check.mjs";

const SDL = readFileSync(new URL("../schema.graphql", import.meta.url), "utf8");

/** The field each type of the committed schema loses on a server older than edit times. */
const NEWER_FIELDS = { Message: "editedAt", ServerInfo: "capabilities" };

/** The committed schema as a server without `Message.editedAt` and `serverInfo.capabilities`. */
function schemaWithoutEditTimes() {
  const document = visit(parse(SDL), {
    ObjectTypeDefinition(node) {
      const field = NEWER_FIELDS[node.name.value];
      if (!field) return undefined;
      return { ...node, fields: node.fields?.filter((f) => f.name.value !== field) };
    },
  });
  return buildASTSchema(document);
}

/** The fields of each type the committed schema has beyond a server without `message_flag`. */
const FLAG_FIELDS = {
  Message: ["flagged"],
  MessageReport: ["automatic"],
  Mutation: ["clearMessageFlag"],
};

/** The committed schema as a server without the automatic check's flags. */
function schemaWithoutMessageFlags() {
  const document = visit(parse(SDL), {
    ObjectTypeDefinition(node) {
      const fields = FLAG_FIELDS[node.name.value];
      if (!fields) return undefined;
      return { ...node, fields: node.fields?.filter((f) => !fields.includes(f.name.value)) };
    },
  });
  return buildASTSchema(document);
}

/** The mutations the committed schema has beyond a server without leaving and renaming. */
const NEWER_MUTATIONS = new Set(["leaveWorkspace", "renameWorkspace"]);

/** The committed schema as a server without `leaveWorkspace` and `renameWorkspace`. */
function schemaWithoutLeaveAndRename() {
  const document = visit(parse(SDL), {
    ObjectTypeDefinition(node) {
      if (node.name.value !== "Mutation") return undefined;
      return { ...node, fields: node.fields?.filter((f) => !NEWER_MUTATIONS.has(f.name.value)) };
    },
  });
  return buildASTSchema(document);
}

/** The fields of each type the committed schema has beyond a server without `delete_member_messages`. */
const MEMBER_MESSAGE_FIELDS = {
  Query: ["memberMessageCounts"],
  Mutation: ["deleteMemberMessages"],
};

/** The committed schema as a server without counting and deleting a person's messages. */
function schemaWithoutMemberMessageDeletion() {
  const document = visit(parse(SDL), {
    ObjectTypeDefinition(node) {
      const fields = MEMBER_MESSAGE_FIELDS[node.name.value];
      if (!fields) return undefined;
      return { ...node, fields: node.fields?.filter((f) => !fields.includes(f.name.value)) };
    },
  });
  return buildASTSchema(document);
}

/** The committed schema without the listed fields, given as `{ TypeName: ["field", ...] }`. */
function schemaWithoutFields(fieldsByType) {
  const document = visit(parse(SDL), {
    ObjectTypeDefinition(node) {
      const fields = fieldsByType[node.name.value];
      if (!fields) return undefined;
      return { ...node, fields: node.fields?.filter((f) => !fields.includes(f.name.value)) };
    },
  });
  return buildASTSchema(document);
}

describe("skew check", () => {
  const documents = collectDocuments();

  it("keeps every message query valid on a server without Message.editedAt", () => {
    const refused = refusedOperations(schemaWithoutEditTimes(), documents);
    expect(refused.map((r) => r.label).sort()).toEqual([
      "query HostCapabilities",
      "query MessagesWithBots",
      "query MessagesWithEdits",
      "query MessagesWithFlags",
      "query ServerInfo",
      "query ThreadMessagesWithBots",
      "query ThreadMessagesWithEdits",
      "query ThreadMessagesWithFlags",
    ]);
  });

  it("refuses only the gated flag documents on a server without message_flag", () => {
    const refused = refusedOperations(schemaWithoutMessageFlags(), documents);
    expect(refused.map((r) => r.label).sort()).toEqual([
      "mutation ClearMessageFlag",
      "query MessageChangesWithFlags",
      "query MessageReportWithAutomatic",
      "query MessageReportsWithAutomatic",
      "query MessagesWithBots",
      "query MessagesWithFlags",
      "query ThreadMessagesWithBots",
      "query ThreadMessagesWithFlags",
    ]);
  });

  it("refuses only the marker documents on a server without read_marker", () => {
    const schema = schemaWithoutFields({
      UnreadCount: ["unreadAfter"],
      Mutation: ["markAsUnread"],
    });
    expect(
      refusedOperations(schema, documents)
        .map((r) => r.label)
        .sort(),
    ).toEqual(["mutation MarkAsUnread", "query UnreadCountsWithMarkers"]);
  });

  it("refuses only the bot disclosure documents on a server without bot_disclosure", () => {
    const schema = schemaWithoutFields({
      User: ["isBot", "bot"],
      ServerMember: ["isBot", "bot"],
    });
    expect(
      refusedOperations(schema, documents)
        .map((r) => r.label)
        .sort(),
    ).toEqual([
      "query ApplyChannelLensWithBots",
      "query MessagesWithBots",
      "query PinnedMessagesWithBots",
      "query ServerMembersWithBots",
      "query ThreadMessagesWithBots",
    ]);
  });

  it("finds MessagesWithEdits valid on the current schema", () => {
    expect(documents.some((d) => d.text.includes("query MessagesWithEdits("))).toBe(true);
    expect(documents.some((d) => d.text.includes("query ThreadMessagesWithEdits("))).toBe(true);
    expect(documents.some((d) => d.text.includes("query MessagesWithFlags("))).toBe(true);
    expect(documents.some((d) => d.text.includes("query ThreadMessagesWithFlags("))).toBe(true);
    expect(refusedOperations(buildASTSchema(parse(SDL)), documents)).toEqual([]);
  });

  it("refuses only the leave and rename mutations on a server without them", () => {
    const refused = refusedOperations(schemaWithoutLeaveAndRename(), documents);
    expect(refused.map((r) => r.label).sort()).toEqual([
      "mutation LeaveWorkspace",
      "mutation RenameWorkspace",
    ]);
  });

  it("refuses only the member message deletion documents on a server without delete_member_messages", () => {
    const refused = refusedOperations(schemaWithoutMemberMessageDeletion(), documents);
    expect(refused.map((r) => r.label).sort()).toEqual([
      "mutation DeleteMemberMessages",
      "query MemberMessageCounts",
    ]);
  });

  it("refuses only the timeout reason query on a server without ServerMember.timeoutReason", () => {
    const schema = schemaWithoutFields({ ServerMember: ["timeoutReason"] });
    expect(refusedOperations(schema, documents).map((r) => r.label)).toEqual([
      "query MyTimeoutReason",
    ]);
  });

  it("refuses only the removals query on a server without Query.conversationMemberRemovals", () => {
    const schema = schemaWithoutFields({ Query: ["conversationMemberRemovals"] });
    expect(refusedOperations(schema, documents).map((r) => r.label)).toEqual([
      "query ConversationMemberRemovals",
    ]);
  });

  it("refuses only the bot management documents on a server without the bots API", () => {
    const schema = schemaWithoutFields({
      Query: ["bots", "botTokens", "incomingWebhooks"],
      Mutation: [
        "createBot",
        "updateBot",
        "deactivateBot",
        "createBotToken",
        "revokeBotToken",
        "createIncomingWebhook",
        "revokeIncomingWebhook",
      ],
    });
    expect(
      refusedOperations(schema, documents)
        .map((r) => r.label)
        .sort(),
    ).toEqual([
      "mutation CreateBot",
      "mutation CreateBotToken",
      "mutation CreateIncomingWebhook",
      "mutation DeactivateBot",
      "mutation RevokeBotToken",
      "mutation RevokeIncomingWebhook",
      "mutation UpdateBot",
      "query BotTokens",
      "query Bots",
      "query IncomingWebhooks",
    ]);
  });

  it("refuses only the webhook documents on a server without incoming webhooks", () => {
    const schema = schemaWithoutFields({
      Query: ["incomingWebhooks"],
      Mutation: ["createIncomingWebhook", "revokeIncomingWebhook"],
    });
    expect(
      refusedOperations(schema, documents)
        .map((r) => r.label)
        .sort(),
    ).toEqual([
      "mutation CreateIncomingWebhook",
      "mutation RevokeIncomingWebhook",
      "query IncomingWebhooks",
    ]);
  });
});
