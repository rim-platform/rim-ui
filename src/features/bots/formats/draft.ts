/** A condition of a rule as the editor holds it: a header or a body field, and the text it must equal. */
export interface DraftCondition {
  key: string;
  kind: "header" | "field";
  name: string;
  equals: string;
}

/** A rule as the editor holds it, with a key of its own for React. */
export interface DraftRule {
  key: string;
  conditions: DraftCondition[];
  post: string;
  /** The link after the text; `null` for none. */
  link: { value: string; origin: string } | null;
}

let nextKey = 0;

/** A key for a new rule or condition, unique in this page. */
export function draftKey(): string {
  nextKey += 1;
  return `k${nextKey}`;
}

/** An empty rule with no conditions, which always holds. */
export function blankRule(): DraftRule {
  return { key: draftKey(), conditions: [], post: "", link: null };
}

/** A new condition on a body field. */
export function blankCondition(): DraftCondition {
  return { key: draftKey(), kind: "field", name: "", equals: "" };
}

/**
 * The format JSON the server checks, written from the editor's rules. A rule's link is left out
 * when both its parts are empty.
 */
export function draftToFormat(rules: DraftRule[]): {
  version: 1;
  rules: Record<string, unknown>[];
} {
  return {
    version: 1,
    rules: rules.map((rule) => {
      const written: Record<string, unknown> = {
        when: rule.conditions.map((c) =>
          c.kind === "header"
            ? { header: c.name, equals: c.equals }
            : { field: c.name, equals: c.equals },
        ),
        post: rule.post,
      };
      if (rule.link && (rule.link.value || rule.link.origin)) {
        written.link = { value: rule.link.value, origin: rule.link.origin };
      }
      return written;
    }),
  };
}

/** What a JSON value is called in a refusal of pasted JSON. */
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

function unknownKey(value: Record<string, unknown>, known: string[]): string | undefined {
  return Object.keys(value).find((key) => !known.includes(key));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The editor's rules read from a format's JSON, such as one pasted in or a ready-made one. The
 * shape is checked as the server checks it, so an unknown key or a wrong type is named rather
 * than dropped; the server still checks everything else when the format is tried or saved.
 *
 * @returns The rules, or the reason the JSON is no format.
 */
export function formatToDraft(json: unknown): { rules: DraftRule[] } | { error: string } {
  if (!isObject(json)) return { error: `A format is an object, not ${shapeOf(json)}.` };
  const extra = unknownKey(json, ["version", "rules"]);
  if (extra) return { error: `A format has no key \`${extra}\`.` };
  if (json.version !== 1) return { error: "Only `version` 1 is known." };
  if (!Array.isArray(json.rules)) return { error: "`rules` is a list." };
  const rules: DraftRule[] = [];
  for (const [at, raw] of json.rules.entries()) {
    const n = at + 1;
    if (!isObject(raw)) return { error: `Rule ${n} is ${shapeOf(raw)}, not an object.` };
    const ruleExtra = unknownKey(raw, ["when", "post", "link"]);
    if (ruleExtra) return { error: `Rule ${n} has no key \`${ruleExtra}\`.` };
    if (typeof raw.post !== "string") return { error: `Rule ${n} needs a \`post\` text.` };
    const when = raw.when ?? [];
    if (!Array.isArray(when)) return { error: `Rule ${n}: \`when\` is a list.` };
    const conditions: DraftCondition[] = [];
    for (const c of when) {
      if (!isObject(c)) return { error: `Rule ${n}: a condition is an object.` };
      const conditionExtra = unknownKey(c, ["header", "field", "equals"]);
      if (conditionExtra)
        return { error: `Rule ${n}: a condition has no key \`${conditionExtra}\`.` };
      if (typeof c.equals !== "string") {
        return { error: `Rule ${n}: \`equals\` is a string, such as "true".` };
      }
      const header = typeof c.header === "string" ? c.header : null;
      const field = typeof c.field === "string" ? c.field : null;
      if ((header === null) === (field === null)) {
        return { error: `Rule ${n}: a condition has either \`header\` or \`field\`.` };
      }
      conditions.push({
        key: draftKey(),
        kind: header !== null ? "header" : "field",
        name: header ?? field ?? "",
        equals: c.equals,
      });
    }
    let link: DraftRule["link"] = null;
    if (raw.link !== undefined && raw.link !== null) {
      if (!isObject(raw.link)) return { error: `Rule ${n}: \`link\` is an object.` };
      const linkExtra = unknownKey(raw.link, ["value", "origin"]);
      if (linkExtra) return { error: `Rule ${n}: \`link\` has no key \`${linkExtra}\`.` };
      if (typeof raw.link.value !== "string" || typeof raw.link.origin !== "string") {
        return { error: `Rule ${n}: \`link\` has a \`value\` and an \`origin\`, both text.` };
      }
      link = { value: raw.link.value, origin: raw.link.origin };
    }
    rules.push({ key: draftKey(), conditions, post: raw.post, link });
  }
  return { rules };
}

/**
 * Where a refusal from the server belongs: the rule its message names ("Rule 2: ..."),
 * counted from 1, and the message without that prefix; no rule for a refusal of the whole format.
 */
export function placeRefusal(message: string): { rule: number | null; reason: string } {
  const named = /^Rule (\d+): (.*)$/s.exec(message);
  return named ? { rule: Number(named[1]), reason: named[2] } : { rule: null, reason: message };
}
