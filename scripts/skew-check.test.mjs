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

describe("skew check", () => {
  const documents = collectDocuments();

  it("keeps every message query valid on a server without Message.editedAt", () => {
    const refused = refusedOperations(schemaWithoutEditTimes(), documents);
    expect(refused.map((r) => r.label).sort()).toEqual([
      "query MessagesWithEdits",
      "query ServerInfo",
      "query ThreadMessagesWithEdits",
    ]);
  });

  it("finds MessagesWithEdits valid on the current schema", () => {
    expect(documents.some((d) => d.text.includes("query MessagesWithEdits("))).toBe(true);
    expect(documents.some((d) => d.text.includes("query ThreadMessagesWithEdits("))).toBe(true);
    expect(refusedOperations(buildASTSchema(parse(SDL)), documents)).toEqual([]);
  });

  it("refuses only the leave and rename mutations on a server without them", () => {
    const refused = refusedOperations(schemaWithoutLeaveAndRename(), documents);
    expect(refused.map((r) => r.label).sort()).toEqual([
      "mutation LeaveWorkspace",
      "mutation RenameWorkspace",
    ]);
  });
});
