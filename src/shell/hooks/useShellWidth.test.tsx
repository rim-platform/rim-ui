import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { act, render } from "@testing-library/react";

import { useShellStore } from "../state/useShellStore";
import { classifyShellWidth, useObserveShellWidth, useShellWidth } from "./useShellWidth";

let fire: (width: number) => void = () => {};
let width = 0;

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  useObserveShellWidth(ref);
  return (
    <div ref={ref}>
      <span data-testid="width">{useShellWidth()}</span>
    </div>
  );
}

describe("classifyShellWidth", () => {
  it("sorts widths at the 1100 and 760 pixel edges", () => {
    expect(classifyShellWidth(1100)).toBe("wide");
    expect(classifyShellWidth(1099)).toBe("medium");
    expect(classifyShellWidth(760)).toBe("medium");
    expect(classifyShellWidth(759)).toBe("narrow");
  });

  it("counts a shell that has not been laid out as wide", () => {
    expect(classifyShellWidth(0)).toBe("wide");
  });
});

describe("useObserveShellWidth", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe() {
          fire = (next) =>
            this.callback(
              [{ contentRect: { width: next } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            );
        }
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width }) as DOMRect,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useShellStore.setState({ shellWidth: "wide", navDrawerOpen: false });
  });

  it("reports each width class from the first measurement and every resize", () => {
    width = 1400;
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("width")).toHaveTextContent("wide");

    act(() => fire(900));
    expect(getByTestId("width")).toHaveTextContent("medium");

    act(() => fire(500));
    expect(getByTestId("width")).toHaveTextContent("narrow");
  });

  it("starts from the measured width", () => {
    width = 500;
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("width")).toHaveTextContent("narrow");
  });

  it("closes the drawer when the window leaves narrow and returns to wide on unmount", () => {
    width = 500;
    const { unmount } = render(<Probe />);
    act(() => useShellStore.getState().setNavDrawerOpen(true));
    act(() => fire(1200));
    expect(useShellStore.getState().navDrawerOpen).toBe(false);

    act(() => fire(500));
    unmount();
    expect(useShellStore.getState().shellWidth).toBe("wide");
  });
});
