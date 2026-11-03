import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import { toast, useToastStore } from "./useToastStore";

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

  it("sits at the bottom right, above the composer row", () => {
    useToastStore.getState().add({ variant: "info", title: "Placed" });
    const { container } = render(<ToastContainer />);
    const stack = container.firstChild as HTMLElement;
    expect(stack).toHaveClass("bottom-24", "right-4", "flex-col-reverse");
    expect(stack).not.toHaveClass("top-20");
  });

  describe("error toast lifetime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("closes an error toast after 10 seconds", () => {
      toast.error("Pipe failed");
      render(<ToastContainer />);
      act(() => {
        vi.advanceTimersByTime(9_999);
      });
      expect(screen.getByText("Pipe failed")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.queryByText("Pipe failed")).toBeNull();
    });

    it("keeps a toast open while the pointer is on it", () => {
      toast.error("Pipe failed");
      render(<ToastContainer />);
      const alert = screen.getByRole("alert");
      fireEvent.mouseEnter(alert);
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      expect(screen.getByText("Pipe failed")).toBeInTheDocument();
      fireEvent.mouseLeave(alert);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.queryByText("Pipe failed")).toBeNull();
    });
  });
});
