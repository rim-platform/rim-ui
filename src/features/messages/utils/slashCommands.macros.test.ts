import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMacro: vi.fn(),
  runLegacyMacro: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../macros/runtime/runMacro", () => ({ runMacro: mocks.runMacro }));
vi.mock("../../macros/runtime/runLegacyMacro", () => ({ runLegacyMacro: mocks.runLegacyMacro }));
vi.mock("../../../shared/toast", () => ({ toast: mocks.toast }));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { AccountMacro } from "../../macros/api/useAccountMacros";
import { isSlashCommand } from "./slashCommands";

const STANDUP: AccountMacro = {
  id: "user.standup",
  title: "Morning Standup",
  description: "",
  isEnabled: true,
  aiCallable: false,
  nlDescription: "",
  intentSamples: [],
  steps: [],
};

function typeMacro(name: string) {
  isSlashCommand("/macro")?.handler?.(name);
}

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("/macro where the home server keeps the person's macros", () => {
  it("runs the macro whose title matches, whatever the letter case", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
    queryClient.setQueryData(queryKeys.accountMacros, [STANDUP]);

    typeMacro("morning standup");

    await vi.waitFor(() => expect(mocks.runMacro).toHaveBeenCalledWith("user.standup"));
    expect(mocks.runLegacyMacro).not.toHaveBeenCalled();
  });

  it("says when no macro has that title", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, { capabilities: ["account_macros"] });
    queryClient.setQueryData(queryKeys.accountMacros, [STANDUP]);

    typeMacro("Evening");

    await vi.waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('Macro not found: "Evening"'),
    );
    expect(mocks.runMacro).not.toHaveBeenCalled();
  });
});
