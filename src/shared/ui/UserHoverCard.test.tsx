import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UserHoverCard } from "./UserHoverCard";

describe("UserHoverCard", () => {
  const defaultProps = {
    userId: "user-1",
    username: "hoveruser",
    displayName: "Hover User",
  };

  it("renders children", () => {
    render(
      <UserHoverCard {...defaultProps}>
        <span>Trigger</span>
      </UserHoverCard>,
    );
    expect(screen.getByText("Trigger")).toBeInTheDocument();
  });

  it("does not show card initially", () => {
    render(
      <UserHoverCard {...defaultProps}>
        <span>Trigger</span>
      </UserHoverCard>,
    );
    expect(screen.queryByText("@hoveruser")).not.toBeInTheDocument();
  });

  it("shows card after hover delay", async () => {
    vi.useFakeTimers();
    render(
      <UserHoverCard {...defaultProps}>
        <span>Trigger</span>
      </UserHoverCard>,
    );

    fireEvent.mouseEnter(screen.getByText("Trigger"));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("@hoveruser")).toBeInTheDocument();
    expect(screen.getByText("Hover User")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("hides card after mouse leave with grace period", async () => {
    vi.useFakeTimers();
    render(
      <UserHoverCard {...defaultProps}>
        <span>Trigger</span>
      </UserHoverCard>,
    );

    fireEvent.mouseEnter(screen.getByText("Trigger"));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("@hoveruser")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText("Trigger"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("@hoveruser")).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
