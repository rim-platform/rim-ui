import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { DropdownMenuItem } from "../DropdownMenu";
import { LONG_PRESS_MS, useContextMenu } from "./useContextMenu";

function Row({ name, getItems }: { name: string; getItems: () => DropdownMenuItem[] }) {
  const contextMenu = useContextMenu();
  return (
    <>
      <div data-testid={name} tabIndex={0} {...contextMenu.bind(getItems, { label: name })}>
        {name}
      </div>
      {contextMenu.menu}
    </>
  );
}

function itemsNamed(...labels: string[]): DropdownMenuItem[] {
  return labels.map((label) => ({ id: label, label, onSelect: vi.fn() }));
}

/** Dispatches a `contextmenu` event and returns it, to read whether it was cancelled. */
function rightClick(element: Element, x = 40, y = 50): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useContextMenu", () => {
  it("opens at the pointer on a right click and cancels the browser's menu", () => {
    render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
    const event = rightClick(screen.getByTestId("general"), 40, 50);
    expect(event.defaultPrevented).toBe(true);
    const menu = screen.getByRole("menu", { name: "general" });
    expect(menu.style.left).toBe("40px");
    expect(menu.style.top).toBe("50px");
    expect(screen.getByRole("menuitem", { name: "Mark read" })).toBeInTheDocument();
  });

  it("opens nothing and leaves the browser's menu when there are no items", () => {
    render(<Row name="general" getItems={() => []} />);
    const event = rightClick(screen.getByTestId("general"));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("builds the items when the menu opens", () => {
    let label = "Mute";
    const getItems = vi.fn(() => itemsNamed(label));
    render(<Row name="general" getItems={getItems} />);
    expect(getItems).not.toHaveBeenCalled();
    label = "Unmute";
    rightClick(screen.getByTestId("general"));
    expect(screen.getByRole("menuitem", { name: "Unmute" })).toBeInTheDocument();
  });

  it.each([
    ["the ContextMenu key", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("opens under the element with %s", (_name, key) => {
    render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
    const row = screen.getByTestId("general");
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 300, 30));
    fireEvent.keyDown(row, key);
    const menu = screen.getByRole("menu", { name: "general" });
    expect(menu.style.left).toBe("116px");
    expect(menu.style.top).toBe("230px");
    expect(document.activeElement).toBe(menu);
  });

  it("leaves F10 without Shift and other keys alone", () => {
    render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
    const row = screen.getByTestId("general");
    fireEvent.keyDown(row, { key: "F10" });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a chosen action, runs it, and returns focus to the row", () => {
    const items = itemsNamed("Mark read");
    render(<Row name="general" getItems={() => items} />);
    const row = screen.getByTestId("general");
    row.focus();
    fireEvent.keyDown(row, { key: "ContextMenu" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(items[0].onSelect).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(row);
  });

  it("keeps one context menu open in the app at a time", () => {
    render(
      <>
        <Row name="general" getItems={() => itemsNamed("Mark read")} />
        <Row name="random" getItems={() => itemsNamed("Leave")} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId("general"), { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "general" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("random"), { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "random" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "general" })).not.toBeInTheDocument();
  });

  it("lets an inner target's menu win over its container's", () => {
    function Nested() {
      const outer = useContextMenu();
      const inner = useContextMenu();
      return (
        <>
          <div {...outer.bind(() => itemsNamed("Message actions"), { label: "outer" })}>
            <span
              data-testid="link"
              {...inner.bind(() => itemsNamed("Copy link"), { label: "inner" })}
            >
              link
            </span>
          </div>
          {outer.menu}
          {inner.menu}
        </>
      );
    }
    render(<Nested />);
    rightClick(screen.getByTestId("link"));
    expect(screen.getByRole("menu", { name: "inner" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "outer" })).not.toBeInTheDocument();
  });

  describe("long press", () => {
    it("opens at the finger after the touch is held", () => {
      vi.useFakeTimers();
      render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
      const row = screen.getByTestId("general");
      fireEvent.touchStart(row, touch(60, 70));
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      const menu = screen.getByRole("menu", { name: "general" });
      expect(menu.style.left).toBe("60px");
      expect(menu.style.top).toBe("70px");

      // A browser that follows the press with its own contextmenu event opens nothing more.
      expect(rightClick(row, 5, 5).defaultPrevented).toBe(true);
      expect(screen.getByRole("menu").style.left).toBe("60px");
      // Lifting the finger does not also tap what is under it.
      expect(fireEvent.touchEnd(row)).toBe(false);
      expect(screen.getAllByRole("menu")).toHaveLength(1);
    });

    it("opens once when the browser's contextmenu event comes before the timer", () => {
      vi.useFakeTimers();
      const getItems = vi.fn(() => itemsNamed("Mark read"));
      render(<Row name="general" getItems={getItems} />);
      const row = screen.getByTestId("general");
      fireEvent.touchStart(row, touch(60, 70));
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS / 2));
      rightClick(row, 61, 71);
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(getItems).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("menu").style.left).toBe("61px");
      expect(fireEvent.touchEnd(row)).toBe(false);
    });

    it("is cancelled by a move beyond the slop", () => {
      vi.useFakeTimers();
      render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
      const row = screen.getByTestId("general");
      fireEvent.touchStart(row, touch(60, 70));
      fireEvent.touchMove(row, touch(64, 74));
      fireEvent.touchMove(row, touch(60, 85));
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("survives a small move within the slop", () => {
      vi.useFakeTimers();
      render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
      const row = screen.getByTestId("general");
      fireEvent.touchStart(row, touch(60, 70));
      fireEvent.touchMove(row, touch(65, 75));
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("is cancelled when the finger lifts first, and leaves that tap alone", () => {
      vi.useFakeTimers();
      render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
      const row = screen.getByTestId("general");
      fireEvent.touchStart(row, touch(60, 70));
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS / 2));
      expect(fireEvent.touchEnd(row)).toBe(true);
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens nothing for a mouse button held down", () => {
      vi.useFakeTimers();
      render(<Row name="general" getItems={() => itemsNamed("Mark read")} />);
      fireEvent.mouseDown(screen.getByTestId("general"));
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
