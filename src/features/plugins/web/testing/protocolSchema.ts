// Checks a message against a `$defs` entry of protocol/plugin-protocol-v1.schema.json,
// with the JSON Schema keywords that file uses.

import schema from "../../../../../protocol/plugin-protocol-v1.schema.json";

type Schema = Record<string, unknown>;

const defs = (schema as { $defs: Record<string, Schema> }).$defs;

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

/** Every way `value` breaks `node`, as paths with a reason; empty when it conforms. */
function problems(node: Schema, value: unknown, path: string): string[] {
  if (typeof node.$ref === "string") {
    const name = node.$ref.replace("#/$defs/", "");
    return problems(defs[name], value, path);
  }
  const found: string[] = [];
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? (node.type as string[]) : [node.type as string];
    if (!types.some((t) => typeMatches(t, value))) return [`${path}: not ${types.join(" or ")}`];
  }
  if ("const" in node && JSON.stringify(node.const) !== JSON.stringify(value)) {
    found.push(`${path}: not ${JSON.stringify(node.const)}`);
  }
  if (
    Array.isArray(node.enum) &&
    !node.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))
  ) {
    found.push(`${path}: not one of ${JSON.stringify(node.enum)}`);
  }
  if (
    Array.isArray(node.anyOf) &&
    !node.anyOf.some((branch) => problems(branch as Schema, value, path).length === 0)
  ) {
    found.push(`${path}: matches no anyOf branch`);
  }
  if (node.not && problems(node.not as Schema, value, path).length === 0) {
    found.push(`${path}: matches what it must not`);
  }
  if (typeof value === "string") {
    if (typeof node.minLength === "number" && value.length < node.minLength)
      found.push(`${path}: too short`);
    if (typeof node.pattern === "string" && !new RegExp(node.pattern, "u").test(value)) {
      found.push(`${path}: does not match ${node.pattern}`);
    }
  }
  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum)
      found.push(`${path}: below ${node.minimum}`);
    if (typeof node.maximum === "number" && value > node.maximum)
      found.push(`${path}: above ${node.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === "number" && value.length < node.minItems)
      found.push(`${path}: too few items`);
    if (typeof node.maxItems === "number" && value.length > node.maxItems)
      found.push(`${path}: too many items`);
    if (node.items)
      value.forEach((item, i) =>
        found.push(...problems(node.items as Schema, item, `${path}[${i}]`)),
      );
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (node.properties ?? {}) as Record<string, Schema>;
    for (const key of (node.required as string[] | undefined) ?? []) {
      if (!(key in object)) found.push(`${path}.${key}: missing`);
    }
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) found.push(...problems(properties[key], item, `${path}.${key}`));
      else if (node.additionalProperties === false) found.push(`${path}.${key}: not allowed`);
      else if (typeof node.additionalProperties === "object") {
        found.push(...problems(node.additionalProperties as Schema, item, `${path}.${key}`));
      }
    }
  }
  return found;
}

/** Why `message` is not a valid `$defs[name]`; empty when it is. */
export function schemaProblems(name: string, message: unknown): string[] {
  const node = defs[name];
  if (!node) return [`no $defs entry ${name}`];
  return problems(node, message, name);
}

/** The `$defs` entry a host-to-plugin message must match, by its method or shape. */
export function hostMessageDef(message: Record<string, unknown>): string {
  switch (message.method) {
    case "rim.handshake":
      return "HandshakeRequest";
    case "rim.heartbeat":
      return "HeartbeatRequest";
    case "rim.command.execute":
      return "CommandExecuteRequest";
    case "rim.principal.changed":
      return "PrincipalChangedNotification";
    case "rim.principals.remapped":
      return "PrincipalsRemappedNotification";
    case "rim.shutdown":
      return "ShutdownNotification";
    default:
      return "error" in message ? "ErrorResponse" : "LogResponse";
  }
}
