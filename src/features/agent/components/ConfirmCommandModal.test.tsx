import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../state/confirmationModalStore";
import { hostDialogOpen } from "../../../shared/ui/hostDialogs";
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
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Assistant wants to:");
    expect(screen.getByRole("dialog")).toHaveTextContent("Initiated by the assistant.");
  });

  it("counts as an open host dialog while it shows", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    expect(hostDialogOpen()).toBe(true);
    act(() => {
      useConfirmationModalStore.getState().reject();
    });
    expect(hostDialogOpen()).toBe(false);
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
  it("shows no sensitivity tag; an agent's command keeps its AGENT chip", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ sensitivity: CommandSensitivity.RESTRICTED }));
    });
    expect(screen.queryByTestId("sensitivity-chip")).not.toBeInTheDocument();
    expect(screen.queryByText("RESTRICTED")).not.toBeInTheDocument();
    expect(screen.getByTestId("initiator-chip")).toHaveTextContent("AGENT");
  });

  it("uses the Safe confirm label when sensitivity is missing", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest({ sensitivity: undefined }));
    });
    expect(screen.getByTestId("confirm-button")).toHaveTextContent("Confirm");
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
      // jsdom runs animation frames and focus fixup on one shared timer. If it
      // is left pending on the fake clock, it never fires on the real one and
      // no later requestAnimationFrame callback in this file runs.
      act(() => {
        vi.runOnlyPendingTimers();
      });
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
    expect(dialog).not.toHaveTextContent("Assistant wants to:");
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
    expect(screen.getByTestId("confirm-button")).toHaveTextContent("I understand — execute");
  });

  it("asks for no verb when the command's sensitivity is unknown", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(userRequest({ sensitivity: undefined }));
    });
    expect(screen.queryByTestId("verb-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
    expect(screen.getByTestId("confirm-button")).toHaveTextContent("Run anyway");
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
    expect(screen.getByTestId("confirm-button")).toHaveClass("bg-rim-danger-solid");
    expect(panel).toHaveTextContent("This is a dangerous command.");
  });

  it("keeps a dangerous command's red border and button without a tag", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(
        makeRequest({
          initiator: "user",
          dangerous: true,
          description: undefined,
          nlDescription: undefined,
        }),
      );
    });
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAttribute("data-dangerous", "true");
    expect(panel).toHaveTextContent("This is a dangerous command.");
    expect(screen.queryByTestId("sensitivity-chip")).not.toBeInTheDocument();
    for (const tag of ["MUTATING", "RESTRICTED", "DANGEROUS"]) {
      expect(panel).not.toHaveTextContent(tag);
    }
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

describe("ConfirmCommandModal — confirm shortcut", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the platform's confirm shortcut", () => {
    const userAgent = vi.spyOn(navigator, "userAgent", "get");
    userAgent.mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    const { unmount } = render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    expect(screen.getByTestId("confirm-button")).toHaveTextContent("Ctrl+↵");
    expect(screen.getByTestId("confirm-button")).not.toHaveTextContent("⌘");
    unmount();
    resetStores();

    userAgent.mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    expect(screen.getByTestId("confirm-button")).toHaveTextContent("⌘↵");
  });
});

describe("ConfirmCommandModal — a program outside RIM", () => {
  const LONG_TEXT = `${"word ".repeat(100)}the end`;

  function makeOutsideRequest(text: string = "hello") {
    return makeRequest({
      commandId: "chat.post_message",
      toolName: "send a message",
      args: {},
      verb: null,
      initiator: "agent",
      nlDescription: undefined,
      outsideAgent: {
        name: "Claude Code",
        target: [
          { label: "Workspace", value: "Acme" },
          { label: "Channel", value: "general" },
        ],
        text,
      },
    });
  }

  /** Renders the dialog for a request and keeps its decision. */
  function open(text?: string) {
    render(<ConfirmCommandModal />);
    let decision!: Promise<{ approved: boolean }>;
    act(() => {
      decision = useConfirmationModalStore.getState().open(makeOutsideRequest(text));
    });
    return decision;
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    act(() => useConfirmationModalStore.getState().reset());
    vi.useRealTimers();
  });

  function pass(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("names who asks, what it acts on and says it came from outside RIM", () => {
    open();
    expect(screen.getByRole("heading")).toHaveTextContent("Claude Code wants to: send a message");
    expect(screen.getByTestId("initiator-chip")).toHaveTextContent("AGENT outside RIM");
    expect(screen.getByText("Workspace").nextElementSibling).toHaveTextContent("Acme");
    expect(screen.getByText("Channel").nextElementSibling).toHaveTextContent("general");
    expect(screen.getByTestId("outside-agent-warning")).toHaveTextContent(
      "This came from a program outside RIM. It may have read text meant to steer it, so check that this is what you want.",
    );
    expect(screen.queryByTestId("args-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("type-to-confirm-block")).not.toBeInTheDocument();
  });

  it("shows the whole text past where arguments are cut", () => {
    open(LONG_TEXT);
    expect(LONG_TEXT.length).toBeGreaterThan(200);
    expect(screen.getByTestId("outside-agent-text").textContent).toBe(LONG_TEXT);
  });

  it("keeps the text's lines, and can be reached by keyboard to scroll it", () => {
    open("one\n\ttwo");
    const text = screen.getByTestId("outside-agent-text");
    expect(text.textContent).toBe("one\n\ttwo");
    expect(text).toHaveClass("whitespace-pre-wrap", "max-h-64", "overflow-y-auto");
    expect(text).toHaveAttribute("tabindex", "0");
  });

  it("shows text as written, never as Markdown or HTML", () => {
    const written = "**bold** [link](https://example.com) <img src=x onerror=alert(1)>";
    open(written);
    const text = screen.getByTestId("outside-agent-text");
    expect(text.textContent).toBe(written);
    expect(text.children).toHaveLength(0);
  });

  it("shows a direction-changing character by name, and in a name it acts on", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      const request = makeOutsideRequest("safe\u202Etxt.exe");
      request.outsideAgent!.target[1].value = "gen\u202Eeral";
      void useConfirmationModalStore.getState().open(request);
    });
    expect(screen.getByTestId("outside-agent-text").textContent).toBe("safe⟦U+202E⟧txt.exe");
    expect(screen.getByText("gen⟦U+202E⟧eral")).toBeInTheDocument();
  });

  describe("for a plugin command", () => {
    const LONG = "x ".repeat(500);

    function openPluginCommand(args: Record<string, unknown>) {
      render(<ConfirmCommandModal />);
      act(() => {
        void useConfirmationModalStore.getState().open(
          makeRequest({
            commandId: "list",
            toolName: "run a plugin command",
            args: {},
            verb: null,
            initiator: "agent",
            nlDescription: undefined,
            outsideAgent: {
              name: "Claude Code",
              target: [
                { label: "Plugin", value: "Pods" },
                { label: "Command", value: "list" },
              ],
              pluginWords: { title: "List\u202E pods", description: "Lists\u200B them" },
              args,
            },
          }),
        );
      });
    }

    it("marks the title and description as the plugin's words, with invisibles shown", () => {
      openPluginCommand({});
      const words = screen.getByTestId("outside-agent-plugin-words");
      expect(words).toHaveTextContent("In the plugin's words:");
      expect(words).toHaveTextContent("List⟦U+202E⟧ pods");
      expect(words).toHaveTextContent("Lists⟦U+200B⟧ them");
    });

    it("shows each argument whole, in a box that scrolls, with invisibles shown", () => {
      openPluginCommand({ long: LONG, "na\u202Eme": "va\u202Elue", nested: { deep: [1, 2] } });
      const box = screen.getByRole("group", { name: "The arguments" });
      expect(box).toHaveClass("overflow-y-auto");
      expect(box.textContent).toContain(LONG);
      expect(box).toHaveTextContent("na⟦U+202E⟧me");
      expect(box).toHaveTextContent("va⟦U+202E⟧lue");
      expect(box).toHaveTextContent('{"deep":[1,2]}');
      expect(screen.getByTestId("outside-agent-args-size")).toHaveTextContent(/\d+ characters$/);
    });

    it("masks an argument that looks like a secret", () => {
      openPluginCommand({ api_key: "the-secret-value", other: "ghp_abcdef" });
      const box = screen.getByTestId("outside-agent-args");
      expect(box.textContent).not.toContain("the-secret-value");
      expect(box.textContent).not.toContain("ghp_abcdef");
      expect(box).toHaveTextContent("[REDACTED]");
    });

    it("says when there are no arguments", () => {
      openPluginCommand({});
      expect(screen.getByTestId("outside-agent-args")).toHaveTextContent("(no arguments)");
    });

    it("does not offer to send, and waits a second like any outside request", () => {
      openPluginCommand({});
      const confirm = screen.getByTestId("confirm-button");
      expect(confirm).toBeDisabled();
      expect(confirm).not.toHaveTextContent("Send");
      pass(1000);
      expect(confirm).toBeEnabled();
    });
  });

  it("leaves what is confirmed exact in the request", () => {
    open("safe\u202Etxt");
    expect(useConfirmationModalStore.getState().request?.outsideAgent?.text).toBe("safe\u202Etxt");
  });

  it("keeps Confirm disabled for a second, then enables it", () => {
    open();
    const confirm = screen.getByTestId("confirm-button");
    expect(confirm).toBeDisabled();
    pass(999);
    expect(confirm).toBeDisabled();
    pass(1);
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveTextContent("Send");
  });

  it("says how long the text is", () => {
    open("one\ntwo");
    expect(screen.getByTestId("outside-agent-text-size")).toHaveTextContent(
      "2 lines, 7 characters",
    );
  });

  it("does nothing for a click or Ctrl+Enter in the first second", async () => {
    const decision = open();
    const settled = vi.fn();
    void decision.then(settled);
    fireEvent.click(screen.getByTestId("confirm-button"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).not.toHaveBeenCalled();
    expect(useConfirmationModalStore.getState().request).not.toBeNull();
  });

  it("confirms by click or Ctrl+Enter after the second", async () => {
    const byClick = open();
    pass(1_000);
    fireEvent.click(screen.getByTestId("confirm-button"));
    await expect(byClick).resolves.toEqual({ approved: true });

    let byKey!: Promise<{ approved: boolean }>;
    act(() => {
      byKey = useConfirmationModalStore.getState().open(makeOutsideRequest());
    });
    pass(1_000);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ctrlKey: true });
    await expect(byKey).resolves.toEqual({ approved: true });
  });

  it("makes a new request wait its own second", () => {
    open();
    pass(1_000);
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
    act(() => {
      void useConfirmationModalStore.getState().open(makeOutsideRequest());
    });
    expect(screen.getByTestId("confirm-button")).toBeDisabled();
    pass(1_000);
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
  });

  it("does not make a person's own dialog wait", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore
        .getState()
        .open(makeRequest({ initiator: "user", verb: null }));
    });
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
    expect(screen.queryByTestId("outside-agent-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("outside-agent-expiry")).not.toBeInTheDocument();
  });

  it("does not make the built-in agent's dialog wait", () => {
    render(<ConfirmCommandModal />);
    act(() => {
      void useConfirmationModalStore.getState().open(makeRequest());
    });
    expect(screen.getByTestId("confirm-button")).toBeEnabled();
  });

  it("discards on Escape, even in the first second", async () => {
    const decision = open();
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(decision).resolves.toEqual({ approved: false });
  });

  it("does not close from the backdrop", () => {
    open();
    fireEvent.click(screen.getByTestId("confirm-cmd-backdrop"));
    expect(useConfirmationModalStore.getState().request).not.toBeNull();
  });

  it("starts focus on Close", () => {
    open();
    pass(50);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("counts down each second and ends at the expiry", async () => {
    const decision = open();
    expect(screen.getByTestId("outside-agent-expiry")).toHaveTextContent("Expires in 60 s");
    pass(1_000);
    expect(screen.getByTestId("outside-agent-expiry")).toHaveTextContent("Expires in 59 s");
    pass(59_000);
    await expect(decision).resolves.toEqual({ approved: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
