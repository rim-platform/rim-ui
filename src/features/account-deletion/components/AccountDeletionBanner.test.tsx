import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { deletionQueryClient } from "../../../test/accountDeletion";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";
import { useAuthStore } from "../../auth/state/useAuthStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { deletionDateText } from "../api/accountDeletion";
import { AccountDeletionBanner } from "./AccountDeletionBanner";

const SCHEDULED = "2026-10-26T12:00:00Z";

function renderBanner(qc: QueryClient) {
  render(
    <QueryClientProvider client={qc}>
      <AccountDeletionBanner />
    </QueryClientProvider>,
  );
}

describe("AccountDeletionBanner", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
  });

  afterEach(() => useAuthStore.setState({ session: null }));

  it("says when the account is deleted and cancels the deletion", async () => {
    routeRequests(requestMock, {
      "mutation CancelAccountDeletion": () => ({ cancelAccountDeletion: true }),
    });
    const user = userEvent.setup();
    renderBanner(deletionQueryClient({ supported: true, scheduledFor: SCHEDULED }));

    expect(screen.getByTestId("account-deletion-banner")).toHaveTextContent(
      `Your account will be deleted on ${deletionDateText(SCHEDULED)}.`,
    );
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }));

    await waitFor(() =>
      expect(screen.queryByTestId("account-deletion-banner")).not.toBeInTheDocument(),
    );
    expect(callsTo(requestMock, "mutation CancelAccountDeletion")).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith("Your account will not be deleted");
  });

  it("shows nothing while no deletion is pending", () => {
    renderBanner(deletionQueryClient());
    expect(screen.queryByTestId("account-deletion-banner")).not.toBeInTheDocument();
  });
});
