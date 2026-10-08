import { describe, it, expect } from "vitest";

import type { MessageItem } from "../../../core/types/messages";
import { cachedPageToMessagesPage, currentCacheAccount } from "./messageCache";

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
