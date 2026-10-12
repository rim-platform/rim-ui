import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { limitsQueryClient, renderWithLimits } from "../../../test/limits";
import { renderWithServerInfo } from "../../../test/serverInfo";
import { formatTime } from "../../../shared/utils/formatTime";
import { ProbationBanner } from "./ProbationBanner";

const NOW = new Date("2026-10-12T12:00:00Z").getTime();
const HALF_HOUR = 30 * 60_000;

/** Answers `MeProbation` with `probationEndsAt` and records each time it is asked. */
function serveProbation(probationEndsAt: string | null) {
  const asked = vi.fn();
  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as { operationName?: string };
      if (body.operationName !== "MeProbation") return undefined;
      asked();
      return HttpResponse.json({ data: { me: { id: "user-me", probationEndsAt } } });
    }),
  );
  return asked;
}

describe("ProbationBanner", () => {
  afterEach(() => vi.useRealTimers());

  describe("on a fake clock", () => {
    beforeEach(() => vi.useFakeTimers({ now: NOW }));

    it("says when the account leaves probation, and goes away then without a reload", () => {
      const endsAt = new Date(NOW + HALF_HOUR).toISOString();
      renderWithLimits(<ProbationBanner />, {}, endsAt);

      expect(screen.getByTestId("probation-banner")).toHaveTextContent(
        `New account: you can create workspaces and message strangers after ${formatTime(endsAt)}.`,
      );

      act(() => vi.advanceTimersByTime(HALF_HOUR - 1000));
      expect(screen.getByTestId("probation-banner")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByTestId("probation-banner")).not.toBeInTheDocument();
    });

    it("shows nothing for a probation that already ended", () => {
      renderWithLimits(<ProbationBanner />, {}, new Date(NOW - 1000).toISOString());
      expect(screen.queryByTestId("probation-banner")).not.toBeInTheDocument();
    });
  });

  it("asks the server when the account's probation ends", async () => {
    const endsAt = new Date(Date.now() + HALF_HOUR).toISOString();
    const asked = serveProbation(endsAt);
    render(
      <QueryClientProvider client={limitsQueryClient({ probationHours: 24 })}>
        <ProbationBanner />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("probation-banner")).toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a server without probation, or one too old to report limits", async () => {
    const asked = serveProbation(new Date(Date.now() + HALF_HOUR).toISOString());
    renderWithLimits(<ProbationBanner />, { workspacesPerUser: 5 });
    renderWithServerInfo(<ProbationBanner />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByTestId("probation-banner")).not.toBeInTheDocument();
  });
});
