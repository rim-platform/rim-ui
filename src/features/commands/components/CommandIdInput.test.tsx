import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { CommandDefinition } from "../types";
import { CommandIdInput } from "./CommandIdInput";

const PIN_MESSAGE: CommandDefinition = {
  id: "chat.pin_message",
  title: "Pin Message",
  description: "Pin the selected message.",
  category: "Chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
};

function Harness({ onChange }: { onChange: (id: string) => void }) {
  const [value, setValue] = useState("");
  const error = value && value !== PIN_MESSAGE.id ? `Unknown command: ${value}` : null;
  return (
    <CommandIdInput
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      commands={[PIN_MESSAGE]}
      error={error}
    />
  );
}

describe("CommandIdInput", () => {
  it("picks a suggestion pressed after typing a title, without showing the error first", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText("Search commands...");
    input.focus();
    fireEvent.change(input, { target: { value: "Pin Message" } });

    const option = screen.getByRole("button", { name: /Pin Message/ });
    const notPrevented = fireEvent.mouseDown(option);
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText("Unknown command: Pin Message")).toBeNull();

    fireEvent.click(option);
    expect(onChange).toHaveBeenLastCalledWith("chat.pin_message");
    expect(input).toHaveValue("chat.pin_message");
  });
});
