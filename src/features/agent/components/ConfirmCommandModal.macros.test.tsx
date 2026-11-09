import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { AccountMacro } from "../../macros/api/useAccountMacros";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../state/confirmationModalStore";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn(() => new Promise(() => {})) },
}));

import { ConfirmCommandModal } from "./ConfirmCommandModal";

const WRAP_UP: AccountMacro = {
  id: "user.wrap-up",
  title: "Wrap up",
  description: "",
  isEnabled: true,
  aiCallable: true,
  nlDescription: "",
  intentSamples: [],
  steps: [
    { commandId: "chat.post_message", args: { text: "Done for today", token: "s3cret" }, ask: [] },
    { commandId: "chat.mark_all_as_read", args: {}, ask: [] },
  ],
};

const POST_MESSAGE = {
  id: "chat.post_message",
  title: "Post Message",
  description: "",
  category: "Chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
  aiCallable: true,
};

function show(overrides: Partial<ConfirmationRequest>): void {
  render(<ConfirmCommandModal />);
  act(() => {
    void useConfirmationModalStore.getState().open({
      commandId: "user.wrap-up",
      toolName: "Wrap up",
      args: {},
      token: `tok-${Math.random().toString(36).slice(2, 8)}`,
      argsHash: "h",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sensitivity: CommandSensitivity.MUTATING,
      ...overrides,
    });
  });
}

beforeEach(() => {
  queryClient.clear();
  useShellStore.getState().reset();
  useConfirmationModalStore.setState({ request: null });
});

afterEach(() => {
  cleanup();
  useConfirmationModalStore.getState().reset();
  queryClient.clear();
});

describe("ConfirmCommandModal for one of the person's macros", () => {
  function keepsMacros() {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
    queryClient.setQueryData(queryKeys.accountMacros, [WRAP_UP]);
    queryClient.setQueryData(queryKeys.macroStepCommands, [POST_MESSAGE]);
  }

  it("lists the steps the agent's call runs, with their fixed arguments, secrets masked", () => {
    keepsMacros();
    show({});

    const steps = screen.getAllByTestId("macro-step");
    expect(steps).toHaveLength(2);
    expect(within(steps[0]).getByText("1. Post Message")).toBeInTheDocument();
    expect(within(steps[0]).getByText("Done for today")).toBeInTheDocument();
    expect(within(steps[0]).queryByText("s3cret")).not.toBeInTheDocument();
    expect(within(steps[1]).getByText("2. Mark All as Read", { exact: false })).toBeInTheDocument();
  });

  it("lists them on an outside agent's card too", () => {
    keepsMacros();
    show({
      outsideAgent: {
        name: "Helper",
        target: [{ label: "Command", value: "user.wrap-up" }],
        args: {},
      },
    });

    expect(screen.getByTestId("outside-agent-warning")).toBeInTheDocument();
    expect(screen.getAllByTestId("macro-step")).toHaveLength(2);
  });

  it("lists nothing for a built-in, or where the home server keeps no macros", () => {
    queryClient.setQueryData(queryKeys.accountMacros, [WRAP_UP]);
    show({});
    expect(screen.queryByTestId("macro-steps")).not.toBeInTheDocument();

    cleanup();
    keepsMacros();
    show({ commandId: "chat.post_message", toolName: "chat.post_message" });
    expect(screen.queryByTestId("macro-steps")).not.toBeInTheDocument();
  });
});
