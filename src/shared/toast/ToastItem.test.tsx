import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastItem } from "./ToastItem";
import { useToastStore, type Toast } from "./useToastStore";

function makeToast(overrides: Partial<Toast> = {}): Toast {
  return {
    id: "test-toast",
    variant: "info",
    title: "Test notification",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("ToastItem", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("renders toast title", () => {
    render(<ToastItem toast={makeToast({ title: "Hello!" })} />);
    expect(screen.getByText("Hello!")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <ToastItem
        toast={makeToast({ description: "More details here" })}
      />,
    );
    expect(screen.getByText("More details here")).toBeInTheDocument();
  });

  it("renders dismiss button", () => {
    render(<ToastItem toast={makeToast()} />);
    expect(screen.getByLabelText("Dismiss notification")).toBeInTheDocument();
  });

  it("has role='alert' for error variant", () => {
    render(<ToastItem toast={makeToast({ variant: "error" })} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has role='status' for non-error variants", () => {
    render(<ToastItem toast={makeToast({ variant: "success" })} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders action button when action is provided", () => {
    const onClick = vi.fn();
    render(
      <ToastItem
        toast={makeToast({
          action: { label: "Undo", onClick },
        })}
      />,
    );
    expect(screen.getByText("Undo")).toBeInTheDocument();
  });

  it("calls action onClick and dismisses on action button click", () => {
    const onClick = vi.fn();
    const toast = makeToast({
      action: { label: "Retry", onClick },
    });
    useToastStore.getState().add(toast);
    render(<ToastItem toast={toast} />);

    fireEvent.click(screen.getByText("Retry"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders with info variant styles", () => {
    const { container } = render(
      <ToastItem toast={makeToast({ variant: "info" })} />,
    );
    expect(container.firstElementChild?.className).toContain("rim-accent");
  });

  it("renders with warning variant styles", () => {
    const { container } = render(
      <ToastItem toast={makeToast({ variant: "warning" })} />,
    );
    expect(container.firstElementChild?.className).toContain("rim-warm");
  });
});
