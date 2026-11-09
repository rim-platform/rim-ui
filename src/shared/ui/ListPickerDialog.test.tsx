import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListPickerDialog } from "./ListPickerDialog";

const ITEMS = [
  { id: "a", label: "Alpha", detail: "first" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

function setup(extra: Partial<React.ComponentProps<typeof ListPickerDialog>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ListPickerDialog
      title="Pick one"
      items={ITEMS}
      emptyText="Nothing here"
      onPick={onPick}
      onClose={onClose}
      {...extra}
    />,
  );
  return { onPick, onClose, search: screen.getByRole("combobox") };
}

describe("ListPickerDialog", () => {
  it("picks the highlighted choice with Enter and moves with the arrow keys", () => {
    const { onPick, search } = setup();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("narrows the choices by what is typed, detail included", () => {
    const { onPick, search } = setup();
    fireEvent.change(search, { target: { value: "first" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("cancels with Escape", () => {
    const { onClose, onPick } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("offers what was typed as a choice when asked to", () => {
    const { onPick, search } = setup({ custom: (q) => ({ id: q, label: `Use ${q}` }) });
    fireEvent.change(search, { target: { value: "zzz" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "zzz", label: "Use zzz" });
  });

  it("says when there is nothing to choose", () => {
    setup({ items: [] });
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("picks a clicked choice", () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByText("Gamma"));
    expect(onPick).toHaveBeenCalledWith(ITEMS[2]);
  });
});
