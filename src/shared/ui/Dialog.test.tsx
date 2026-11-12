import { StrictMode, useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("ignores Escape and a press on the backdrop when persistent, and has no close icon", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Dialog open persistent onClose={onClose} title="Keep">
        <button type="button">Done</button>
      </Dialog>,
    );
    await user.keyboard("{Escape}");
    const backdrop = container.ownerDocument.querySelector<HTMLElement>(".bg-black\\/50");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("wraps a long title inside the dialog and keeps the close button", () => {
    const title = "A".repeat(64);
    render(
      <Dialog open onClose={() => {}} title={title}>
        <p>Content</p>
      </Dialog>,
    );
    const heading = screen.getByRole("heading", { name: title });
    expect(heading).toHaveClass("break-words", "min-w-0");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("shrink-0");
  });

  describe("focus", () => {
    function withOpener(content: React.ReactNode) {
      return (
        <>
          <button type="button">Opener</button>
          {content}
        </>
      );
    }

    it("goes back to what opened it when the dialog unmounts", () => {
      const { rerender } = render(withOpener(null));
      screen.getByRole("button", { name: "Opener" }).focus();
      rerender(
        withOpener(
          <Dialog open title="T" onClose={() => undefined}>
            <button type="button">Inside</button>
          </Dialog>,
        ),
      );
      rerender(withOpener(null));
      expect(screen.getByRole("button", { name: "Opener" })).toHaveFocus();
    });

    it("goes back to what opened it on Escape in a strict-mode tree", async () => {
      function Page() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Opener
            </button>
            {open && (
              <Dialog open title="T" onClose={() => setOpen(false)}>
                <button type="button">Inside</button>
              </Dialog>
            )}
          </>
        );
      }
      const user = userEvent.setup();
      render(
        <StrictMode>
          <Page />
        </StrictMode>,
      );
      await user.click(screen.getByRole("button", { name: "Opener" }));
      await nextFrame();
      expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Opener" })).toHaveFocus();
    });

    it("comes back in on Tab after falling to the page", () => {
      render(
        <Dialog open title="T" onClose={() => undefined}>
          <button type="button">Inside</button>
        </Dialog>,
      );
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);
      fireEvent.keyDown(document, { key: "Tab" });
      expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    });

    it("stays in the panel when something beside it is pressed", () => {
      render(
        <Dialog open persistent title="T" onClose={() => undefined}>
          <button type="button">Inside</button>
        </Dialog>,
      );
      const beside = screen.getByRole("dialog").parentElement as HTMLElement;
      expect(fireEvent.mouseDown(beside)).toBe(false);
    });
  });
});
