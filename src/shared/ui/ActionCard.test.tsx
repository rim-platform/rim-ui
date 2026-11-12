import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionCard, type ActionCardState } from "./ActionCard";

const WORDS: Record<ActionCardState, string> = {
  running: "In progress",
  confirm: "Needs you",
  denied: "Not done",
  failed: "Failed",
  done: "Done",
  ended: "Ended",
};

describe("ActionCard", () => {
  it("gives each state its own hidden word and its own icon", () => {
    const icons = new Set<string>();
    for (const [state, word] of Object.entries(WORDS) as [ActionCardState, string][]) {
      const { container, unmount } = render(<ActionCard state={state} title="Ban" />);
      expect(screen.getByText(`${word}:`, { exact: false })).toHaveClass("sr-only");
      const icon = container.querySelector("svg");
      expect(icon).toHaveAttribute("aria-hidden", "true");
      icons.add(icon?.getAttribute("class") ?? "");
      unmount();
    }
    expect(icons.size).toBe(6);
  });

  it("draws the ended card with a dashed border", () => {
    const { container } = render(<ActionCard state="ended" title="Ask" />);
    expect(container.firstElementChild).toHaveClass("border-dashed");
  });

  it("shows the detail in the mono font when asked", () => {
    render(<ActionCard state="denied" title="Ban" detail="moderation.ban" mono />);
    expect(screen.getByText("moderation.ban")).toHaveClass("font-mono");
  });

  it("fires an action", () => {
    const onClick = vi.fn();
    render(<ActionCard state="failed" title="Sync" actions={[{ label: "Retry", onClick }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("makes the primary action of a confirm card a signal button", () => {
    render(
      <ActionCard
        state="confirm"
        title="Run"
        actions={[
          { label: "Confirm", onClick: vi.fn(), primary: true },
          { label: "Cancel", onClick: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("bg-rim-signal");
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveClass("bg-rim-signal");
  });

  it("renders no button for a card with no actions", () => {
    const { rerender } = render(<ActionCard state="done" title="Done" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ActionCard state="done" title="Done" actions={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
