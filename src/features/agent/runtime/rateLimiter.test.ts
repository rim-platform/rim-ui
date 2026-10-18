import { describe, it, expect, beforeEach, vi } from "vitest";

// The module exports a singleton; each test resets it and exercises it directly.
import { agentRateLimiter } from "./rateLimiter";

describe("AgentRateLimiter", () => {
  beforeEach(() => {
    // Reset the private fields with Object.assign, which needs no `any` cast.
    Object.assign(agentRateLimiter, {
      runTimestamps: [],
      sessionCost: 0,
    } as unknown);
  });

  it("allows a run when under rate limit", () => {
    const result = agentRateLimiter.canRun();
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks after exceeding max runs per minute", () => {
    for (let i = 0; i < 10; i++) {
      agentRateLimiter.recordRun();
    }
    const result = agentRateLimiter.canRun();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Rate limit exceeded");
  });

  it("allows runs after timestamps expire from the window", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) {
      agentRateLimiter.recordRun();
    }
    expect(agentRateLimiter.canRun().allowed).toBe(false);

    // Advance time past the 60-second window
    vi.advanceTimersByTime(61_000);
    expect(agentRateLimiter.canRun().allowed).toBe(true);

    vi.useRealTimers();
  });

  it("tracks session cost via addCost", () => {
    agentRateLimiter.addCost(1_000_000, 500_000, 3.0, 15.0);
    // Cost = (1M * 3.0) / 1M + (500K * 15.0) / 1M = 3.0 + 7.5 = 10.5
    expect(agentRateLimiter.getSessionCost()).toBeCloseTo(10.5);
  });

  it("blocks when session cost exceeds limit", () => {
    // Default limit is $5.00
    agentRateLimiter.addCost(1_000_000, 500_000, 3.0, 15.0);
    const result = agentRateLimiter.canRun();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Session cost limit reached");
  });

  it("addCost accumulates across multiple calls", () => {
    agentRateLimiter.addCost(100_000, 0, 10.0, 0);
    agentRateLimiter.addCost(100_000, 0, 10.0, 0);
    // Each call adds (100K * 10) / 1M = 1.0, total = 2.0
    expect(agentRateLimiter.getSessionCost()).toBeCloseTo(2.0);
  });

  it("recordRun adds a timestamp", () => {
    agentRateLimiter.recordRun();
    agentRateLimiter.recordRun();
    agentRateLimiter.recordRun();
    // Still under the limit of 10
    expect(agentRateLimiter.canRun().allowed).toBe(true);
  });

  it("getSessionCost returns 0 initially", () => {
    expect(agentRateLimiter.getSessionCost()).toBe(0);
  });
});
