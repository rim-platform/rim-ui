import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./Dialog";

/** Runs the frame the dialog scheduled on open: frames run in the order they were requested. */
function nextFrame() {
  return act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Test">
        <p>Content</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog when open", () => {
    render(
      <Dialog open={true} onClose={() => {}} title="My Dialog">
        <p>Dialog content</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("My Dialog")).toBeInTheDocument();
    expect(screen.getByText("Dialog content")).toBeInTheDocument();
  });

  it("has correct aria attributes", () => {
    render(
      <Dialog open={true} onClose={() => {}} title="Accessible Dialog">
        <p>Content</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open={true} onClose={onClose} title="Closable">
        <p>Content</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open={true} onClose={onClose} title="Escapable">
        <p>Content</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open={true} onClose={onClose} title="Backdrop">
        <p>Content</p>
      </Dialog>,
    );
    // The backdrop is the first child div with bg-black/50
    const backdrop = container.querySelector(".bg-black\\/50");
    if (backdrop) {
      await userEvent.click(backdrop);
    }
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders children content", () => {
    render(
      <Dialog open={true} onClose={() => {}} title="With Form">
        <form>
          <input type="text" placeholder="Name" />
          <button type="submit">Submit</button>
        </form>
      </Dialog>,
    );
    expect(screen.getByPlaceholderText("Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("moves focus to the first focusable element on open", async () => {
    render(
      <Dialog open={true} onClose={() => {}} title="Focus">
        <p>Content</p>
      </Dialog>,
    );
    await nextFrame();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("gives focus back on closing, when an autoFocus element took it on opening", async () => {
    const dialog = (open: boolean) => (
      <>
        <button type="button">Before</button>
        <Dialog open={open} onClose={() => {}} title="Autofocus">
          <button type="button" autoFocus>
            Inside
          </button>
        </Dialog>
      </>
    );
    const { rerender } = render(dialog(false));
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();
    rerender(dialog(true));
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
    rerender(dialog(false));
    expect(before).toHaveFocus();
  });

  it("gives focus back when it closes by unmounting", () => {
    const view = (shown: boolean) => (
      <>
        <button type="button">Before</button>
        {shown && (
          <Dialog open onClose={() => {}} title="Unmounted">
            <button type="button" autoFocus>
              Inside
            </button>
          </Dialog>
        )}
      </>
    );
    const { rerender } = render(view(false));
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();
    rerender(view(true));
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
    rerender(view(false));
    expect(before).toHaveFocus();
  });

  it("leaves focus alone if something else took it as the dialog closed", () => {
    const view = (first: boolean) => (
      <>
        <button type="button">Before</button>
        {first ? (
          <Dialog open onClose={() => {}} title="First">
            <button type="button" autoFocus>
              In first
            </button>
          </Dialog>
        ) : (
          <Dialog open onClose={() => {}} title="Second">
            <button type="button" autoFocus>
              In second
            </button>
          </Dialog>
        )}
      </>
    );
    const { rerender } = render(view(true));
    rerender(view(false));
    expect(screen.getByRole("button", { name: "In second" })).toHaveFocus();
  });

  it("keeps focus on an autoFocus element inside the dialog", async () => {
    render(
      <Dialog open={true} onClose={() => {}} title="Autofocus">
        <input type="text" aria-label="Name" autoFocus />
      </Dialog>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await nextFrame();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("cancels the focus frame when unmounted before it runs", () => {
    const request = vi.spyOn(window, "requestAnimationFrame");
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = render(
      <Dialog open={true} onClose={() => {}} title="Unmounted">
        <p>Content</p>
      </Dialog>,
    );
    const frame = request.mock.results[0]?.value;
    unmount();
    expect(cancel).toHaveBeenCalledWith(frame);
    request.mockRestore();
    cancel.mockRestore();
  });
});
