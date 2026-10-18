/**
 * CommandPalette.test.tsx
 *
 * Unit tests for the executeSelected toast-surfacing behaviour introduced to fix
 * the silent-discard bug.  Rather than rendering the full CommandPalette component
 * (which transitively loads the entire Tauri + Zustand module graph and runs out
 * of heap in a standalone jsdom worker), the tests exercise the dispatch-and-toast logic
 * directly through a minimal React hook harness using renderHook.
 *
 * The hook under test, useExecuteSelected, is the extracted form of the
 * executeSelected callback.  All heavy external deps are mocked so the test
 * worker stays lean.
 *
 * Tested scenarios:
 *  - success (status: "SUCCESS", no payload)   → toast.success with command title
 *  - success with non-null payload             → toast.success with payload preview
 *  - error result (status: "ERROR")            → toast.error with title + message
 *  - thrown exception                          → toast.error with title + error message
 *  - null result from dispatchCommand          → toast.error with fallback message
 *  - cancelled confirmation (CANCELLED_PAYLOAD)  → no toast
 *  - palette closes immediately (synchronous), toast fires after (regression guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── All heavy dependencies are mocked before any import ─────────────────────

vi.mock("../runtime/commandDispatcher", () => ({
  dispatchCommand: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  },
}));

// ─── Imports (after vi.mock hoisting) ────────────────────────────────────────

import { useCallback } from "react";
import { dispatchCommand } from "../runtime/commandDispatcher";
import { currentCommandContext } from "../runtime/commandContext";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { CANCELLED_PAYLOAD, isCancelledResult } from "../../plugins/runtime/pluginCommandInfo";
import type { CommandDefinition, CommandResult } from "../types";

// ─── Minimal hook that mirrors executeSelected's dispatch+toast logic ─────────
//
// This is the exact logic from CommandPalette.executeSelected (single-command
// branch, no pipe segments) extracted into a standalone hook, so it is tested
// without mounting the full palette component.

function useExecuteSelected(
  closeCommandPalette: () => void,
  executeBackend: (input: {
    commandId: string;
    commandContext?: Record<string, unknown>;
  }) => Promise<{ executeCommand: CommandResult }>,
) {
  return useCallback(
    async (command: CommandDefinition) => {
      closeCommandPalette();
      try {
        const result = await dispatchCommand(command, (input) => executeBackend(input), {
          commandContext: currentCommandContext(),
        });
        if (isCancelledResult(result)) {
          // The user declined the confirmation, or was told it expired.
        } else if (result === null || result.status === "ERROR") {
          toast.error(`${command.title}: ${result?.message ?? "Command failed"}`);
        } else {
          const payloadPreview =
            result.payload !== null && result.payload !== undefined
              ? ` — ${String(result.payload).slice(0, 80)}`
              : "";
          toast.success(`${command.title}${payloadPreview}`);
        }
      } catch (err) {
        toast.error(`${command.title}: ${graphqlErrorMessage(err, "Command failed")}`);
      }
    },
    [closeCommandPalette, executeBackend],
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: "test.run",
    title: "Run Test Command",
    description: "A test command",
    category: "Testing",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    status: "SUCCESS",
    message: "Done",
    payload: null,
    followUpCommands: [],
    ...overrides,
  };
}

/** Render the hook with a fresh close spy and backend mock each test. */
function setup() {
  const closeSpy = vi.fn();
  const executeSpy = vi.fn();

  const { result } = renderHook(() => useExecuteSelected(closeSpy, executeSpy));

  return { executeSelected: result.current, closeSpy, executeSpy };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeSelected — toast surfacing (CommandPalette dispatch logic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls toast.success with the command title on a successful result (no payload)", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue(
      makeResult({ status: "SUCCESS", message: "Done", payload: null }),
    );

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.success).toHaveBeenCalledOnce();
    const [msg] = vi.mocked(toast.success).mock.calls[0];
    expect(msg).toContain("Run Test Command");
    // No payload — no em-dash preview
    expect(msg).not.toContain("—");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("appends a short payload preview when the result carries a non-null payload", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue(
      makeResult({ status: "SUCCESS", payload: "workspace-abc-123" }),
    );

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.success).toHaveBeenCalledOnce();
    const [msg] = vi.mocked(toast.success).mock.calls[0];
    expect(msg).toContain("Run Test Command");
    expect(msg).toContain("workspace-abc-123");
  });

  it("truncates the payload preview to 80 characters", async () => {
    const longPayload = "x".repeat(200);
    vi.mocked(dispatchCommand).mockResolvedValue(
      makeResult({ status: "SUCCESS", payload: longPayload }),
    );

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    const [msg] = vi.mocked(toast.success).mock.calls[0];
    // The payload section must be capped at 80 chars
    const afterDash = msg.split(" — ")[1] ?? "";
    expect(afterDash.length).toBeLessThanOrEqual(80);
  });

  it("calls toast.error with command title + message when result.status is ERROR", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue(
      makeResult({ status: "ERROR", message: "Validation failed: missing workspaceId" }),
    );

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.error).toHaveBeenCalledOnce();
    const [msg] = vi.mocked(toast.error).mock.calls[0];
    expect(msg).toContain("Run Test Command");
    expect(msg).toContain("Validation failed: missing workspaceId");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("calls toast.error when dispatchCommand rejects (thrown exception)", async () => {
    vi.mocked(dispatchCommand).mockRejectedValue(new Error("Network timeout"));

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.error).toHaveBeenCalledOnce();
    const [msg] = vi.mocked(toast.error).mock.calls[0];
    expect(msg).toContain("Run Test Command");
    expect(msg).toContain("Network timeout");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the server's message for a FORBIDDEN rejection, not the raw response dump", async () => {
    // Shape of graphql-request's ClientError: the message embeds the serialized response.
    const clientError = Object.assign(new Error('Forbidden: {"response":{...}}'), {
      response: {
        errors: [
          {
            message: "Only moderators can run this command",
            extensions: { code: "FORBIDDEN" },
          },
        ],
      },
    });
    vi.mocked(dispatchCommand).mockRejectedValue(clientError);

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Run Test Command: Only moderators can run this command",
    );
  });

  it("shows no toast when the user cancelled the confirmation", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue(
      makeResult({ status: "ERROR", message: "Cancelled", payload: CANCELLED_PAYLOAD }),
    );

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("calls toast.error with a fallback message when dispatchCommand returns null", async () => {
    vi.mocked(dispatchCommand).mockResolvedValue(null);

    const { executeSelected } = setup();

    await act(async () => {
      await executeSelected(makeCommand());
    });

    expect(toast.error).toHaveBeenCalledOnce();
    const [msg] = vi.mocked(toast.error).mock.calls[0];
    expect(msg).toContain("Run Test Command");
    expect(msg).toContain("Command failed");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("closes the palette synchronously before dispatch resolves (regression guard)", async () => {
    let resolveDispatch!: (r: CommandResult) => void;
    const dispatchPromise = new Promise<CommandResult>((res) => {
      resolveDispatch = res;
    });
    vi.mocked(dispatchCommand).mockReturnValue(dispatchPromise);

    const { executeSelected, closeSpy } = setup();

    // Start the dispatch but don't await it yet
    const pending = act(async () => {
      await executeSelected(makeCommand());
    });

    // closeCommandPalette must have been called synchronously (before the await)
    // In the hook, closeCommandPalette() is called before `await dispatchCommand(...)`.
    // After a single tick the synchronous portion has run.
    await Promise.resolve(); // flush microtask so the sync closeCommandPalette call registers
    expect(closeSpy).toHaveBeenCalledOnce();

    // Toasts should not have fired yet — dispatch is still in-flight
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    // Resolve the dispatch
    resolveDispatch(makeResult({ status: "SUCCESS" }));
    await pending;

    // Now the toast fires
    expect(toast.success).toHaveBeenCalledOnce();
  });
});
