import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  isTauri: () => true,
}));

vi.mock("../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { queryClient } from "../../core/query/queryClient";
import { toast } from "../../shared/toast";
import { useAuthStore } from "../auth/state/useAuthStore";
import { currentCacheAccount } from "../messages/api/messageCache";
import { archiveDevicesQueryKey } from "./api/historyArchive";
import { backUpHistoryNow } from "./backUpNow";
import { describeExport } from "./components/archiveReports";

const status = {
  configured: true,
  provider: "localFolder",
  folder: "/home/ada/Dropbox/RIM",
  archiveId: "11111111-2222-4333-8444-555555555555",
  deviceId: "0f0e0d0c-aaaa-4bbb-8ccc-123456789abc",
  unlocked: true,
};

function backend(answers: Record<string, unknown>) {
  mockInvoke.mockImplementation(async (command: string) => {
    if (!(command in answers)) throw new Error(`unexpected command ${command}`);
    return answers[command];
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  useAuthStore.setState({ session: { userId: "ada" } } as never);
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("backUpHistoryNow", () => {
  it("says how the back-up went and reads the archive's devices again", async () => {
    const written = { segments: 2, messages: 40, conversations: 3 };
    backend({ history_archive_status: status, history_archive_export: written });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await backUpHistoryNow();

    expect(toast.success).toHaveBeenCalledWith(describeExport(written));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: archiveDevicesQueryKey(currentCacheAccount()!),
    });
  });

  it("says to unlock the archive first while it is locked here", async () => {
    backend({ history_archive_status: { ...status, unlocked: false } });

    await backUpHistoryNow();

    expect(toast.info).toHaveBeenCalledWith(
      "Unlock the history archive in Settings > History first.",
    );
    expect(mockInvoke).not.toHaveBeenCalledWith("history_archive_export", expect.anything());
  });
});
