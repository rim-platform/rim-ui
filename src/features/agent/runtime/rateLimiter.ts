interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

class AgentRateLimiter {
  private runTimestamps: number[] = [];
  private sessionCost = 0;

  private maxRunsPerMinute = 10;
  private maxCostPerSession = 5.0; // USD

  canRun(): RateLimitResult {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Clean up old timestamps
    this.runTimestamps = this.runTimestamps.filter((t) => t > windowStart);

    if (this.runTimestamps.length >= this.maxRunsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: maximum ${this.maxRunsPerMinute} runs per minute. Please wait a moment.`,
      };
    }

    if (this.sessionCost >= this.maxCostPerSession) {
      return {
        allowed: false,
        reason: `Session cost limit reached ($${this.sessionCost.toFixed(2)} / $${this.maxCostPerSession.toFixed(2)}). Restart the app to reset.`,
      };
    }

    return { allowed: true };
  }

  recordRun(): void {
    this.runTimestamps.push(Date.now());
  }

  addCost(
    inputTokens: number,
    outputTokens: number,
    inputPrice: number,
    outputPrice: number,
  ): void {
    // Prices are per million tokens
    const cost = (inputTokens * inputPrice) / 1_000_000 + (outputTokens * outputPrice) / 1_000_000;
    this.sessionCost += cost;
  }

  getSessionCost(): number {
    return this.sessionCost;
  }
}

export const agentRateLimiter = new AgentRateLimiter();
