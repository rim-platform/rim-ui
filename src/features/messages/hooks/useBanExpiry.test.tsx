import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { activeBan, banLabel, useBanExpiry } from "./useBanExpiry";

afterEach(() => vi.useRealTimers());

it("refreshes workspace author status and clears the marker when a temporary ban expires", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const author = { banned: true, bannedUntil: "2026-10-23T10:00:01Z" };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  renderHook(() => useBanExpiry("workspace", [author]), { wrapper });
  expect(activeBan(author)).toBe(true);
  expect(banLabel(author)).toContain("banned until");
  act(() => vi.advanceTimersByTime(1002));
  expect(activeBan(author)).toBe(false);
  expect(banLabel(author)).toBe("");
  expect(invalidate).toHaveBeenCalled();
});
