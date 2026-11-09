import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./paletteTargets", () => ({
  useChannelTargets: () => ({
    items: [{ id: "conv-general", serverId: "ws-1", label: "#general" }],
    isPending: false,
  }),
  useJoinableTargets: () => ({
    items: [{ id: "conv-eng", serverId: "ws-1", label: "#engineering" }],
    isPending: false,
  }),
}));
vi.mock("../../home/api/useHomeWorkspaces", () => ({
  useHomeWorkspaces: () => ({ workspaces: [], isPending: false }),
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo } from "../types";
import { ArgumentField } from "./ArgumentFields";

const conversation: CommandArgumentInfo = {
  name: "conversation_id",
  title: "Conversation",
  description: "",
  argumentType: CommandArgumentType.CONVERSATION_ID,
  required: true,
};
const text: CommandArgumentInfo = {
  name: "text",
  title: "Text",
  description: "",
  argumentType: CommandArgumentType.STRING,
  required: true,
};

describe("ArgumentField conversation select", () => {
  it("offers public channels not joined, under their own heading, in preset mode", () => {
    render(<ArgumentField argument={conversation} value="" onChange={vi.fn()} mode="preset" />);
    const select = screen.getByLabelText("Conversation");
    const mine = within(select).getByRole("group", { name: "Your conversations" });
    const others = within(select).getByRole("group", { name: "Other public channels" });
    expect(within(mine).getByRole("option", { name: "#general" })).toBeInTheDocument();
    expect(within(others).getByRole("option", { name: "#engineering" })).toBeInTheDocument();
  });

  it("lists joined conversations only, ungrouped, in ask mode", () => {
    render(<ArgumentField argument={conversation} value="" onChange={vi.fn()} mode="ask" />);
    const select = screen.getByLabelText("Conversation");
    expect(within(select).getByRole("option", { name: "#general" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "#engineering" })).toBeNull();
    expect(within(select).queryByRole("group")).toBeNull();
  });
});

describe("ArgumentField text", () => {
  it("is a textarea that keeps line breaks and sends them on change", () => {
    const onChange = vi.fn();
    render(<ArgumentField argument={text} value="" onChange={onChange} mode="ask" />);
    const field = screen.getByLabelText("Text");
    expect(field.tagName).toBe("TEXTAREA");
    fireEvent.change(field, { target: { value: "one\ntwo" } });
    expect(onChange).toHaveBeenCalledWith("one\ntwo");
  });

  it("submits on Ctrl+Enter and Cmd+Enter, and takes a plain Enter as a new line", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ArgumentField argument={text} value="" onChange={vi.fn()} mode="ask" onSubmit={onSubmit} />,
    );
    const field = screen.getByLabelText("Text");
    field.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("keeps other string arguments as one-line inputs", () => {
    render(
      <ArgumentField
        argument={{ ...text, name: "topic", title: "Topic" }}
        value=""
        onChange={vi.fn()}
        mode="ask"
      />,
    );
    expect(screen.getByLabelText("Topic").tagName).toBe("INPUT");
  });
});
