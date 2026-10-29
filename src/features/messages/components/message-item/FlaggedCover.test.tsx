import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { useFlagRevealStore } from "../../state/useFlagRevealStore";
import { FlaggedCover } from "./FlaggedCover";

beforeEach(() => {
  useFlagRevealStore.setState({ revealed: new Set() });
});

function renderCover(canModerate = false, onClearFlag = vi.fn()) {
  render(
    <FlaggedCover messageId="m-1" canModerate={canModerate} onClearFlag={onClearFlag}>
      <p>covered text</p>
    </FlaggedCover>,
  );
  return onClearFlag;
}

describe("FlaggedCover", () => {
  it("hides the message behind a note with Show anyway", () => {
    renderCover();
    expect(screen.queryByText("covered text")).not.toBeInTheDocument();
    expect(
      screen.getByText("Hidden: the automatic check flagged this message."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show anyway" })).toBeInTheDocument();
  });

  it("shows the message on Show anyway and hides it again on Hide", () => {
    renderCover();
    fireEvent.click(screen.getByRole("button", { name: "Show anyway" }));
    expect(screen.getByText("covered text")).toBeInTheDocument();
    expect(screen.getByText("Flagged by the automatic check")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("covered text")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show anyway" })).toBeInTheDocument();
  });

  it("offers Clear flag only to a moderator", () => {
    renderCover(false);
    expect(screen.queryByRole("button", { name: "Clear flag" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show anyway" }));
    expect(screen.queryByRole("button", { name: "Clear flag" })).not.toBeInTheDocument();
  });

  it("calls onClearFlag with the message id, covered and revealed", () => {
    const onClearFlag = renderCover(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear flag" }));
    expect(onClearFlag).toHaveBeenCalledWith("m-1");

    fireEvent.click(screen.getByRole("button", { name: "Show anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear flag" }));
    expect(onClearFlag).toHaveBeenCalledTimes(2);
  });
});
