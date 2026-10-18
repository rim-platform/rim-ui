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
    render(<DropdownMenu items={items} position={{ x: 10, y: 10 }} onClose={vi.fn()} />);
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
  });

  it("renders the menu with role='menu'", () => {
    render(<DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("renders menuitem roles on each button", () => {
    render(<DropdownMenu items={makeItems(2)} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("shows 'No actions available' when items is empty", () => {
    render(<DropdownMenu items={[]} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(screen.getByText("No actions available")).toBeInTheDocument();
  });

  it("calls onSelect when an item is clicked", () => {
    const items = makeItems(2);
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Item 1"));
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates with ArrowDown and selects with Enter", () => {
    const items = makeItems(3);
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("navigates with ArrowUp", () => {
    const items = makeItems(3);
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu");
    // Start at 0, go up wraps to last
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[2].onSelect).toHaveBeenCalledTimes(1);
  });

  it("Home key moves focus to first item", () => {
    const items = makeItems(3);
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Home" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[0].onSelect).toHaveBeenCalledTimes(1);
  });

  it("End key moves focus to last item", () => {
    const items = makeItems(3);
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[2].onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders danger items with danger styling class", () => {
    const items: DropdownMenuItem[] = [
      { id: "danger", label: "Delete", danger: true, onSelect: vi.fn() },
    ];
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    // The danger class is on the parent button, not the inner span
    const btn = screen.getByRole("menuitem");
    expect(btn.className).toContain("rim-danger");
  });

  it("closes on click outside", () => {
    const onClose = vi.fn();
    render(<DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("names the menu and shows a header in place of the empty note", () => {
    render(
      <DropdownMenu
        label="Plugin panels"
        header={<p>Nothing to open</p>}
        items={[]}
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("menu", { name: "Plugin panels" })).toBeInTheDocument();
    expect(screen.getByText("Nothing to open")).toBeInTheDocument();
    expect(screen.queryByText("No actions available")).not.toBeInTheDocument();
  });

  it("joins an item's detail to its name and marks the current item", () => {
    const items: DropdownMenuItem[] = [
      { id: "a", label: "Pods", detail: "Overview", current: true, onSelect: vi.fn() },
      { id: "b", label: "Pods", detail: "Logs", onSelect: vi.fn() },
    ];
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(screen.getByRole("menuitem", { name: "Pods: Overview" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Pods: Logs" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("leaves a press on its anchor to the anchor", () => {
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <DropdownMenu
        items={makeItems()}
        position={{ x: 0, y: 0 }}
        onClose={onClose}
        anchorRef={{ current: anchor }}
      />,
    );
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    anchor.remove();
  });

  it("draws a divider above an item that asks for one, never above the first", () => {
    const items: DropdownMenuItem[] = [
      { id: "a", label: "A", separatorBefore: true, onSelect: vi.fn() },
      { id: "b", label: "B", onSelect: vi.fn() },
      { id: "c", label: "C", separatorBefore: true, onSelect: vi.fn() },
    ];
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(1);
    expect(separators[0].nextElementSibling).toHaveTextContent("C");
    // Keyboard order counts only the items.
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[2].onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("DropdownMenu submenus", () => {
  function submenuItems() {
    const leaves: DropdownMenuItem[] = [
      { id: "all", label: "All messages", onSelect: vi.fn() },
      { id: "none", label: "None", onSelect: vi.fn() },
    ];
    const items: DropdownMenuItem[] = [
      { id: "members", label: "Members", onSelect: vi.fn() },
      { id: "notifications", label: "Notifications", submenu: leaves },
      { id: "leave", label: "Leave", onSelect: vi.fn() },
    ];
    return { items, leaves };
  }

  function parentRow() {
    return screen.getByRole("menuitem", { name: "Notifications" });
  }

  it("opens on hover and closes when another row is hovered", () => {
    const { items } = submenuItems();
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(parentRow()).toHaveAttribute("aria-haspopup", "menu");
    expect(parentRow()).toHaveAttribute("aria-expanded", "false");

    fireEvent.mouseEnter(parentRow());
    expect(screen.getByRole("menu", { name: "Notifications" })).toBeInTheDocument();
    expect(parentRow()).toHaveAttribute("aria-expanded", "true");

    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Leave" }));
    expect(screen.queryByRole("menu", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("opens with ArrowRight and closes with ArrowLeft, back on its parent row", () => {
    const { items, leaves } = submenuItems();
    const onClose = vi.fn();
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />);
    const root = screen.getAllByRole("menu")[0];
    fireEvent.keyDown(root, { key: "ArrowDown" });
    fireEvent.keyDown(root, { key: "ArrowRight" });

    const submenu = screen.getByRole("menu", { name: "Notifications" });
    expect(document.activeElement).toBe(submenu);
    fireEvent.keyDown(submenu, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Notifications" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(root);
    expect(onClose).not.toHaveBeenCalled();

    // Focus stayed on the parent row: Enter opens the submenu again.
    fireEvent.keyDown(root, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("menu", { name: "Notifications" }));
    expect(leaves[0].onSelect).not.toHaveBeenCalled();
  });

  it("closes only the submenu on Escape", () => {
    const { items } = submenuItems();
    const onClose = vi.fn();
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.click(parentRow());
    const submenu = screen.getByRole("menu", { name: "Notifications" });
    fireEvent.keyDown(submenu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Notifications" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves through the submenu with the arrows and closes the whole menu on a choice", () => {
    const { items, leaves } = submenuItems();
    const onClose = vi.fn();
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.click(parentRow());
    const submenu = screen.getByRole("menu", { name: "Notifications" });
    fireEvent.keyDown(submenu, { key: "ArrowDown" });
    fireEvent.keyDown(submenu, { key: "Enter" });
    expect(leaves[1].onSelect).toHaveBeenCalledTimes(1);
    expect(leaves[0].onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    // The parent's rows did not move.
    expect(items[2].onSelect).not.toHaveBeenCalled();
  });

  it("closes the whole menu when a submenu row is clicked", () => {
    const { items, leaves } = submenuItems();
    const onClose = vi.fn();
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.mouseEnter(parentRow());
    fireEvent.click(screen.getByRole("menuitem", { name: "All messages" }));
    expect(leaves[0].onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats a click inside the submenu as inside the menu", () => {
    const { items } = submenuItems();
    const onClose = vi.fn();
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.mouseEnter(parentRow());
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "None" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("DropdownMenu item kinds", () => {
  it("marks radio items with their checked state and keeps the check mark's slot", () => {
    const items: DropdownMenuItem[] = [
      { id: "all", label: "All messages", checked: false, onSelect: vi.fn() },
      { id: "mentions", label: "Mentions", checked: true, onSelect: vi.fn() },
      { id: "plain", label: "Settings", onSelect: vi.fn() },
    ];
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    // Both choices hold the slot; only the chosen one draws the mark in it.
    expect(radios[0].firstElementChild?.tagName).toBe("SPAN");
    expect(radios[0].querySelector("svg")).toBeNull();
    expect(radios[1].firstElementChild?.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Settings" })).not.toHaveAttribute("aria-checked");
  });

  it("draws section headings that the arrow keys pass over", () => {
    const items: DropdownMenuItem[] = [
      { id: "a", label: "Copy link", sectionBefore: "Share", onSelect: vi.fn() },
      { id: "b", label: "Mark read", sectionBefore: "Manage", onSelect: vi.fn() },
    ];
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    expect(screen.getByText("Share")).toBeInTheDocument();
    expect(screen.getByText("Manage")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows a keybind hint that stays out of the item's name", () => {
    const items: DropdownMenuItem[] = [
      { id: "search", label: "Search", shortcut: "Ctrl+F", onSelect: vi.fn() },
    ];
    render(<DropdownMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const item = screen.getByRole("menuitem", { name: "Search" });
    expect(item).toHaveTextContent("Ctrl+F");
    expect(item).toHaveAttribute("aria-keyshortcuts", "Ctrl+F");
  });

  it("closes before running a top-level action when asked to", () => {
    const calls: string[] = [];
    const items: DropdownMenuItem[] = [
      { id: "a", label: "A", onSelect: () => calls.push("select") },
    ];
    render(
      <DropdownMenu
        items={items}
        position={{ x: 0, y: 0 }}
        onClose={() => calls.push("close")}
        closeOnSelect
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "A" }));
    expect(calls).toEqual(["close", "select"]);
  });

  it("keeps the browser's menu from opening over its own", () => {
    render(<DropdownMenu items={makeItems()} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByRole("menuitem", { name: "Item 0" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
