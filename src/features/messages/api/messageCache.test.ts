import { describe, it, expect, vi } from "vitest";

import type { MessageItem } from "../../../core/types/messages";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { toast } from "../../../shared/toast";
import { cachedPageToMessagesPage, currentCacheAccount, trackConversation } from "./messageCache";

vi.mock("../../../core/tauri/safeInvoke", () => ({ safeInvoke: vi.fn() }));
vi.mock("../../../shared/toast", () => ({ toast: { warning: vi.fn() } }));

function item(id: string, sentAt: string): MessageItem {
  return { id, sentAt } as MessageItem;
}

describe("cachedPageToMessagesPage", () => {
  it("continues older from the page's oldest message", () => {
    const page = cachedPageToMessagesPage({
      items: [item("m1", "2026-10-08T10:00:00Z"), item("m2", "2026-10-08T10:00:01Z")],
      hasOlder: true,
    });
    expect(page.next).toEqual({ sentAt: "2026-10-08T10:00:00Z", messageId: "m1" });
    expect(page.pageInfo).toEqual({ hasNext: true, hasPrev: false });
  });

  it("ends when nothing older is cached", () => {
    const page = cachedPageToMessagesPage({
      items: [item("m1", "2026-10-08T10:00:00Z")],
      hasOlder: false,
    });
    expect(page.next).toBeNull();
    expect(page.pageInfo.hasNext).toBe(false);
  });
});

describe("currentCacheAccount", () => {
  it("is null outside the desktop app", () => {
    expect(currentCacheAccount()).toBeNull();
  });
});

describe("cache key errors", () => {
  it("are shown once per run, not only logged", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({
      ok: false,
      error: {
        kind: "backend_error",
        code: "CACHE_KEY",
        message: "cache key unavailable: the desktop keyring service is not available",
      },
    });
    const account = { endpoint: "http://localhost:8080/api", userId: "u1" };

    await trackConversation(account, "w1", "c1");
    await trackConversation(account, "w1", "c2");

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("Local message cache is off", {
      description: "cache key unavailable: the desktop keyring service is not available",
    });
  });
});
