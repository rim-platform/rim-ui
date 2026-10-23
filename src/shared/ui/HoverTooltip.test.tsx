import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HoverTooltip } from "./HoverTooltip";

describe("HoverTooltip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    [1000, 200, 816],
    [0, 200, 8],
    [400, 200, 320],
  ])("keeps a tooltip inside the viewport at trigger x=%s", (left, width, expected) => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return {
        left,
        top: 200,
        bottom: 230,
        width: this.tagName === "BUTTON" ? 40 : width,
        height: this.tagName === "BUTTON" ? 30 : 60,
      } as DOMRect;
    });
    render(
      <HoverTooltip content="Search in channel" delay={0}>
        <button>Trigger</button>
      </HoverTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Trigger"));
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toHaveStyle({
      left: `${expected}px`,
      maxWidth: "calc(100vw - 16px)",
    });
  });

  it("uses the measured height to flip below the trigger", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 30,
      bottom: 60,
      width: 100,
      height: 40,
    } as DOMRect);
    render(
      <HoverTooltip content="Help" delay={0}>
        <button>Trigger</button>
      </HoverTooltip>,
    );
    fireEvent.focus(screen.getByText("Trigger"));
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toHaveStyle({ top: "66px" });
  });

  it("does not show tooltip initially", () => {
    render(
      <HoverTooltip content="Tooltip text">
        <button>Trigger</button>
      </HoverTooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip after hover with delay", async () => {
    vi.useFakeTimers();
    render(
      <HoverTooltip content="Tooltip text" delay={100}>
        <button>Trigger</button>
      </HoverTooltip>,
    );

    fireEvent.mouseEnter(screen.getByText("Trigger"));

    // Not visible yet (delay not elapsed)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Tooltip text");

    vi.useRealTimers();
  });

  it("hides tooltip on blur", async () => {
    vi.useFakeTimers();
    render(
      <HoverTooltip content="Tooltip text" delay={0}>
        <button>Trigger</button>
      </HoverTooltip>,
    );

    fireEvent.focus(screen.getByText("Trigger"));
    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(screen.getByText("Trigger"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("sets aria-describedby on trigger when tooltip is visible", async () => {
    vi.useFakeTimers();
    render(
      <HoverTooltip content="Help text" delay={0}>
        <button>Trigger</button>
      </HoverTooltip>,
    );

    const trigger = screen.getByText("Trigger");
    expect(trigger).not.toHaveAttribute("aria-describedby");

    fireEvent.mouseEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(trigger).toHaveAttribute("aria-describedby");
    const tooltipId = trigger.getAttribute("aria-describedby");
    expect(document.getElementById(tooltipId!)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
