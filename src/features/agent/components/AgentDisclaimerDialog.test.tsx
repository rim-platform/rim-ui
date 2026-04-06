import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentDisclaimerDialog } from "./AgentDisclaimerDialog";

describe("AgentDisclaimerDialog", () => {
  it("renders the dialog title and content when open", () => {
    render(
      <AgentDisclaimerDialog open={true} onAccept={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByText("AI Agent — Data Sharing Notice")).toBeInTheDocument();
    expect(screen.getByText(/workspace data/)).toBeInTheDocument();
    expect(screen.getByText("I understand")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onAccept when 'I understand' is clicked", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <AgentDisclaimerDialog open={true} onAccept={onAccept} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByText("I understand"));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("calls onCancel when 'Cancel' is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <AgentDisclaimerDialog open={true} onAccept={vi.fn()} onCancel={onCancel} />,
    );

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("contains data sharing warning text", () => {
    render(
      <AgentDisclaimerDialog open={true} onAccept={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByText(/third-party AI/)).toBeInTheDocument();
    expect(screen.getByText(/sensitive, confidential/)).toBeInTheDocument();
  });
});
