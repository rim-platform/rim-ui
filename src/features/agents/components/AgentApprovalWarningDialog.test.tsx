import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => "desktop",
}));

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import {
  useConfirmationModalStore,
  type ConfirmationDecision,
  type ConfirmationRequest,
} from "../../agent/state/confirmationModalStore";
import { AGENT_HANDLERS } from "../../commands/runtime/appCommands/agents";
import { useAgentApprovalWarningStore } from "../state/useAgentApprovalWarningStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";
import { AgentApprovalWarningHost } from "./AgentApprovalWarningDialog";

const ACTS_AS_YOU = "It will act as you. Only approve if you asked it to.";

function outsideRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    initiator: "agent",
    commandId: "chat.post_message",
    toolName: "send a message",
    args: {},
    sensitivity: CommandSensitivity.MUTATING,
    verb: null,
    token: "token-1",
    argsHash: "",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    outsideAgent: {
      name: "Claude Code",
      target: [
        { label: "Workspace", value: "Acme" },
        { label: "Channel", value: "general" },
      ],
      text: "Hello team",
    },
    ...overrides,
  };
}

function inAppRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    initiator: "agent",
    commandId: "chat.archive_conversation",
    toolName: "chat.archive_conversation",
    args: { conversation_id: "c1" },
    sensitivity: CommandSensitivity.MUTATING,
    description: "Archive the conversation for everyone",
    token: "token-2",
    argsHash: "hash-2",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

/** Opens `request` as the agent would, and returns how it was answered once it is. */
function ask(request: ConfirmationRequest) {
  const answered = vi.fn<(decision: ConfirmationDecision) => void>();
  act(() => {
    void useConfirmationModalStore.getState().open(request).then(answered);
  });
  return answered;
}

function runCommand(id: string) {
  act(() => {
    AGENT_HANDLERS[id]!(undefined, {});
  });
}

describe("AgentApprovalWarningHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      useAgentApprovalWarningStore.setState({ warning: null });
      useConfirmationModalStore.getState().reset();
      usePendingPairingStore.setState(usePendingPairingStore.getInitialState(), true);
    });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("an agent's request", () => {
    it("names the agent and what it asked for", () => {
      render(<AgentApprovalWarningHost />);
      ask(outsideRequest());
      runCommand("agents.approve_request");
      const dialog = screen.getByRole("dialog", { name: "Approve Claude Code?" });
      expect(dialog).toHaveTextContent("Claude Code asks to: send a message");
      expect(dialog).toHaveTextContent("WorkspaceAcme");
      expect(dialog).toHaveTextContent("Channelgeneral");
      expect(screen.getByRole("group", { name: "The text to send" })).toHaveTextContent(
        "Hello team",
      );
      expect(dialog).toHaveTextContent(ACTS_AS_YOU);
    });

    it("names the in-app agent and the command's summary", () => {
      render(<AgentApprovalWarningHost />);
      ask(inAppRequest());
      runCommand("agents.approve_request");
      const dialog = screen.getByRole("dialog", { name: "Approve the assistant?" });
      expect(dialog).toHaveTextContent("The assistant asks to: chat.archive_conversation");
      expect(dialog).toHaveTextContent("Archive the conversation for everyone");
    });

    it("starts with focus on Cancel", () => {
      render(<AgentApprovalWarningHost />);
      ask(inAppRequest());
      runCommand("agents.approve_request");
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("keeps Approve disabled for 600 ms, then approves through the confirmation", async () => {
      render(<AgentApprovalWarningHost />);
      const answered = ask(inAppRequest());
      runCommand("agents.approve_request");
      const approve = screen.getByRole("button", { name: "Approve" });
      expect(approve).toBeDisabled();
      act(() => vi.advanceTimersByTime(599));
      fireEvent.click(approve);
      expect(approve).toBeDisabled();
      expect(useConfirmationModalStore.getState().request?.token).toBe("token-2");

      act(() => vi.advanceTimersByTime(1));
      expect(approve).toBeEnabled();
      fireEvent.click(approve);
      await act(async () => {});
      expect(answered).toHaveBeenCalledWith({ approved: true });
      expect(useConfirmationModalStore.getState().request).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(toast.info).not.toHaveBeenCalled();
    });

    it("waits as long as the request's own dialog for a program outside RIM", () => {
      render(<AgentApprovalWarningHost />);
      ask(outsideRequest());
      runCommand("agents.approve_request");
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    });

    it("asks for the request's typed word when the request does", () => {
      render(<AgentApprovalWarningHost />);
      ask(inAppRequest({ sensitivity: CommandSensitivity.RESTRICTED, verb: "archive" }));
      runCommand("agents.approve_request");
      act(() => vi.advanceTimersByTime(600));
      const approve = screen.getByRole("button", { name: "Approve" });
      expect(approve).toBeDisabled();
      fireEvent.change(screen.getByRole("textbox", { name: 'Type "archive" to approve' }), {
        target: { value: "archive" },
      });
      expect(approve).toBeEnabled();
    });

    it("leaves the request open on Cancel", async () => {
      render(<AgentApprovalWarningHost />);
      const answered = ask(inAppRequest());
      runCommand("agents.approve_request");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await act(async () => {});
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
      expect(useConfirmationModalStore.getState().request?.token).toBe("token-2");
      expect(answered).not.toHaveBeenCalled();
    });

    it("keeps Escape from the request's dialog beneath, cancelling only the warning", async () => {
      const beneath = vi.fn();
      document.addEventListener("keydown", beneath);
      render(<AgentApprovalWarningHost />);
      const answered = ask(inAppRequest());
      runCommand("agents.approve_request");
      fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
      await act(async () => {});
      document.removeEventListener("keydown", beneath);
      expect(beneath).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(useConfirmationModalStore.getState().request?.token).toBe("token-2");
      expect(answered).not.toHaveBeenCalled();
    });

    it("closes and says so when the request ends while it is open", () => {
      render(<AgentApprovalWarningHost />);
      ask(inAppRequest());
      runCommand("agents.approve_request");
      // As the request's dialog does when it expires.
      act(() => useConfirmationModalStore.getState().reject());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(useAgentApprovalWarningStore.getState().warning).toBeNull();
      expect(toast.info).toHaveBeenCalledWith("The request is no longer waiting");
    });

    it("closes when another request takes the place of the one it was about", () => {
      render(<AgentApprovalWarningHost />);
      ask(inAppRequest());
      runCommand("agents.approve_request");
      ask(inAppRequest({ token: "token-3" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(toast.info).toHaveBeenCalledWith("The request is no longer waiting");
    });
  });

  describe("a program asking to connect", () => {
    const approve = vi.fn();
    const refuse = vi.fn();

    function waiting() {
      act(() =>
        usePendingPairingStore.setState({
          pending: {
            requestId: "pair-1",
            name: "Claude Code",
            code: "123456",
            expiresAt: Date.now() + 60_000,
          },
          approve,
          refuse,
        }),
      );
    }

    it("shows the code again and connects only after the wait", () => {
      render(<AgentApprovalWarningHost />);
      waiting();
      runCommand("agents.approve_pairing");
      const dialog = screen.getByRole("dialog", { name: "Connect Claude Code?" });
      expect(dialog).toHaveTextContent("Only connect if the agent shows this code: 123 456");
      expect(dialog).toHaveTextContent(ACTS_AS_YOU);
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
      const connect = screen.getByRole("button", { name: "Connect" });
      expect(connect).toBeDisabled();
      act(() => vi.advanceTimersByTime(600));
      fireEvent.click(connect);
      expect(approve).toHaveBeenCalledWith("pair-1");
      expect(refuse).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("leaves the program waiting on Cancel", () => {
      render(<AgentApprovalWarningHost />);
      waiting();
      runCommand("agents.approve_pairing");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(approve).not.toHaveBeenCalled();
      expect(refuse).not.toHaveBeenCalled();
      expect(usePendingPairingStore.getState().pending?.requestId).toBe("pair-1");
    });

    it("closes and says so when the request expires", () => {
      render(<AgentApprovalWarningHost />);
      waiting();
      runCommand("agents.approve_pairing");
      act(() => usePendingPairingStore.setState({ pending: null }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(toast.info).toHaveBeenCalledWith("The request is no longer waiting");
    });
  });
});
