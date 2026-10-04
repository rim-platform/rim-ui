import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import { useToastStore } from "./useToastStore";

describe("ToastContainer", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("renders nothing when there are no toasts", () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it("renders toasts when present", () => {
    useToastStore.getState().add({
      variant: "success",
      title: "Saved successfully",
    });
    render(<ToastContainer />);
    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
  });

  it("renders multiple toasts", () => {
    useToastStore.getState().add({ variant: "info", title: "Toast 1" });
    useToastStore.getState().add({ variant: "warning", title: "Toast 2" });
    render(<ToastContainer />);
    expect(screen.getByText("Toast 1")).toBeInTheDocument();
    expect(screen.getByText("Toast 2")).toBeInTheDocument();
  });
});
