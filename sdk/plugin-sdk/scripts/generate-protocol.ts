/**
 * Generates `src/generated/protocol.ts` from the frozen protocol schema at
 * `protocol/plugin-protocol-v1.schema.json`, so the SDK's wire types cannot
 * drift from it. `test/protocol.test.ts` fails when the committed file is stale.
 *
 * Run from the repository root: `npm run sdk:generate`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Node = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(here, "../../../protocol/plugin-protocol-v1.schema.json");
export const OUTPUT_PATH = resolve(here, "../src/generated/protocol.ts");

const FRAME_SUFFIXES = ["Request", "Response", "Notification"];

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function doc(text: unknown, indent: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return [`${indent}/** ${text.replaceAll("*/", "*\\/")} */`];
}

function refName(ref: string): string {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(prefix.length);
}

function primitive(type: string): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "object":
      return "Record<string, unknown>";
    default:
      throw new Error(`unsupported type ${type}`);
  }
}

function union(parts: string[]): string {
  return [...new Set(parts)].join(" | ");
}

function typeOf(node: Node, indent: string): string {
  if (typeof node.$ref === "string") return refName(node.$ref);
  if ("const" in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return union(node.enum.map((v) => JSON.stringify(v)));
  if (Array.isArray(node.anyOf)) {
    return union(node.anyOf.map((branch) => typeOf(branch as Node, indent)));
  }
  if (Array.isArray(node.type)) return union(node.type.map((t) => primitive(String(t))));
  if (node.type === "array") {
    const item = isNode(node.items) ? typeOf(node.items, indent) : "unknown";
    return item.includes(" | ") ? `(${item})[]` : `${item}[]`;
  }
  if (node.type === "object" && isNode(node.properties)) return objectBody(node, indent);
  if (typeof node.type === "string") return primitive(node.type);
  return "unknown";
}

function objectBody(node: Node, indent: string): string {
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  const inner = `${indent}  `;
  const lines = ["{"];
  for (const [name, value] of Object.entries(node.properties as Node)) {
    const property = value as Node;
    lines.push(...doc(property.description, inner));
    const optional = required.has(name) ? "" : "?";
    lines.push(`${inner}${name}${optional}: ${typeOf(property, inner)};`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function methodKey(defName: string): string {
  const suffix = FRAME_SUFFIXES.find((s) => defName.endsWith(s)) ?? "";
  const base = defName.slice(0, defName.length - suffix.length);
  return base.charAt(0).toLowerCase() + base.slice(1);
}

/** The TypeScript source generated from `schema`. */
export function generateProtocol(schema: Node): string {
  const defs = schema.$defs as Record<string, Node>;
  const versionMatch = /-v(\d+)\.schema\.json$/.exec(String(schema.$id));
  if (!versionMatch) throw new Error("schema $id does not name a protocol version");
  const framing = schema["x-framing"] as Node;
  const errorCodes = schema["x-errorCodes"] as Record<string, string>;

  const out: string[] = [
    "// Generated from protocol/plugin-protocol-v1.schema.json by",
    "// sdk/plugin-sdk/scripts/generate-protocol.ts. Do not edit: run `npm run sdk:generate`.",
    "",
    "/** The protocol version these types describe. */",
    `export const PROTOCOL_VERSION = ${Number(versionMatch[1])};`,
    "",
    ...doc(framing.frame, ""),
    `export const MAX_FRAME_BYTES = ${Number(framing.maxFrameBytes)};`,
    "",
    "/** JSON-RPC error codes from the schema's x-errorCodes. */",
    "export const ErrorCode = {",
  ];
  for (const [code, text] of Object.entries(errorCodes)) {
    const separator = text.indexOf(":");
    const name = text.slice(0, separator);
    out.push(...doc(text.slice(separator + 1).trim(), "  "));
    out.push(`  ${name}: ${Number(code)},`);
  }
  out.push("} as const;", "");

  out.push("/** Method names of the frozen v1 frames. */", "export const Method = {");
  for (const [name, def] of Object.entries(defs)) {
    const method = isNode(def.properties) ? (def.properties.method as Node | undefined) : undefined;
    if (!method || !("const" in method) || name.endsWith("Response")) continue;
    out.push(`  ${methodKey(name)}: ${JSON.stringify(method.const)},`);
  }
  out.push("} as const;");

  for (const [name, def] of Object.entries(defs)) {
    out.push("", ...doc(def.description, ""));
    if (def.type === "object" && isNode(def.properties)) {
      out.push(`export interface ${name} ${objectBody(def, "")}`);
    } else {
      out.push(`export type ${name} = ${typeOf(def, "")};`);
    }
  }
  out.push("");
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Node;
  writeFileSync(OUTPUT_PATH, generateProtocol(schema));
  console.log(`wrote ${OUTPUT_PATH}`);
}
