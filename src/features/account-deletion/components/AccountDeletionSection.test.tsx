import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { DELETION_UNSUPPORTED, deletionQueryClient } from "../../../test/accountDeletion";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useAuthStore } from "../../auth/state/useAuthStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
// The server is known by another host than the page it serves.
vi.mock("../../relay/state/serverOrigin", () => ({ useServerHost: () => "relay.example" }));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { deletionDateText } from "../api/accountDeletion";
import { AccountDeletionSection } from "./AccountDeletionSection";

const SCHEDULED = "2026-10-26T12:00:00Z";
const onOpenWorkspaceSettings = vi.fn();

function renderSection(qc: QueryClient = deletionQueryClient()) {
  render(
    <QueryClientProvider client={qc}>
      <AccountDeletionSection username="me" onOpenWorkspaceSettings={onOpenWorkspaceSettings} />
    </QueryClientProvider>,
  );
  return qc;
}

const confirmField = () => screen.getByLabelText(/Type your username/);
const deleteButton = () => screen.getByRole("button", { name: "Delete account" });

describe("AccountDeletionSection", () => {
  beforeEach(() => {
    requestMock.mockReset();
    onOpenWorkspaceSettings.mockReset();
  });

  afterEach(() => useAuthStore.setState({ session: null }));

  it("explains the deletion and sends it once the username is typed back", async () => {
    routeRequests(requestMock, {
      "mutation RequestAccountDeletion": () => ({
        requestAccountDeletion: { scheduledFor: SCHEDULED },
      }),
    });
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText("Deletes your account on relay.example.")).toBeInTheDocument();
    expect(screen.getByText(/After a grace period the server sets/)).toBeInTheDocument();
    expect(screen.getByText(/key identity cannot be used/)).toBeInTheDocument();
    expect(screen.getByText(/must be handed over or deleted first/)).toBeInTheDocument();
    expect(deleteButton()).toBeDisabled();

    await user.type(confirmField(), "someone-else");
    expect(deleteButton()).toBeDisabled();
    await user.clear(confirmField());
    await user.type(confirmField(), "me ");
    await user.click(deleteButton());

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation RequestAccountDeletion")).toEqual([
        { input: { confirmUsername: "me" } },
      ]),
    );
    expect(await screen.findByTestId("account-deletion-pending")).toHaveTextContent(
      `Your account will be deleted on ${deletionDateText(SCHEDULED)}.`,
    );
  });

  it("shows the server's refusal for an owned workspace inline, linking to Workspace settings", async () => {
    const message =
      "transfer or delete your workspaces first: you own Acme, which other people are members of";
    routeRequests(requestMock, {
      "mutation RequestAccountDeletion": () => {
        throw graphqlError("VALIDATION", message);
      },
    });
    const user = userEvent.setup();
    renderSection();

    await user.type(confirmField(), "me");
    await user.click(deleteButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    await user.click(screen.getByRole("button", { name: "Open Workspace settings" }));
    expect(onOpenWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("account-deletion-pending")).not.toBeInTheDocument();
  });

  it("sends a person whose account another server holds to their relay", async () => {
    routeRequests(requestMock, {
      "mutation RequestAccountDeletion": () => {
        throw graphqlError(
          "FORBIDDEN",
          "a person from another server deletes their account at their relay",
        );
      },
    });
    const user = userEvent.setup();
    renderSection();

    await user.type(confirmField(), "me");
    await user.click(deleteButton());

    const notice = await screen.findByTestId("account-deletion-remote");
    expect(notice).toHaveTextContent("Manage your account at your relay");
    expect(notice).toHaveTextContent("relay.example");
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("shows a pending deletion with its date and cancels it", async () => {
    routeRequests(requestMock, {
      "mutation CancelAccountDeletion": () => ({ cancelAccountDeletion: true }),
    });
    const user = userEvent.setup();
    renderSection(deletionQueryClient({ supported: true, scheduledFor: SCHEDULED }));

    expect(screen.getByTestId("account-deletion-pending")).toHaveTextContent(
      deletionDateText(SCHEDULED),
    );
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation CancelAccountDeletion")).toHaveLength(1),
    );
    expect(await screen.findByRole("button", { name: "Delete account" })).toBeInTheDocument();
    expect(screen.queryByTestId("account-deletion-pending")).not.toBeInTheDocument();
  });

  it("shows nothing on a server without account deletion", () => {
    renderSection(deletionQueryClient(DELETION_UNSUPPORTED));
    expect(screen.queryByText("Delete account")).not.toBeInTheDocument();
  });
});
