import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../shared/toast";
import { logger } from "../logger";
import {
  isSubscriptionLimit,
  reportSubscriptionLimit,
  SUBSCRIPTION_LIMIT_TOAST_ID,
} from "./subscriptionErrors";

const refused = [
  { message: "too many subscriptions", extensions: { code: "TOO_MANY_SUBSCRIPTIONS", limit: 8 } },
];

describe("subscription limit", () => {
  afterEach(() => vi.clearAllMocks());

  it("tells a TOO_MANY_SUBSCRIPTIONS refusal from other subscription errors", () => {
    expect(isSubscriptionLimit(refused)).toBe(true);
    expect(isSubscriptionLimit(refused[0])).toBe(true);
    expect(isSubscriptionLimit([{ message: "boom", extensions: { code: "INTERNAL" } }])).toBe(
      false,
    );
    expect(isSubscriptionLimit(new Event("error"))).toBe(false);
    expect(isSubscriptionLimit(null)).toBe(false);
  });

  it("logs a refusal once per subscription and raises one notice each time", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    expect(reportSubscriptionLimit("[test] events", refused)).toBe(true);
    expect(reportSubscriptionLimit("[test] events", refused)).toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenLastCalledWith(
      "Some live updates are off",
      expect.objectContaining({ id: SUBSCRIPTION_LIMIT_TOAST_ID }),
    );
  });

  it("leaves other errors to the caller", () => {
    expect(reportSubscriptionLimit("[test] other", [{ message: "boom" }])).toBe(false);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
