import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserHoverCardPortal } from "./UserHoverCardPortal";

describe("UserHoverCardPortal", () => {
  const defaultProps = {
    userId: "user-1",
    username: "portaluser",
    displayName: "Portal User",
    anchorRect: new DOMRect(100, 100, 50, 20),
  };

  it("renders user card content in a portal", () => {
    render(<UserHoverCardPortal {...defaultProps} />);
    expect(screen.getByText("@portaluser")).toBeInTheDocument();
    expect(screen.getByText("Portal User")).toBeInTheDocument();
  });

  it("renders with fixed positioning", () => {
    const { container } = render(<UserHoverCardPortal {...defaultProps} />);
    // The card is portaled to document.body
    const card = document.body.querySelector(".w-72");
    expect(card).toBeInTheDocument();
    expect((card as HTMLElement).style.position).toBe("fixed");
  });

  it("calls onMouseEnter handler", () => {
    const onMouseEnter = vi.fn();
    render(<UserHoverCardPortal {...defaultProps} onMouseEnter={onMouseEnter} />);
    const card = document.body.querySelector(".w-72") as HTMLElement;
    fireEvent.mouseEnter(card);
    expect(onMouseEnter).toHaveBeenCalled();
  });

  it("calls onMouseLeave handler", () => {
    const onMouseLeave = vi.fn();
    render(<UserHoverCardPortal {...defaultProps} onMouseLeave={onMouseLeave} />);
    const card = document.body.querySelector(".w-72") as HTMLElement;
    fireEvent.mouseLeave(card);
    expect(onMouseLeave).toHaveBeenCalled();
  });
});
