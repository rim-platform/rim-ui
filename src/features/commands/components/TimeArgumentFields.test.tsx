import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const hasCapability = vi.hoisted(() => vi.fn());

vi.mock("../../updater/hooks/useSpaceHasCapability", () => ({
  useSpaceHasCapability: (...args: unknown[]) => hasCapability(...args),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { readFields, type FieldValue, type FieldValues } from "../runtime/argumentValues";
import type { CommandArgumentInfo } from "../types";
import { ArgumentFieldList, type ArgumentFormMode } from "./ArgumentFields";

function argument(
  name: string,
  title: string,
  argumentType: CommandArgumentType,
  overrides: Partial<CommandArgumentInfo> = {},
): CommandArgumentInfo {
  return { name, title, argumentType, required: false, ...overrides };
}

const UNTIL = argument("until", "Until", CommandArgumentType.STRING);
const MINUTES = argument("minutes", "Minutes", CommandArgumentType.INTEGER);
const BAN = [argument("expires_at", "Expires", CommandArgumentType.STRING), MINUTES];
const MUTE = [
  argument("duration", "Duration", CommandArgumentType.ENUM, {
    required: true,
    allowedValues: ["1h", "8h", "until_tomorrow", "forever", "until", "minutes"],
  }),
  UNTIL,
  MINUTES,
];
const DND = [
  argument("mode", "Mode", CommandArgumentType.ENUM, {
    required: true,
    allowedValues: ["on", "off", "until"],
  }),
  UNTIL,
  MINUTES,
];
const TTL = [argument("ttl", "Expires after (seconds)", CommandArgumentType.INTEGER)];
const TIMEOUT = [{ ...MINUTES, required: true }];

let latest: FieldValues = {};

/** A form of `fields` for `commandId` that keeps its own values, as the real forms do. */
function Form({
  commandId,
  fields,
  initial = {},
  mode = "preset",
}: {
  commandId: string;
  fields: CommandArgumentInfo[];
  initial?: FieldValues;
  mode?: ArgumentFormMode;
}) {
  const [values, setValues] = useState<FieldValues>(() => {
    latest = { ...Object.fromEntries(fields.map((f) => [f.name, ""])), ...initial };
    return latest;
  });
  const apply = (changes: Readonly<FieldValues>) =>
    setValues((current) => {
      latest = { ...current, ...changes };
      return latest;
    });
  return (
    <ArgumentFieldList
      fields={fields}
      values={values}
      onChange={(name: string, value: FieldValue) => apply({ [name]: value })}
      onChangeFields={apply}
      mode={mode}
      workspaceId="ws-1"
      commandId={commandId}
    />
  );
}

function read(commandId: string, fields: CommandArgumentInfo[], mustFill = false) {
  return readFields(fields, latest, mustFill, commandId);
}

function optionLabels(select: HTMLElement): (string | null)[] {
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);
}

/** The RFC 3339 time a `datetime-local` value names on this device's clock. */
function isoOf(local: string): string {
  return new Date(local).toISOString();
}

beforeEach(() => {
  hasCapability.mockReset();
  hasCapability.mockReturnValue(true);
});

describe("ban end", () => {
  it("offers its presets, a length and a date as one field, and sends what each choice sets", async () => {
    const user = userEvent.setup();
    render(<Form commandId="admin.ban" fields={BAN} />);
    const field = screen.getByLabelText("Ban ends (optional)");
    expect(optionLabels(field)).toEqual([
      "Until unbanned",
      "For 1 day",
      "For 7 days",
      "For 30 days",
      "For a set length",
      "At a date and time",
    ]);
    expect(screen.queryByLabelText(/^Minutes/)).toBeNull();
    expect(hasCapability).toHaveBeenCalledWith("ws-1", "command_relative_minutes");
    expect(read("admin.ban", BAN)).toEqual({ ok: true, args: {} });

    await user.selectOptions(field, "For 7 days");
    expect(read("admin.ban", BAN)).toEqual({ ok: true, args: { minutes: 7 * 24 * 60 } });

    await user.selectOptions(field, "For a set length");
    expect(screen.getByLabelText("Ban ends: how many")).toHaveValue("7");
    expect(screen.getByLabelText("Ban ends: unit")).toHaveValue("days");
    await user.clear(screen.getByLabelText("Ban ends: how many"));
    await user.type(screen.getByLabelText("Ban ends: how many"), "2");
    await user.selectOptions(screen.getByLabelText("Ban ends: unit"), "hours");
    expect(read("admin.ban", BAN)).toEqual({ ok: true, args: { minutes: 120 } });

    await user.selectOptions(field, "At a date and time");
    expect(screen.queryByLabelText("Ban ends: how many")).toBeNull();
    expect(read("admin.ban", BAN)).toEqual({
      ok: false,
      problems: { expires_at: "Pick a date and time" },
    });
    fireEvent.change(screen.getByLabelText("Ban ends: date and time"), {
      target: { value: "2999-01-02T10:30" },
    });
    expect(read("admin.ban", BAN)).toEqual({
      ok: true,
      args: { expires_at: isoOf("2999-01-02T10:30") },
    });

    await user.selectOptions(field, "Until unbanned");
    expect(read("admin.ban", BAN)).toEqual({ ok: true, args: {} });
  });

  it("keeps an empty length from banning for good", async () => {
    const user = userEvent.setup();
    render(<Form commandId="admin.ban" fields={BAN} />);
    await user.selectOptions(screen.getByLabelText("Ban ends (optional)"), "For a set length");

    expect(read("admin.ban", BAN)).toEqual({
      ok: false,
      problems: { expires_at: "Enter how long" },
    });
  });

  it("offers only a fixed end on a server that takes no relative minutes", () => {
    hasCapability.mockReturnValue(false);
    render(<Form commandId="admin.ban" fields={BAN} />);

    expect(optionLabels(screen.getByLabelText("Ban ends (optional)"))).toEqual([
      "Until unbanned",
      "At a date and time",
    ]);
    expect(screen.getByText("This server only takes a fixed end.")).toBeInTheDocument();
  });

  it("shows saved minutes and a saved time as their choices", () => {
    const { unmount } = render(
      <Form commandId="admin.ban" fields={BAN} initial={{ minutes: "1440" }} />,
    );
    expect(screen.getByLabelText("Ban ends (optional)")).toHaveValue("for-1d");
    unmount();

    const second = render(<Form commandId="admin.ban" fields={BAN} initial={{ minutes: "90" }} />);
    expect(screen.getByLabelText("Ban ends (optional)")).toHaveValue("for");
    expect(screen.getByLabelText("Ban ends: how many")).toHaveValue("90");
    expect(screen.getByLabelText("Ban ends: unit")).toHaveValue("minutes");
    second.unmount();

    hasCapability.mockReturnValue(false);
    const iso = isoOf("2999-03-04T08:15");
    render(<Form commandId="admin.ban" fields={BAN} initial={{ expires_at: iso }} />);
    expect(screen.getByLabelText("Ban ends (optional)")).toHaveValue("at");
    expect(screen.getByLabelText("Ban ends: date and time")).toHaveValue("2999-03-04T08:15");
  });

  it("keeps a saved length shown on a server that takes no relative minutes", () => {
    hasCapability.mockReturnValue(false);
    render(<Form commandId="admin.ban" fields={BAN} initial={{ minutes: "10080" }} />);

    const field = screen.getByLabelText("Ban ends (optional)");
    expect(field).toHaveValue("for-7d");
    expect(optionLabels(field)).toEqual(["Until unbanned", "For 7 days", "At a date and time"]);
  });
});

describe("mute duration", () => {
  it("sends the duration with only the count or time its choice takes", async () => {
    const user = userEvent.setup();
    render(<Form commandId="notifications.mute_conversation" fields={MUTE} />);
    const field = screen.getByLabelText("How long");
    expect(optionLabels(field)).toEqual([
      "Ask when run",
      "Mute for 1 hour",
      "Mute for 8 hours",
      "Mute until tomorrow",
      "Until I unmute it",
      "For a set length",
      "Until a time",
    ]);
    expect(screen.queryByLabelText(/^Until/)).toBeNull();

    await user.selectOptions(field, "For a set length");
    await user.type(screen.getByLabelText("How long: how many"), "3");
    await user.selectOptions(screen.getByLabelText("How long: unit"), "days");
    expect(read("notifications.mute_conversation", MUTE)).toEqual({
      ok: true,
      args: { duration: "minutes", minutes: 3 * 24 * 60 },
    });

    await user.selectOptions(field, "Until a time");
    expect(screen.queryByLabelText("How long: how many")).toBeNull();
    fireEvent.change(screen.getByLabelText("How long: date and time"), {
      target: { value: "2999-05-06T17:00" },
    });
    expect(read("notifications.mute_conversation", MUTE)).toEqual({
      ok: true,
      args: { duration: "until", until: isoOf("2999-05-06T17:00") },
    });

    await user.selectOptions(field, "Mute until tomorrow");
    expect(read("notifications.mute_conversation", MUTE)).toEqual({
      ok: true,
      args: { duration: "until_tomorrow" },
    });
  });

  it("refuses a time that has passed", async () => {
    const user = userEvent.setup();
    render(<Form commandId="notifications.mute_conversation" fields={MUTE} mode="ask" />);
    await user.selectOptions(screen.getByLabelText("How long"), "Until a time");
    fireEvent.change(screen.getByLabelText("How long: date and time"), {
      target: { value: "2000-01-01T09:00" },
    });

    expect(read("notifications.mute_conversation", MUTE, true)).toEqual({
      ok: false,
      problems: { duration: "Pick a time in the future" },
    });
  });

  it("leaves out the length on a server that takes no relative minutes", () => {
    hasCapability.mockReturnValue(false);
    render(<Form commandId="notifications.mute_conversation" fields={MUTE} mode="ask" />);

    const field = screen.getByLabelText("How long");
    expect(optionLabels(field)).not.toContain("For a set length");
    expect(optionLabels(field)[0]).toBe("Choose…");
    expect(screen.getByText("This server only takes a fixed end.")).toBeInTheDocument();
  });

  it("shows a saved count as its length, and sends nothing a saved duration does not use", () => {
    const { unmount } = render(
      <Form
        commandId="notifications.mute_conversation"
        fields={MUTE}
        initial={{ duration: "minutes", minutes: "120" }}
      />,
    );
    expect(screen.getByLabelText("How long")).toHaveValue("minutes");
    expect(screen.getByLabelText("How long: how many")).toHaveValue("2");
    expect(screen.getByLabelText("How long: unit")).toHaveValue("hours");
    unmount();

    render(
      <Form
        commandId="notifications.mute_conversation"
        fields={MUTE}
        initial={{ duration: "1h", minutes: "5" }}
      />,
    );
    expect(read("notifications.mute_conversation", MUTE)).toEqual({
      ok: true,
      args: { duration: "1h" },
    });
  });
});

describe("notifications pause", () => {
  it("offers the pauses as minutes, a length in minutes or hours, and a time", async () => {
    const user = userEvent.setup();
    hasCapability.mockReturnValue(false);
    render(<Form commandId="notifications.dnd" fields={DND} />);
    const field = screen.getByLabelText("Pause");
    expect(optionLabels(field)).toEqual([
      "Ask when run",
      "Until I turn it back on",
      "Off",
      "For 1 hour",
      "For 8 hours",
      "For a set length",
      "Until a time",
    ]);
    expect(screen.queryByText("This server only takes a fixed end.")).toBeNull();

    await user.selectOptions(field, "For 8 hours");
    expect(read("notifications.dnd", DND)).toEqual({
      ok: true,
      args: { mode: "until", minutes: 480 },
    });

    await user.selectOptions(field, "For a set length");
    expect(optionLabels(screen.getByLabelText("Pause: unit"))).toEqual(["minutes", "hours"]);
    expect(screen.getByLabelText("Pause: how many")).toHaveValue("8");
    expect(screen.getByLabelText("Pause: unit")).toHaveValue("hours");
    await user.selectOptions(screen.getByLabelText("Pause: unit"), "minutes");
    await user.clear(screen.getByLabelText("Pause: how many"));
    await user.type(screen.getByLabelText("Pause: how many"), "25");
    expect(read("notifications.dnd", DND)).toEqual({
      ok: true,
      args: { mode: "until", minutes: 25 },
    });

    await user.selectOptions(field, "Until a time");
    fireEvent.change(screen.getByLabelText("Pause: date and time"), {
      target: { value: "2999-07-08T12:00" },
    });
    expect(read("notifications.dnd", DND)).toEqual({
      ok: true,
      args: { mode: "until", until: isoOf("2999-07-08T12:00") },
    });

    await user.selectOptions(field, "Off");
    expect(read("notifications.dnd", DND)).toEqual({ ok: true, args: { mode: "off" } });
  });

  it("refuses a pause longer than a week", async () => {
    const user = userEvent.setup();
    render(<Form commandId="notifications.dnd" fields={DND} />);
    await user.selectOptions(screen.getByLabelText("Pause"), "For a set length");
    await user.type(screen.getByLabelText("Pause: how many"), "200");
    await user.selectOptions(screen.getByLabelText("Pause: unit"), "hours");

    expect(read("notifications.dnd", DND)).toEqual({
      ok: false,
      problems: { mode: "At most 7 days" },
    });
  });
});

describe("state entry expiry", () => {
  it("stores a length in seconds, or nothing for never", async () => {
    const user = userEvent.setup();
    render(<Form commandId="state.set" fields={TTL} />);
    const field = screen.getByLabelText("Expires (optional)");
    expect(optionLabels(field)).toEqual(["Never expires", "Expires after"]);
    expect(read("state.set", TTL)).toEqual({ ok: true, args: {} });

    await user.selectOptions(field, "Expires after");
    await user.type(screen.getByLabelText("Expires: how many"), "2");
    await user.selectOptions(screen.getByLabelText("Expires: unit"), "days");
    expect(read("state.set", TTL)).toEqual({ ok: true, args: { ttl: 2 * 24 * 60 * 60 } });

    await user.selectOptions(field, "Never expires");
    expect(read("state.set", TTL)).toEqual({ ok: true, args: {} });
  });

  it("shows saved seconds in the largest unit that holds them whole", () => {
    const { unmount } = render(
      <Form commandId="state.set" fields={TTL} initial={{ ttl: "7200" }} />,
    );
    expect(screen.getByLabelText("Expires (optional)")).toHaveValue("after");
    expect(screen.getByLabelText("Expires: how many")).toHaveValue("2");
    expect(screen.getByLabelText("Expires: unit")).toHaveValue("hours");
    expect(read("state.set", TTL)).toEqual({ ok: true, args: { ttl: 7200 } });
    unmount();

    render(<Form commandId="state.set" fields={TTL} initial={{ ttl: "90" }} />);
    expect(screen.getByLabelText("Expires: how many")).toHaveValue("90");
    expect(screen.getByLabelText("Expires: unit")).toHaveValue("seconds");
  });

  it("sends the seconds as text to a server that declares them as text", async () => {
    const user = userEvent.setup();
    const text = [{ ...TTL[0], argumentType: CommandArgumentType.STRING }];
    render(<Form commandId="state.set" fields={text} />);
    await user.selectOptions(screen.getByLabelText("Expires (optional)"), "Expires after");
    await user.type(screen.getByLabelText("Expires: how many"), "5");
    await user.selectOptions(screen.getByLabelText("Expires: unit"), "minutes");

    expect(read("state.set", text)).toEqual({ ok: true, args: { ttl: "300" } });
  });
});

describe("timeout length", () => {
  it("offers the timeout presets and another length in minutes", async () => {
    const user = userEvent.setup();
    render(<Form commandId="admin.timeout" fields={TIMEOUT} mode="ask" />);
    const field = screen.getByLabelText("How long");
    expect(optionLabels(field)).toEqual([
      "Choose…",
      "10 minutes",
      "1 hour",
      "1 day",
      "1 week",
      "Another length",
    ]);
    expect(read("admin.timeout", TIMEOUT, true)).toEqual({
      ok: false,
      problems: { minutes: "How long is required" },
    });

    await user.selectOptions(field, "1 day");
    expect(read("admin.timeout", TIMEOUT, true)).toEqual({ ok: true, args: { minutes: 1440 } });

    await user.selectOptions(field, "Another length");
    await user.clear(screen.getByLabelText("How long: how many"));
    await user.type(screen.getByLabelText("How long: how many"), "45");
    await user.selectOptions(screen.getByLabelText("How long: unit"), "minutes");
    expect(read("admin.timeout", TIMEOUT, true)).toEqual({ ok: true, args: { minutes: 45 } });

    await user.clear(screen.getByLabelText("How long: how many"));
    await user.type(screen.getByLabelText("How long: how many"), "31");
    await user.selectOptions(screen.getByLabelText("How long: unit"), "days");
    expect(read("admin.timeout", TIMEOUT, true)).toEqual({
      ok: false,
      problems: { minutes: "At most 30 days" },
    });
  });

  it("shows a saved number of minutes as its preset, else as another length", () => {
    const { unmount } = render(
      <Form commandId="admin.timeout" fields={TIMEOUT} initial={{ minutes: "60" }} />,
    );
    expect(screen.getByLabelText("How long")).toHaveValue("1h");
    unmount();

    render(<Form commandId="admin.timeout" fields={TIMEOUT} initial={{ minutes: "180" }} />);
    expect(screen.getByLabelText("How long")).toHaveValue("for");
    expect(screen.getByLabelText("How long: how many")).toHaveValue("3");
    expect(screen.getByLabelText("How long: unit")).toHaveValue("hours");
  });
});
