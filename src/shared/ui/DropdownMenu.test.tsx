import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";

function makeItems(count = 3): DropdownMenuItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i}`,
    onSelect: vi.fn(),
  }));
}

describe("DropdownMenu", () => {
  it("renders all menu items", () => {
    const items = makeItems(3);
    render(
      <DropdownMenu items={items} position={{ x: 10, y: 10 }} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
  });

  it("renders the menu with role='menu'", () => {
    render(
      <DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("renders menuitem roles on each button", () => {
    render(
      <DropdownMenu items={makeItems(2)} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("shows 'No actions available' when items is empty", () => {
    render(
      <DropdownMenu items={[]} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    expect(screen.getByText("No actions available")).toBeInTheDocument();
  });

  it("calls onSelect when an item is clicked", () => {
    const items = makeItems(2);
    render(
      <DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Item 1"));
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={onClose} />,
    );
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates with ArrowDown and selects with Enter", () => {
    const items = makeItems(3);
    render(
      <DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("navigates with ArrowUp", () => {
    const items = makeItems(3);
    render(
      <DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    const menu = screen.getByRole("menu");
    // Start at 0, go up wraps to last
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[2].onSelect).toHaveBeenCalledTimes(1);
  });

  it("Home key moves focus to first item", () => {
    const items = makeItems(3);
    render(
      <DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Home" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[0].onSelect).toHaveBeenCalledTimes(1);
  });

  it("End key moves focus to last item", () => {
    const items = makeItems(3);
    render(
      <DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[2].onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders danger items with danger styling class", () => {
    const items: DropdownMenuItem[] = [
      { id: "danger", label: "Delete", danger: true, onSelect: vi.fn() },
    ];
    render(
      <DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
    );
    // The danger class is on the parent button, not the inner span
    const btn = screen.getByRole("menuitem");
    expect(btn.className).toContain("rim-danger");
  });

  it("closes on click outside", () => {
    const onClose = vi.fn();
    render(
      <DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={onClose} />,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
