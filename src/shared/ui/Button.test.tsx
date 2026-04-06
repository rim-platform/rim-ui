import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("fires onClick handler", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Submit</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when isLoading is true", () => {
    render(<Button isLoading>Loading</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows spinner when loading", () => {
    render(<Button isLoading>Save</Button>);
    // The loading state wraps children in a flex span with a Loader2 icon
    const button = screen.getByRole("button");
    expect(button.querySelector("svg")).toBeInTheDocument();
    // Still shows the text alongside the spinner
    expect(button).toHaveTextContent("Save");
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Click</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies custom className", () => {
    render(<Button className="my-custom-class">Styled</Button>);
    expect(screen.getByRole("button")).toHaveClass("my-custom-class");
  });

  it("defaults to primary variant and md size", () => {
    render(<Button>Default</Button>);
    const button = screen.getByRole("button");
    // Primary variant includes bg-rim-accent
    expect(button.className).toContain("bg-rim-accent");
    // md size includes px-4
    expect(button.className).toContain("px-4");
  });

  it("applies sm size classes", () => {
    render(<Button size="sm">Small</Button>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("px-2");
  });
});
