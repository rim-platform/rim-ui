import "../../test/mocks/tauri";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowControls } from "./WindowControls";

describe("WindowControls", () => {
  it("renders three window control buttons", () => {
    render(<WindowControls />);
    expect(screen.getByLabelText("Minimize")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximize")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("buttons have type='button'", () => {
    render(<WindowControls />);
    const buttons = [
      screen.getByLabelText("Minimize"),
      screen.getByLabelText("Maximize"),
      screen.getByLabelText("Close"),
    ];
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute("type", "button");
    });
  });

  it("buttons have tabIndex=-1", () => {
    render(<WindowControls />);
    const buttons = [
      screen.getByLabelText("Minimize"),
      screen.getByLabelText("Maximize"),
      screen.getByLabelText("Close"),
    ];
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute("tabIndex", "-1");
    });
  });

  it("applies className prop", () => {
    const { container } = render(<WindowControls className="custom-class" />);
    expect(container.firstElementChild?.className).toContain("custom-class");
  });

  it("clicking minimize does not throw", () => {
    render(<WindowControls />);
    expect(() => {
      fireEvent.click(screen.getByLabelText("Minimize"));
    }).not.toThrow();
  });

  it("clicking maximize does not throw", () => {
    render(<WindowControls />);
    expect(() => {
      fireEvent.click(screen.getByLabelText("Maximize"));
    }).not.toThrow();
  });

  it("clicking close does not throw", () => {
    render(<WindowControls />);
    expect(() => {
      fireEvent.click(screen.getByLabelText("Close"));
    }).not.toThrow();
  });
});
