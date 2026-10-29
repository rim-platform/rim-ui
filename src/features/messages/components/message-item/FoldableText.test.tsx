import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useMessageFoldStore } from "../../state/useMessageFoldStore";
import { FoldableText } from "./FoldableText";

// jsdom does no layout: every element reports `height.current` as its offsetHeight, and the
// observer stub reports a new size when a test calls `resize()`.
const height = { current: 0 };
let originalOffsetHeight: PropertyDescriptor | undefined;
const callbacks = new Set<() => void>();

class StubResizeObserver {
  private readonly run: () => void;
  constructor(callback: ResizeObserverCallback) {
    this.run = () => callback([], this as unknown as ResizeObserver);
  }
  observe() {
    callbacks.add(this.run);
  }
  unobserve() {}
  disconnect() {
    callbacks.delete(this.run);
  }
}

function resize(next: number) {
  height.current = next;
  act(() => {
    for (const run of callbacks) run();
  });
}

beforeEach(() => {
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => height.current,
  });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  useMessageFoldStore.setState({ foldable: new Set(), expanded: new Set() });
});

afterEach(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  }
  vi.unstubAllGlobals();
  callbacks.clear();
  height.current = 0;
});

function renderText(onToggle?: (messageId: string, expanding: boolean) => void) {
  return render(
    <FoldableText messageId="m-1" onToggle={onToggle}>
      <p>tall text</p>
    </FoldableText>,
  );
}

/** The div between the wrapper and the text block, which clips the text when folded. */
function clip(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[data-foldable-text] > div")!;
}

describe("FoldableText", () => {
  it("does not fold text up to the threshold", () => {
    height.current = 320;
    const { container } = renderText();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(clip(container).style.maxHeight).toBe("");
  });

  it("folds text taller than the threshold", () => {
    height.current = 400;
    const { container } = renderText();

    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
    expect(clip(container).style.maxHeight).toBe("200px");
  });

  it("Show more unfolds and Show less folds again", () => {
    height.current = 400;
    const { container } = renderText();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(clip(container).style.maxHeight).toBe("");

    fireEvent.click(less);
    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(clip(container).style.maxHeight).toBe("200px");
  });

  it("calls onToggle before the fold changes", () => {
    height.current = 400;
    const seen: Array<[string, boolean, boolean]> = [];
    renderText((messageId, expanding) => {
      seen.push([messageId, expanding, useMessageFoldStore.getState().expanded.has(messageId)]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(seen).toEqual([
      ["m-1", true, false],
      ["m-1", false, true],
    ]);
  });

  it("re-measures when the observer reports a new size", () => {
    height.current = 320;
    renderText();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    resize(400);

    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });
});
