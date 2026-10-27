import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../state/confirmationModalStore";
import { ConfirmCommandModal } from "./ConfirmCommandModal";

function makeRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    commandId: "chat.delete_message",
    toolName: "chat.delete_message",
    args: { id: "m1" },
    token: `tok-${Math.random().toString(36).slice(2, 8)}`,
    argsHash: "h",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sensitivity: CommandSensitivity.MUTATING,
    nlDescription: "Delete a chat message you previously sent.",
    ...overrides,
  };
}

function resetStores(): void {
  useConfirmationModalStore.setState({ request: null });
  useShellStore.setState({ selectedConversationId: null });
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  resetStores();
});

describe("ConfirmCommandModal — render gate", () => {
  it("renders nothing when there is no pending request", () => {
    render(<ConfirmCommandModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a dialog when a request is pending", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("rim-system-badge")).toBeInTheDocument();
  });
});

describe("ConfirmCommandModal — subtitle copy source", () => {
  it("renders `description` as the subtitle when both description and nlDescription are present (precedence pin)", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          description: "Human-facing consequence copy.",
          nlDescription: "Model-facing routing copy.",
        }),
      );
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Human-facing consequence copy.");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Model-facing routing copy.");
  });

  it("falls back to nlDescription when description is absent (existing behavior regression)", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          description: undefined,
          nlDescription: "Delete a chat message you previously sent.",
        }),
      );
    });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Delete a chat message you previously sent.",
    );
  });
});

describe("ConfirmCommandModal — chips + sensitivity", () => {
  it("renders the sensitivity wire constant verbatim in the chip", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.RESTRICTED }));
    });
    expect(screen.getByTestId("sensitivity-chip")).toHaveTextContent("RESTRICTED");
    expect(screen.getByTestId("initiator-chip")).toHaveTextContent("AGENT");
  });

  it("falls back to SAFE styling when sensitivity is missing", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ sensitivity: undefined }));
    });
    expect(screen.getByTestId("sensitivity-chip")).toHaveTextContent("SAFE");
  });
});

describe("ConfirmCommandModal — args block", () => {
  it("renders args masked via maskForDisplay (token redacted)", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          args: {
            channel: "general",
            api_key: "sk-proj-shouldNotAppear",
            limit: 5,
          },
        }),
      );
    });
    const argsBlock = screen.getByTestId("args-block");
    expect(argsBlock).toHaveTextContent("channel");
    expect(argsBlock).toHaveTextContent("general");
    expect(argsBlock).toHaveTextContent("api_key");
    expect(argsBlock).toHaveTextContent("[REDACTED]");
    expect(argsBlock).not.toHaveTextContent("sk-proj-shouldNotAppear");
    expect(argsBlock).toHaveTextContent("limit");
    expect(argsBlock).toHaveTextContent("5");
  });

  // Parity gate with backend `rim_services::command::sensitivity::
  // mask_for_display` VENDOR_PREFIXES list. If the backend adds or drops a
  // prefix, this table must move in lockstep — drift here is the "masked
  // in UI, logged plain" failure mode.
  //
  // Each probe uses a value-shape-only trigger: the arg key `credential`
  // name-matches `SENSITIVE_ARG_NAME_RE`, so the probes use `detect` (a key
  // that does not match the name regex). That forces redaction to fire on
  // the value shape alone. If a prefix is dropped from VENDOR_PREFIXES the
  // literal CANARY string leaks into the DOM and this assertion fails.
  //
  // Runs each probe in its own modal open so the args list never trips the
  // 10-item overflow — every canary is in the visible slice.
  it.each<[string, string]>([
    ["openai sk-", "sk-proj-CANARY_openai_should_not_appear"],
    ["slack xoxb-", "xoxb-CANARY_slack_bot_should_not_appear"],
    ["slack xoxp-", "xoxp-CANARY_slack_user_should_not_appear"],
    ["slack xoxa-", "xoxa-CANARY_slack_workspace_should_not_appear"],
    ["github ghp_", "ghp_CANARY_github_personal_should_not_appear"],
    ["github gho_", "gho_CANARY_github_oauth_should_not_appear"],
    ["github ghu_", "ghu_CANARY_github_user_should_not_appear"],
    ["github ghs_", "ghs_CANARY_github_server_should_not_appear"],
    ["github ghr_", "ghr_CANARY_github_refresh_should_not_appear"],
    ["gitlab glpat-", "glpat-CANARY_gitlab_pat_should_not_appear"],
    ["google ya29.", "ya29.CANARY_google_oauth_should_not_appear"],
    ["aws AKIA", "AKIA_CANARY_aws_access_should_not_appear"],
    ["google AIza", "AIza_CANARY_google_api_should_not_appear"],
  ])("redacts the %s vendor prefix by value shape", (_label, canary) => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ args: { detect: canary } }));
    });
    const argsBlock = screen.getByTestId("args-block");
    expect(argsBlock).not.toHaveTextContent(canary);
    expect(argsBlock).toHaveTextContent("[REDACTED]");
  });

  it("renders the empty-args placeholder when no arguments are supplied", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ args: {} }));
    });
    expect(screen.getByTestId("args-block")).toHaveTextContent("(no arguments)");
  });

  it("collapses arg counts above the limit with a +N more chip", () => {
    const args: Record<string, unknown> = {};
    for (let i = 0; i < 13; i++) args[`arg_${i}`] = `value_${i}`;
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ args }));
    });
    expect(screen.getByTestId("args-block")).toHaveTextContent("+3 more arguments");
  });
});

describe("ConfirmCommandModal — confirmation flow", () => {
  it("approves and closes when Confirm is clicked (non-tier-4)", async () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.MUTATING }));
    });

    await userEvent.click(screen.getByTestId("confirm-button"));

    const decision = await promise!;
    expect(decision.approved).toBe(true);
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("rejects and closes when Cancel is clicked", async () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore.getState().open(makeRequest());
    });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const decision = await promise!;
    expect(decision.approved).toBe(false);
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("rejects on Escape key", async () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore.getState().open(makeRequest());
    });

    await userEvent.keyboard("{Escape}");

    const decision = await promise!;
    expect(decision.approved).toBe(false);
  });

  it("rejects on backdrop click for SAFE/SENSITIVE tiers", async () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.SAFE }));
    });

    await userEvent.click(screen.getByTestId("confirm-cmd-backdrop"));

    const decision = await promise!;
    expect(decision.approved).toBe(false);
  });

  it("does NOT close on backdrop click for MUTATING/RESTRICTED tiers", async () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.MUTATING }));
    });

    await userEvent.click(screen.getByTestId("confirm-cmd-backdrop"));

    expect(useConfirmationModalStore.getState().request).not.toBeNull();
  });
});

describe("ConfirmCommandModal — tier-4 type-to-confirm", () => {
  it("starts with Confirm disabled for RESTRICTED tier and a tier-4 input visible", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          commandId: "chat.delete_message",
          sensitivity: CommandSensitivity.RESTRICTED,
        }),
      );
    });

    expect(screen.getByTestId("type-to-confirm-block")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-button")).toBeDisabled();
  });

  it("enables Confirm after the user types the matching verb (RESTRICTED)", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          commandId: "chat.delete_message",
          sensitivity: CommandSensitivity.RESTRICTED,
        }),
      );
    });

    const input = screen.getByTestId("verb-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "delete" } });
    });
    expect(input.value).toBe("delete");
    expect(screen.getByTestId("confirm-button")).not.toBeDisabled();
  });

  it("Confirm stays disabled while the typed verb is a strict prefix only", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          commandId: "chat.delete_message",
          sensitivity: CommandSensitivity.RESTRICTED,
        }),
      );
    });

    const input = screen.getByTestId("verb-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "del" } });
    });
    expect(input.value).toBe("del");
    expect(screen.getByTestId("confirm-button")).toBeDisabled();
  });

  it("re-disables Confirm when the typed value no longer matches the verb", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          commandId: "chat.delete_message",
          sensitivity: CommandSensitivity.RESTRICTED,
        }),
      );
    });

    const input = screen.getByTestId("verb-input") as HTMLInputElement;
    // Drive the controlled input directly via change events. Avoids
    // userEvent.type's special-key parsing which interprets bracket-escaped
    // tokens — keeps the test about state transitions, not key syntax.
    act(() => {
      fireEvent.change(input, { target: { value: "delete" } });
    });
    expect(screen.getByTestId("confirm-button")).not.toBeDisabled();

    act(() => {
      fireEvent.change(input, { target: { value: "delet" } });
    });
    expect(screen.getByTestId("confirm-button")).toBeDisabled();
  });

  it("triggers tier-4 input on same-turn-after-tool-result + MUTATING", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          sensitivity: CommandSensitivity.MUTATING,
          sameTurnAfterToolResult: true,
        }),
      );
    });
    expect(screen.getByTestId("type-to-confirm-block")).toBeInTheDocument();
  });

  it("does NOT trigger tier-4 for plain MUTATING without same-turn flag", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.MUTATING }));
    });
    expect(screen.queryByTestId("type-to-confirm-block")).not.toBeInTheDocument();
  });

  it("bare Enter inside the verb input does NOT submit", () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore.getState().open(
        makeRequest({
          commandId: "chat.delete_message",
          sensitivity: CommandSensitivity.RESTRICTED,
        }),
      );
    });

    const input = screen.getByTestId("verb-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "delete" } });
    });
    expect(screen.getByTestId("confirm-button")).not.toBeDisabled();

    // Bare Enter in the input must not submit. The only "go" gesture is
    // ⌘/Ctrl+Enter at the panel level.
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    let settled = false;
    void promise!.then(() => {
      settled = true;
    });
    return Promise.resolve().then(() => {
      expect(settled).toBe(false);
      expect(useConfirmationModalStore.getState().request).not.toBeNull();
    });
  });
});

describe("ConfirmCommandModal — keyboard map", () => {
  it("submits on Cmd+Enter when Confirm is enabled", async () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.MUTATING }));
    });

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter", metaKey: true });

    const decision = await promise!;
    expect(decision.approved).toBe(true);
  });

  it("Cmd+Enter is a no-op when Confirm is disabled (tier-4 verb mismatch)", async () => {
    render(<ConfirmCommandModal />);
    let promise: Promise<{ approved: boolean }> | null = null;
    act(() => {
      promise = useConfirmationModalStore.getState().open(
        makeRequest({
          commandId: "chat.delete_message",
          sensitivity: CommandSensitivity.RESTRICTED,
        }),
      );
    });

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });

    let settled = false;
    void promise!.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(useConfirmationModalStore.getState().request).not.toBeNull();
  });
});

describe("ConfirmCommandModal — cross-channel chip", () => {
  it("renders when a destination arg differs from the active conversation", () => {
    useShellStore.setState({ selectedConversationId: "general" });
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          args: { conversation_id: "ops-deploys", message: "hi" },
        }),
      );
    });
    expect(screen.getByTestId("cross-channel-chip")).toBeInTheDocument();
    expect(screen.getByTestId("cross-channel-chip")).toHaveTextContent("ops-depl");
  });

  it("does NOT render when the destination matches the active conversation", () => {
    useShellStore.setState({ selectedConversationId: "general" });
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ args: { conversation_id: "general", message: "hi" } }));
    });
    expect(screen.queryByTestId("cross-channel-chip")).not.toBeInTheDocument();
  });
});

describe("ConfirmCommandModal — tool-result-origin warning", () => {
  it("renders the warning banner when sameTurnAfterToolResult is true", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ sameTurnAfterToolResult: true }));
    });
    expect(screen.getByTestId("tool-result-warning")).toBeInTheDocument();
    expect(screen.getByTestId("tool-result-warning")).toHaveTextContent(
      "Verify it matches your intent",
    );
  });

  it("does not render the warning banner when the flag is absent/false", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    expect(screen.queryByTestId("tool-result-warning")).not.toBeInTheDocument();
  });
});

describe("ConfirmCommandModal — STALE expiry", () => {
  it("auto-rejects when expiresAt elapses while the modal is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      render(<ConfirmCommandModal />);
      let promise: Promise<{ approved: boolean }> | null = null;
      act(() => {
        promise = useConfirmationModalStore.getState().open(
          makeRequest({
            expiresAt: new Date(Date.now() + 100).toISOString(),
          }),
        );
      });

      // Modal must still be open prior to expiry.
      expect(useConfirmationModalStore.getState().request).not.toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      const decision = await promise!;
      expect(decision.approved).toBe(false);
      expect(useConfirmationModalStore.getState().request).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ConfirmCommandModal — accessibility", () => {
  it("sets role=dialog and aria-modal=true", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAttribute("aria-describedby");
  });

  it("focuses the Cancel button on mount, not Confirm", async () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    // Wait one rAF tick for the focus useEffect to run.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    // RESTRICTED shares this useEffect path, so it has no separate
    // assertion.
  });

  it("announces redacted values via aria-label on the value cell", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ args: { password: "x" } }));
    });
    const redactedCell = screen.getByLabelText("redacted");
    expect(redactedCell).toHaveTextContent("[REDACTED]");
  });
});

describe("ConfirmCommandModal — a command the user ran", () => {
  function userRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
    return makeRequest({
      initiator: "user",
      commandId: "admin.purge_channel",
      toolName: "Purge Channel",
      args: { channel: "general" },
      sensitivity: CommandSensitivity.RESTRICTED,
      nlDescription: undefined,
      description: "Delete every message in the channel.",
      ...overrides,
    });
  }

  it("titles the dialog with the command's title and shows no agent chip", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(userRequest());
    });
    const dialog = screen.getByRole("dialog", { name: "Confirm: Purge Channel" });
    expect(dialog).toHaveTextContent("Delete every message in the channel.");
    expect(dialog).toHaveTextContent("Initiated by you.");
    expect(dialog).not.toHaveTextContent("Agent wants to:");
    expect(screen.queryByTestId("initiator-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("args-block")).toHaveTextContent("general");
  });

  it("asks for the typed verb of a Restricted command, honouring a verb override", async () => {
    const user = userEvent.setup();
    render(<ConfirmCommandModal />);
    let decision: Promise<{ approved: boolean }> | undefined;
    act(() => {
      decision = useConfirmationModalStore.getState().open(userRequest({ verb: "wipe" }));
    });
    const confirm = screen.getByTestId("confirm-button");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByTestId("verb-input"), "purge");
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByTestId("verb-input"));
    await user.type(screen.getByTestId("verb-input"), "wipe");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await expect(decision).resolves.toEqual({ approved: true });
  });

  it("asks for no verb for a Restricted command whose verb is null", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(userRequest({ verb: null }));
    });
    expect(screen.queryByTestId("verb-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
    expect(screen.getByTestId("sensitivity-chip")).toHaveTextContent("RESTRICTED");
  });

  it("asks for no verb when the command's sensitivity is unknown", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(userRequest({ sensitivity: undefined }));
    });
    expect(screen.queryByTestId("verb-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
    expect(screen.getByTestId("sensitivity-chip")).toHaveTextContent("MUTATING");
  });

  it("cancels on Escape and returns focus to where it was", async () => {
    render(
      <>
        <button type="button">Origin</button>
        <ConfirmCommandModal />
      </>,
    );
    const origin = screen.getByRole("button", { name: "Origin" });
    origin.focus();
    let decision: Promise<{ approved: boolean }> | undefined;
    act(() => {
      decision = useConfirmationModalStore.getState().open(userRequest());
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await expect(decision).resolves.toEqual({ approved: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(origin).toHaveFocus();
  });

  it("keeps Tab inside the dialog and confirms with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    render(<ConfirmCommandModal />);
    let decision: Promise<{ approved: boolean }> | undefined;
    act(() => {
      decision = useConfirmationModalStore
        .getState()
        .open(userRequest({ sensitivity: CommandSensitivity.MUTATING }));
    });
    const close = screen.getByRole("button", { name: "Close" });
    const confirm = screen.getByTestId("confirm-button");

    // Focus starts on Close, the safe choice, and wraps at both ends.
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Control>}{Enter}{/Control}");
    await expect(decision).resolves.toEqual({ approved: true });
  });
});

describe("ConfirmCommandModal — a dangerous command", () => {
  it("marks a dangerous command in red and says so", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ dangerous: true }));
    });
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAttribute("data-dangerous", "true");
    expect(panel).toHaveClass("border-l-rim-danger");
    expect(screen.getByTestId("confirm-button")).toHaveClass("bg-rim-danger");
    expect(panel).toHaveTextContent("This is a dangerous command.");
  });

  it("leaves other commands unmarked", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    const panel = screen.getByRole("dialog");
    expect(panel).not.toHaveAttribute("data-dangerous");
    expect(panel).not.toHaveTextContent("This is a dangerous command.");
  });
});
