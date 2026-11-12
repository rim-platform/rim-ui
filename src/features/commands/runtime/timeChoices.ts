import { PAUSE_DURATIONS } from "../../notifications/pauseCommand";
import { parseLocalDateTime } from "../../notifications/rules";
import { BAN_EXPIRY_PRESETS, TIMEOUT_PRESETS } from "../../workspaces/timeout";
import type { FieldValue, FieldValues } from "./argumentValues";

/**
 * A field that picks when something ends or how long it lasts, and sets one or more arguments:
 * - `banEnd`: when a ban ends, as `admin.ban`'s `expires_at` or `minutes`.
 * - `muteDuration`: how long a mute lasts, as `duration` with its `until` or `minutes`.
 * - `pauseMode`: the notifications pause, as `mode` with its `until` or `minutes`.
 * - `ttl`: when a state entry expires, as a number of seconds.
 * - `timeoutMinutes`: how long a timeout lasts, as a number of minutes.
 */
export type TimeFieldKind = "banEnd" | "muteDuration" | "pauseMode" | "ttl" | "timeoutMinutes";

const TIME_FIELD_KINDS: ReadonlySet<string> = new Set<TimeFieldKind>([
  "banEnd",
  "muteDuration",
  "pauseMode",
  "ttl",
  "timeoutMinutes",
]);

/** Whether a picker kind is one of the time fields. */
export function isTimeFieldKind(kind: string | undefined): kind is TimeFieldKind {
  return kind !== undefined && TIME_FIELD_KINDS.has(kind);
}

/** A unit a length of time is typed in. */
export type DurationUnit = "seconds" | "minutes" | "hours" | "days";

/** How many seconds one of each unit is. */
export const UNIT_SECONDS: Readonly<Record<DurationUnit, number>> = {
  seconds: 1,
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

/** The units from the largest to the smallest. */
const UNITS_LARGEST_FIRST: readonly DurationUnit[] = ["days", "hours", "minutes", "seconds"];

/**
 * One choice of a time field:
 * - `none`: sets `values` and nothing more.
 * - `count`: sets `values` and a number of minutes, hours or days.
 * - `at`: sets `values` and a date and time.
 */
export interface TimeChoice {
  id: string;
  label: string;
  input: "none" | "count" | "at";
  /** What the choice puts in the form's fields, besides its count or time. */
  values: Readonly<Record<string, string>>;
  /** Whether only a server that lists `command_relative_minutes` takes it. */
  relative?: boolean;
}

/** Where a time field puts a typed length of time. */
export interface CountSpec {
  /** The argument the length goes to. */
  name: string;
  /** How many seconds one of the argument's own units is: 60 for minutes, 1 for seconds. */
  unitSeconds: number;
  /** The units it is typed in, smallest first. */
  units: readonly DurationUnit[];
  /** The unit an empty length starts in. */
  defaultUnit: DurationUnit;
  /** The longest length the argument takes, in seconds. */
  maxSeconds?: number;
}

/** A time field: the arguments it sets and its choices. */
export interface TimeField {
  /** The arguments it sets, its own first. */
  names: readonly string[];
  count?: CountSpec;
  /** The argument a date and time goes to, as RFC 3339. */
  at?: string;
  choices: readonly TimeChoice[];
  /**
   * Whether a field with nothing chosen is a choice of its own: a select with an empty option
   * ("Ask when run", "Choose…"). False when the first choice stands for an empty field.
   */
  emptyChoice: boolean;
}

const FOR_A_LENGTH = "For a set length";

function minutesOf(seconds: number): string {
  return String(Math.round(seconds / 60));
}

/**
 * The time field of `kind`.
 *
 * @param kind - The field's kind.
 * @param labels - The labels of the lead argument's values, such as "Mute for 1 hour" for `1h`.
 */
export function timeField(
  kind: TimeFieldKind,
  labels: Readonly<Record<string, string>> = {},
): TimeField {
  const label = (value: string, fallback: string) => labels[value] ?? fallback;
  switch (kind) {
    case "banEnd":
      return {
        names: ["expires_at", "minutes"],
        count: {
          name: "minutes",
          unitSeconds: 60,
          units: ["minutes", "hours", "days"],
          defaultUnit: "days",
          maxSeconds: 5_256_000 * 60,
        },
        at: "expires_at",
        emptyChoice: false,
        choices: [
          { id: "none", label: "Until unbanned", input: "none", values: {} },
          ...BAN_EXPIRY_PRESETS.map((preset) => ({
            id: `for-${preset.id}`,
            label: `For ${preset.label}`,
            input: "none" as const,
            values: { minutes: minutesOf(preset.seconds) },
            relative: true,
          })),
          { id: "for", label: FOR_A_LENGTH, input: "count", values: {}, relative: true },
          { id: "at", label: "At a date and time", input: "at", values: {} },
        ],
      };
    case "muteDuration":
      return {
        names: ["duration", "until", "minutes"],
        count: {
          name: "minutes",
          unitSeconds: 60,
          units: ["minutes", "hours", "days"],
          defaultUnit: "hours",
          maxSeconds: 525_600 * 60,
        },
        at: "until",
        emptyChoice: true,
        choices: [
          ...(["1h", "8h", "until_tomorrow", "forever"] as const).map((duration) => ({
            id: duration,
            label: label(duration, duration),
            input: "none" as const,
            values: { duration },
          })),
          {
            id: "minutes",
            label: FOR_A_LENGTH,
            input: "count",
            values: { duration: "minutes" },
            relative: true,
          },
          {
            id: "until",
            label: label("until", "Until a time"),
            input: "at",
            values: { duration: "until" },
          },
        ],
      };
    case "pauseMode":
      return {
        names: ["mode", "until", "minutes"],
        count: {
          name: "minutes",
          unitSeconds: 60,
          units: ["minutes", "hours"],
          defaultUnit: "minutes",
          maxSeconds: 10_080 * 60,
        },
        at: "until",
        emptyChoice: true,
        choices: [
          {
            id: "on",
            label: label("on", "Until I turn it back on"),
            input: "none",
            values: { mode: "on" },
          },
          { id: "off", label: label("off", "Off"), input: "none", values: { mode: "off" } },
          ...PAUSE_DURATIONS.flatMap((pause) =>
            pause.minutes === undefined
              ? []
              : [
                  {
                    id: pause.id,
                    label: pause.label,
                    input: "none" as const,
                    values: { mode: "until", minutes: String(pause.minutes) },
                  },
                ],
          ),
          { id: "for", label: FOR_A_LENGTH, input: "count", values: { mode: "until" } },
          {
            id: "until",
            label: label("until", "Until a time"),
            input: "at",
            values: { mode: "until" },
          },
        ],
      };
    case "ttl":
      return {
        names: ["ttl"],
        count: {
          name: "ttl",
          unitSeconds: 1,
          units: ["minutes", "hours", "days"],
          defaultUnit: "hours",
        },
        emptyChoice: false,
        choices: [
          { id: "never", label: "Never expires", input: "none", values: {} },
          { id: "after", label: "Expires after", input: "count", values: {} },
        ],
      };
    case "timeoutMinutes":
      return {
        names: ["minutes"],
        count: {
          name: "minutes",
          unitSeconds: 60,
          units: ["minutes", "hours", "days"],
          defaultUnit: "minutes",
          maxSeconds: 43_200 * 60,
        },
        emptyChoice: true,
        choices: [
          ...TIMEOUT_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
            input: "none" as const,
            values: { minutes: minutesOf(preset.seconds) },
          })),
          { id: "for", label: "Another length", input: "count", values: {} },
        ],
      };
  }
}

/**
 * The form key that holds which choice of the time field led by `name` is picked. It is no
 * argument: the form keeps it so a choice stays picked while its count or time is still empty.
 */
export function choiceKey(name: string): string {
  return `${name}#choice`;
}

function textOf(value: FieldValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Whether `values` fit `choice`; with `strict`, its count or time must be filled in too. */
function fits(
  field: TimeField,
  choice: TimeChoice,
  values: Readonly<FieldValues>,
  strict: boolean,
): boolean {
  for (const [name, value] of Object.entries(choice.values)) {
    if (textOf(values[name]) !== value) return false;
  }
  for (const name of field.names) {
    if (name in choice.values) continue;
    const filled = textOf(values[name]) !== "";
    const own =
      (choice.input === "count" && name === field.count?.name) ||
      (choice.input === "at" && name === field.at);
    if (own) {
      if (strict && !filled) return false;
    } else if (filled) {
      return false;
    }
  }
  return true;
}

/**
 * The choice the form's values make: the one the form says is picked while the values fit it,
 * else the first the values fit, a preset before a typed length.
 *
 * @param field - The time field.
 * @param values - The form's values, the field's choice key among them.
 * @returns The choice, or `undefined` when nothing is chosen or the values fit no choice.
 */
export function chosenTimeChoice(
  field: TimeField,
  values: Readonly<FieldValues>,
): TimeChoice | undefined {
  const picked = values[choiceKey(field.names[0])];
  if (typeof picked === "string" && picked !== "") {
    const choice = field.choices.find((candidate) => candidate.id === picked);
    if (choice && fits(field, choice, values, false)) return choice;
  }
  return field.choices.find((choice) => fits(field, choice, values, true));
}

/**
 * The form values that pick `choice`: its values, the field's other arguments emptied, and its
 * count or time kept from `current` when the choice takes one.
 *
 * @param field - The time field.
 * @param choice - The choice, or `undefined` for none.
 * @param current - The form's values now.
 */
export function valuesForChoice(
  field: TimeField,
  choice: TimeChoice | undefined,
  current: Readonly<FieldValues>,
): FieldValues {
  const next: FieldValues = { [choiceKey(field.names[0])]: choice?.id ?? "" };
  for (const name of field.names) next[name] = choice?.values[name] ?? "";
  if (choice?.input === "count" && field.count) {
    next[field.count.name] = textOf(current[field.count.name]);
  }
  if (choice?.input === "at" && field.at) next[field.at] = textOf(current[field.at]);
  return next;
}

/** The arguments the chosen choice of `field` does not set, which the form sends nothing for. */
export function unusedTimeArguments(field: TimeField, values: Readonly<FieldValues>): string[] {
  const choice = chosenTimeChoice(field, values);
  return field.names.filter((name) => {
    if (!choice) return name !== field.names[0];
    if (name in choice.values) return false;
    if (choice.input === "count" && name === field.count?.name) return false;
    if (choice.input === "at" && name === field.at) return false;
    return true;
  });
}

/**
 * A length of time in words, in the largest unit that holds it whole, such as "7 days".
 *
 * @param seconds - The length.
 */
export function durationLabel(seconds: number): string {
  const unit = UNITS_LARGEST_FIRST.find((candidate) => seconds % UNIT_SECONDS[candidate] === 0);
  const count = seconds / UNIT_SECONDS[unit ?? "seconds"];
  const name = unit ?? "seconds";
  return `${count} ${count === 1 ? name.slice(0, -1) : name}`;
}

/**
 * Why the time field's values cannot be sent, or `null` when they can: a typed length that is not
 * a whole number above zero or is too long, or a time that is not a date in the future.
 *
 * @param field - The time field.
 * @param values - The form's values.
 * @param now - The time now, in milliseconds.
 */
export function timeFieldProblem(
  field: TimeField,
  values: Readonly<FieldValues>,
  now: number = Date.now(),
): string | null {
  const choice = chosenTimeChoice(field, values);
  if (!choice) return null;
  if (choice.input === "count" && field.count) {
    const raw = textOf(values[field.count.name]);
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return "Enter how long";
    const max = field.count.maxSeconds;
    if (max !== undefined && Number(raw) * field.count.unitSeconds > max) {
      return `At most ${durationLabel(max)}`;
    }
  }
  if (choice.input === "at" && field.at) {
    const raw = textOf(values[field.at]);
    const at = Date.parse(raw);
    if (raw === "" || Number.isNaN(at)) return "Pick a date and time";
    if (at <= now) return "Pick a time in the future";
  }
  return null;
}

/** A length as the count field shows it: a number and its unit. */
export interface CountInput {
  count: string;
  unit: DurationUnit;
}

/**
 * How a stored length is shown: in the largest of the field's units that holds it whole, or in
 * seconds when none does. An empty or unreadable length shows as an empty count.
 *
 * @param spec - Where the field puts the length.
 * @param stored - The length in the argument's own unit, as text.
 */
export function countInputOf(spec: CountSpec, stored: string): CountInput {
  if (!/^\d+$/.test(stored) || Number(stored) < 1) return { count: "", unit: spec.defaultUnit };
  const seconds = Number(stored) * spec.unitSeconds;
  const unit =
    [...spec.units].reverse().find((candidate) => seconds % UNIT_SECONDS[candidate] === 0) ??
    "seconds";
  return { count: String(seconds / UNIT_SECONDS[unit]), unit };
}

/**
 * The stored length a count and unit make, in the argument's own unit, or `""` when the count is
 * not a whole number above zero.
 *
 * @param spec - Where the field puts the length.
 * @param input - The typed count and its unit.
 */
export function storedCountOf(spec: CountSpec, input: CountInput): string {
  if (!/^\d+$/.test(input.count.trim()) || Number(input.count) < 1) return "";
  return String((Number(input.count) * UNIT_SECONDS[input.unit]) / spec.unitSeconds);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * An RFC 3339 time as a `datetime-local` input shows it, in this device's time, or `""` when it
 * is not a time.
 */
export function localInputOfIso(iso: string): string {
  const time = Date.parse(iso);
  if (iso === "" || Number.isNaN(time)) return "";
  const date = new Date(time);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** A `datetime-local` value, in this device's time, as RFC 3339, or `""` when it is not one. */
export function isoOfLocalInput(local: string): string {
  return parseLocalDateTime(local)?.toISOString() ?? "";
}
