import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HoverTooltip } from "./HoverTooltip";

describe("HoverTooltip", () => {
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
    act(() => { vi.advanceTimersByTime(10); });

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
    act(() => { vi.advanceTimersByTime(10); });

    expect(trigger).toHaveAttribute("aria-describedby");
    const tooltipId = trigger.getAttribute("aria-describedby");
    expect(document.getElementById(tooltipId!)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
