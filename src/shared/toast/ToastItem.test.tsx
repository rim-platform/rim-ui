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
    render(<ToastItem toast={makeToast({ description: "More details here" })} />);
    expect(screen.getByText("More details here")).toBeInTheDocument();
  });

  it("shows backtick-quoted names as code in an error toast", () => {
    const { container } = render(
      <ToastItem toast={makeToast({ variant: "error", title: "missing string arg `text`" })} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("text");
    const paragraph = screen.getByText("missing string arg", { exact: false }).closest("p");
    expect(paragraph?.textContent).toBe("missing string arg text");
    expect(paragraph).toHaveAttribute("title", "missing string arg text");
  });

  it("keeps backticks as written in a success toast", () => {
    const { container } = render(
      <ToastItem toast={makeToast({ variant: "success", title: "ran `text`" })} />,
    );
    expect(container.querySelector("code")).toBeNull();
    expect(screen.getByText("ran `text`")).toBeInTheDocument();
  });

  it("leaves an unpaired backtick as text", () => {
    const { container } = render(
      <ToastItem toast={makeToast({ variant: "error", title: "use ` carefully" })} />,
    );
    expect(container.querySelector("code")).toBeNull();
    expect(screen.getByText("use ` carefully")).toBeInTheDocument();
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
    const { container } = render(<ToastItem toast={makeToast({ variant: "info" })} />);
    expect(container.firstElementChild?.className).toContain("rim-accent");
  });

  it("renders with warning variant styles", () => {
    const { container } = render(<ToastItem toast={makeToast({ variant: "warning" })} />);
    expect(container.firstElementChild?.className).toContain("rim-warm");
  });

  it("wraps a long title to three lines and keeps the full text in its title", () => {
    const long = "x".repeat(300);
    render(<ToastItem toast={makeToast({ title: long, description: `${long}d` })} />);
    const title = screen.getByText(long);
    expect(title).toHaveClass("line-clamp-3");
    expect(title).not.toHaveClass("truncate");
    expect(title).toHaveAttribute("title", long);
    const description = screen.getByText(`${long}d`);
    expect(description).toHaveClass("line-clamp-3");
    expect(description).toHaveAttribute("title", `${long}d`);
  });
});
