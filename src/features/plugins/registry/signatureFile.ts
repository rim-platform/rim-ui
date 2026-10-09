// `<plugin_id>-<version>.rimsig.json`: a signed plugin manifest statement and the publisher's
// key log, for a moderator to verify and add to a workspace.
//
//   {"format":"rim-plugin-signature","v":1,"statement":{…},"publisherKeyLog":[…]}

import type { SignedStatementInput } from "../../../core/graphql/generated/schema-types";
import { findDuplicateKey } from "../web/bundle";

export const SIGNATURE_FORMAT = "rim-plugin-signature";

/** What a signature file holds. */
export interface SignatureFile {
  statement: SignedStatementInput;
  publisherKeyLog: SignedStatementInput[];
}

/** The file name of a statement's signature file, without a folder. */
export function signatureFileStem(pluginId: string, version: string): string {
  return `${pluginId}-${version}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function writeSignatureFile(file: SignatureFile): string {
  return `${JSON.stringify(
    {
      format: SIGNATURE_FORMAT,
      v: 1,
      statement: { payload: file.statement.payload, signature: file.statement.signature },
      publisherKeyLog: file.publisherKeyLog.map((s) => ({
        payload: s.payload,
        signature: s.signature,
      })),
    },
    null,
    2,
  )}\n`;
}

function statementOf(value: unknown): SignedStatementInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { payload, signature, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  return typeof payload === "string" && typeof signature === "string"
    ? { payload, signature }
    : null;
}

/** Read a signature file; refuses anything else with the reason. */
export function readSignatureFile(text: string): SignatureFile {
  const refused = (why: string) => new Error(`Not a plugin signature file: ${why}.`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw refused("it is not JSON");
  }
  if (findDuplicateKey(text) !== null) throw refused("a field appears twice");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw refused("not an object");
  const { format, v, statement, publisherKeyLog, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw refused(`unknown field ${Object.keys(rest)[0]}`);
  if (format !== SIGNATURE_FORMAT || v !== 1) throw refused("wrong format or version");
  const signed = statementOf(statement);
  if (!signed) throw refused("the statement is missing");
  if (!Array.isArray(publisherKeyLog)) throw refused("the publisher's key log is missing");
  const log = publisherKeyLog.map(statementOf);
  if (log.some((s) => s === null)) throw refused("the publisher's key log is malformed");
  return { statement: signed, publisherKeyLog: log as SignedStatementInput[] };
}
