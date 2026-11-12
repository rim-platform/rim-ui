import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const stateList = vi.fn();
const stateEntry = vi.fn();
const conversation = vi.fn();

vi.mock("../../workspace-state/api/useWorkspaceState", () => ({
  useWorkspaceStateList: (...args: unknown[]) => stateList(...args),
  useWorkspaceState: (...args: unknown[]) => stateEntry(...args),
}));
vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: (...args: unknown[]) => conversation(...args),
}));
vi.mock("./paletteTargets", () => ({
  useChannelTargets: () => ({ items: [], isPending: false }),
  useJoinableTargets: () => ({ items: [], isPending: false }),
  useMacroTargets: () => ({
    items: [{ id: "user.standup", serverId: "", label: "Standup" }],
    isPending: false,
  }),
  usePipelineTargets: () => ({
    items: [{ id: "pipe-1", serverId: "ws-1", label: "Alerts (on)" }],
    isPending: false,
  }),
}));
vi.mock("../../home/api/useHomeWorkspaces", () => ({
  useHomeWorkspaces: () => ({
    workspaces: [
      { id: "ws-1", label: "Acme" },
      { id: "ws-2", label: "Side project" },
    ],
    isPending: false,
  }),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { CLEARED_FIELD } from "../runtime/argumentPickers";
import { readFields, type FieldValue, type FieldValues } from "../runtime/argumentValues";
import type { CommandArgumentInfo } from "../types";
import { ArgumentField, ArgumentFieldList, type ArgumentFormMode } from "./ArgumentFields";

function stringArgument(name: string, title: string, required = true): CommandArgumentInfo {
  return { name, title, argumentType: CommandArgumentType.STRING, required };
}

const KEY = stringArgument("key", "Key");
const VALUE = stringArgument("value", "Value");
const SCOPE: CommandArgumentInfo = {
  ...stringArgument("scope", "Scope", false),
  allowedValues: ["server", "user"],
  defaultValue: "server",
};
const TOPIC = stringArgument("topic", "Topic");

const ENTRIES = [
  { key: "deploy.count", value: 7 },
  { key: "deploy.paused", value: true },
  { key: "greeting", value: "hello" },
  { key: "config", value: { a: 1 } },
];

/** A form of `fields` for `commandId` that keeps its own values, as the real forms do. */
function Form({
  commandId,
  fields,
  initial,
  mode = "preset",
  givenValues,
  onValues,
}: {
  commandId: string;
  fields: CommandArgumentInfo[];
  initial: FieldValues;
  mode?: ArgumentFormMode;
  givenValues?: FieldValues;
  onValues?: (values: FieldValues) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <ArgumentFieldList
      fields={fields}
      values={values}
      onChange={(name: string, value: FieldValue) => {
        const next = { ...values, [name]: value };
        setValues(next);
        onValues?.(next);
      }}
      mode={mode}
      workspaceId="ws-1"
      commandId={commandId}
      givenValues={givenValues}
    />
  );
}

beforeEach(() => {
  stateList.mockReset();
  stateList.mockReturnValue({ data: ENTRIES, isPending: false });
  stateEntry.mockReset();
  stateEntry.mockReturnValue({ data: undefined, isPending: false });
  conversation.mockReset();
  conversation.mockReturnValue({ data: undefined });
});

describe("value labels", () => {
  it("names the state scopes as Settings does", () => {
    render(
      <ArgumentField
        argument={SCOPE}
        value=""
        onChange={vi.fn()}
        mode="preset"
        commandId="state.get"
      />,
    );
    const options = within(screen.getByLabelText(/Scope/)).getAllByRole("option");
    expect(options.map((o) => [o.getAttribute("value"), o.textContent])).toEqual([
      ["", "Default"],
      ["server", "Workspace (everyone)"],
      ["user", "Only me"],
    ]);
  });

  it("keeps the plain labels for a command the map does not name", () => {
    render(
      <ArgumentField argument={SCOPE} value="" onChange={vi.fn()} mode="preset" commandId="x.y" />,
    );
    expect(screen.getByRole("option", { name: "Server" })).toBeInTheDocument();
  });
});

describe("state key field", () => {
  it("suggests the scope's keys with their values and picks one with the keyboard", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    render(<Form commandId="state.get" fields={[KEY]} initial={{ key: "" }} onValues={onValues} />);
    const field = screen.getByRole("combobox", { name: "Key" });
    await user.click(field);
    await user.type(field, "deploy");
    const list = screen.getByRole("listbox", { name: "Keys" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["deploy.count7", "deploy.pausedtrue"]);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(field).toHaveValue("deploy.paused");
    expect(onValues).toHaveBeenLastCalledWith({ key: "deploy.paused" });
    expect(screen.getByRole("listbox", { hidden: true })).not.toBeVisible();
  });

  it("lists the keys of the scope the form picks, the workspace's by default", () => {
    render(<Form commandId="state.get" fields={[KEY, SCOPE]} initial={{ key: "", scope: "" }} />);
    expect(stateList).toHaveBeenLastCalledWith("ws-1", "", "SERVER");
    fireEvent.change(screen.getByLabelText(/Scope/), { target: { value: "user" } });
    expect(stateList).toHaveBeenLastCalledWith("ws-1", "", "USER");
  });

  it("says a typed key is new, or which rule it breaks", async () => {
    const user = userEvent.setup();
    render(<Form commandId="state.set" fields={[KEY]} initial={{ key: "" }} />);
    const field = screen.getByRole("combobox", { name: "Key" });
    await user.type(field, "release.week");
    expect(screen.getByText("New key")).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "Release");
    expect(screen.getByText("A key starts with a lowercase letter")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    await user.clear(field);
    await user.type(field, "system.flags");
    expect(
      screen.getByText("Keys starting with system. are kept for the workspace itself"),
    ).toBeInTheDocument();
  });

  it("says nothing for a key that exists, and allows system keys to a read", async () => {
    const user = userEvent.setup();
    render(<Form commandId="state.get" fields={[KEY]} initial={{ key: "" }} />);
    const field = screen.getByRole("combobox", { name: "Key" });
    await user.type(field, "greeting");
    expect(screen.queryByText("New key")).toBeNull();
    expect(screen.queryByText("Not a key in this workspace yet")).toBeNull();
    await user.clear(field);
    await user.type(field, "system.flags");
    expect(screen.queryByText(/system\./)).toBeNull();
    expect(screen.getByText("Not a key in this workspace yet")).toBeInTheDocument();
  });

  it("suggests keys for a list prefix without checking the rules", async () => {
    const user = userEvent.setup();
    render(
      <Form
        commandId="state.list"
        fields={[stringArgument("prefix", "Prefix", false)]}
        initial={{ prefix: "" }}
      />,
    );
    const field = screen.getByRole("combobox", { name: /Prefix/ });
    await user.type(field, "de");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByText(/A key/)).toBeNull();
  });
});

describe("state value field", () => {
  async function chooseKind(label: string) {
    await userEvent.setup().selectOptions(screen.getByLabelText("Value: kind"), label);
  }

  it("sends each kind as the JSON the server stores as that kind", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    render(
      <Form
        commandId="state.set"
        fields={[KEY, VALUE]}
        initial={{ key: "release.week", value: "" }}
        onValues={onValues}
      />,
    );
    const last = () => onValues.mock.lastCall?.[0].value;

    await user.type(screen.getByLabelText("Value"), "true");
    expect(last()).toBe('"true"');

    await chooseKind("Number");
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "42");
    expect(last()).toBe("42");
    await user.type(screen.getByLabelText("Value"), "x");
    expect(screen.getByText("Enter a number, such as 42 or 1.5")).toBeInTheDocument();

    await chooseKind("Yes/No");
    await user.selectOptions(screen.getByLabelText("Value"), "No");
    expect(last()).toBe("false");

    await chooseKind("JSON");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: '{"a": [1]}' } });
    expect(last()).toBe('{"a": [1]}');
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "{a: 1}" } });
    expect(screen.getByText(/^Not valid JSON/)).toBeInTheDocument();
  });

  it("starts with an existing key's kind and shows its current value", () => {
    render(
      <Form
        commandId="state.set"
        fields={[KEY, VALUE]}
        initial={{ key: "deploy.paused", value: "" }}
      />,
    );
    expect(screen.getByLabelText("Value: kind")).toHaveValue("boolean");
    expect(screen.getByText("Now:")).toHaveTextContent("Now: true");
  });

  it("starts a new key as text", () => {
    render(
      <Form
        commandId="state.set"
        fields={[KEY, VALUE]}
        initial={{ key: "fresh.key", value: "" }}
      />,
    );
    expect(screen.getByLabelText("Value: kind")).toHaveValue("text");
    expect(screen.queryByText("Now:")).toBeNull();
  });

  it.each([
    ["true", "boolean", "true"],
    ["42", "number", "42"],
    ['"42"', "text", "42"],
    ['"hello"', "text", "hello"],
    ['{"a":1}', "json", '{"a":1}'],
  ])("opens a saved %s as %s", (saved, kind, shown) => {
    render(
      <Form commandId="state.set" fields={[KEY, VALUE]} initial={{ key: "x.y", value: saved }} />,
    );
    expect(screen.getByLabelText("Value: kind")).toHaveValue(kind);
    expect(screen.getByLabelText("Value")).toHaveValue(shown);
  });

  it("asks for an existing key's current value when the list does not hold it", () => {
    stateList.mockReturnValue({ data: [], isPending: false });
    stateEntry.mockReturnValue({ data: { key: "far.away", value: 3 }, isPending: false });
    render(
      <Form commandId="state.set" fields={[KEY, VALUE]} initial={{ key: "far.away", value: "" }} />,
    );
    expect(stateEntry).toHaveBeenCalledWith("ws-1", "far.away", "SERVER");
    expect(screen.getByLabelText("Value: kind")).toHaveValue("number");
  });
});

describe("target selects", () => {
  it("picks a macro, a pipeline and a workspace to go to from lists", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <ArgumentField
        argument={stringArgument("macro_id", "Macro", false)}
        value=""
        onChange={onChange}
        mode="preset"
        commandId="app.run_macro"
      />,
    );
    fireEvent.change(screen.getByLabelText(/Macro/), { target: { value: "user.standup" } });
    expect(onChange).toHaveBeenLastCalledWith("user.standup");
    expect(screen.getByRole("option", { name: "Ask when run" })).toBeInTheDocument();
    unmount();

    const second = render(
      <ArgumentField
        argument={stringArgument("pipeline_id", "Pipeline", false)}
        value="pipe-1"
        onChange={onChange}
        mode="preset"
        commandId="app.toggle_pipeline"
      />,
    );
    expect(screen.getByLabelText(/Pipeline/)).toHaveDisplayValue("Alerts (on)");
    second.unmount();

    render(
      <ArgumentField
        argument={{
          name: "workspace_id",
          title: "Workspace",
          argumentType: CommandArgumentType.WORKSPACE_ID,
          required: true,
        }}
        value=""
        onChange={onChange}
        mode="preset"
        commandId="workspace.switch_workspace"
      />,
    );
    fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "ws-2" } });
    expect(onChange).toHaveBeenLastCalledWith("ws-2");
  });
});

describe("topic field", () => {
  it("clears the topic with No topic, which sends an empty topic", async () => {
    const user = userEvent.setup();
    const onValues = vi.fn();
    render(
      <Form
        commandId="chat.set_topic"
        fields={[TOPIC]}
        initial={{ topic: "Old" }}
        mode="ask"
        onValues={onValues}
      />,
    );
    await user.click(screen.getByLabelText("No topic"));
    expect(screen.getByLabelText("Topic")).toBeDisabled();
    const values = onValues.mock.lastCall?.[0] as FieldValues;
    expect(values.topic).toBe(CLEARED_FIELD);
    expect(readFields([TOPIC], values, true, "chat.set_topic")).toEqual({
      ok: true,
      args: { topic: "" },
    });
    await user.click(screen.getByLabelText("No topic"));
    expect(screen.getByLabelText("Topic")).toHaveValue("Old");
  });

  it("starts the ask form with the conversation's current topic", () => {
    conversation.mockReturnValue({ data: { topic: "Release week" } });
    const onValues = vi.fn();
    render(
      <Form
        commandId="chat.set_topic"
        fields={[TOPIC]}
        initial={{ topic: "" }}
        mode="ask"
        givenValues={{ conversation_id: "conv-1" }}
        onValues={onValues}
      />,
    );
    expect(conversation).toHaveBeenCalledWith("ws-1", "conv-1");
    expect(screen.getByLabelText("Topic")).toHaveValue("Release week");
    expect(onValues).toHaveBeenCalledWith({ topic: "Release week" });
  });

  it("does not look the topic up in a preset form", () => {
    render(<Form commandId="chat.set_topic" fields={[TOPIC]} initial={{ topic: "" }} />);
    expect(conversation).toHaveBeenCalledWith(undefined, undefined);
  });
});
