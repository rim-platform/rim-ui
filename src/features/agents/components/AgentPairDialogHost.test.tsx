import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Don't connect runs `agents.refuse_pairing`, which only the desktop app has.
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => "desktop",
}));

import { usePendingPairingStore } from "../state/usePendingPairingStore";
import { AgentPairDialogHost } from "./AgentPairDialogHost";

const TITLE = "Connect this program to RIM?";

const approve = vi.fn();
const refuse = vi.fn();

function show(name = "Claude Code", code = "482917", seconds = 120) {
  act(() => {
    usePendingPairingStore.setState({
      pending: { requestId: "request-1", name, code, expiresAt: Date.now() + seconds * 1000 },
    });
  });
}

describe("AgentPairDialogHost", () => {
  it("gives focus back to where it was when the dialog closes", async () => {
    render(
      <>
        <button type="button">Before</button>
        <AgentPairDialogHost />
      </>,
    );
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();
    show();
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Don't connect" })).toHaveFocus(),
    );
    act(() => usePendingPairingStore.setState({ pending: null }));
    await vi.waitFor(() => expect(before).toHaveFocus());
  });

  beforeEach(() => {
    usePendingPairingStore.setState({ pending: null, approve, refuse });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    act(() => usePendingPairingStore.setState(usePendingPairingStore.getInitialState(), true));
  });

  it("shows nothing with no request", () => {
    render(<AgentPairDialogHost />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says what the program claims and what connecting means", () => {
    render(<AgentPairDialogHost />);
    show();
    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog).toHaveTextContent(
      "A program on this computer that calls itself “Claude Code” is asking to connect.",
    );
    expect(dialog).toHaveTextContent("Check that it shows this code:");
    expect(dialog).toHaveTextContent(
      "It can read nothing until you choose what, and anything it sends or changes waits for you. Another program running as you can still do what you can, so connect only programs you trust.",
    );
    expect(dialog).toHaveTextContent("Expires in 120 s");
  });

  it("shows a name with markup as text", () => {
    render(<AgentPairDialogHost />);
    show("<b>Claude</b><img src=x onerror=alert(1)>");
    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog).toHaveTextContent("“<b>Claude</b><img src=x onerror=alert(1)>”");
    expect(dialog.querySelector("b")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();
  });

  it("shows the code with its space and spells out its digits", () => {
    render(<AgentPairDialogHost />);
    show("Claude Code", "012345");
    const code = screen.getByRole("img", { name: "0 1 2 3 4 5" });
    expect(code).toHaveTextContent("012 345");
    expect(code).toHaveClass("font-mono", "text-2xl");
  });

  it("starts on Don't connect, so a stray Enter does not approve", async () => {
    const user = userEvent.setup();
    render(<AgentPairDialogHost />);
    show();
    expect(screen.getByRole("button", { name: "Don't connect" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(refuse).toHaveBeenCalledWith("request-1"));
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses on Don't connect", async () => {
    const user = userEvent.setup();
    render(<AgentPairDialogHost />);
    show();
    await user.click(screen.getByRole("button", { name: "Don't connect" }));
    await vi.waitFor(() => expect(refuse).toHaveBeenCalledWith("request-1"));
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses on Escape", async () => {
    const user = userEvent.setup();
    render(<AgentPairDialogHost />);
    show();
    await user.keyboard("{Escape}");
    expect(refuse).toHaveBeenCalledWith("request-1");
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses on closing the dialog", async () => {
    const user = userEvent.setup();
    render(<AgentPairDialogHost />);
    show();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(refuse).toHaveBeenCalledWith("request-1");
  });

  it("approves on the confirm button", async () => {
    const user = userEvent.setup();
    render(<AgentPairDialogHost />);
    show();
    await user.click(screen.getByRole("button", { name: "The code matches, connect" }));
    expect(approve).toHaveBeenCalledWith("request-1");
    expect(refuse).not.toHaveBeenCalled();
  });

  it("reaches every button from the keyboard, staying inside the dialog", async () => {
    const user = userEvent.setup();
    render(<AgentPairDialogHost />);
    show();
    await user.tab();
    expect(screen.getByRole("button", { name: "The code matches, connect" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Don't connect" })).toHaveFocus();
  });

  it("counts down", () => {
    vi.useFakeTimers();
    render(<AgentPairDialogHost />);
    show();
    expect(screen.getByRole("dialog")).toHaveTextContent("Expires in 120 s");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Expires in 117 s");
  });

  it("closes when the request goes", () => {
    render(<AgentPairDialogHost />);
    show();
    act(() => usePendingPairingStore.setState({ pending: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
