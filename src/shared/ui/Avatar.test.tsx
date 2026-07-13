import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders initial when no url provided", () => {
    render(<Avatar name="Alice" userId="user-1" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders uppercase initial", () => {
    render(<Avatar name="bob" userId="user-2" />);
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders ? for empty name", () => {
    render(<Avatar name="" userId="user-3" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders image when url provided", () => {
    render(<Avatar name="Alice" userId="user-1" url="https://example.com/avatar.jpg" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
    expect(img).toHaveAttribute("alt", "Alice");
  });

  it("does not show presence indicator by default", () => {
    const { container } = render(<Avatar name="Alice" userId="user-1" />);
    // The presence indicator has specific ring classes
    const presenceElements = container.querySelectorAll(".ring-2");
    expect(presenceElements).toHaveLength(0);
  });

  it("shows online presence indicator", () => {
    const { container } = render(<Avatar name="Alice" userId="user-1" presenceStatus="ONLINE" />);
    const presenceIndicator = container.querySelector(".bg-rim-success");
    expect(presenceIndicator).toBeInTheDocument();
  });

  it("shows away presence indicator", () => {
    const { container } = render(<Avatar name="Alice" userId="user-1" presenceStatus="AWAY" />);
    const presenceIndicator = container.querySelector(".bg-rim-warm");
    expect(presenceIndicator).toBeInTheDocument();
  });

  it("shows offline presence indicator", () => {
    const { container } = render(<Avatar name="Alice" userId="user-1" presenceStatus="OFFLINE" />);
    const presenceIndicator = container.querySelector(".bg-rim-text-faint");
    expect(presenceIndicator).toBeInTheDocument();
  });

  it("same userId always produces same color", () => {
    const { container: c1 } = render(<Avatar name="A" userId="consistent-user" />);
    const { container: c2 } = render(<Avatar name="B" userId="consistent-user" />);
    const span1 = c1.querySelector("span > span");
    const span2 = c2.querySelector("span > span");
    // Both should have the same bg-* color class
    const getColorClass = (el: Element | null) =>
      Array.from(el?.classList ?? []).find((c) => c.startsWith("bg-"));
    expect(getColorClass(span1)).toBe(getColorClass(span2));
  });
});
