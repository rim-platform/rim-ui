import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../auth/components/SignOutOtherSessions", () => ({
  SignOutOtherSessions: () => null,
}));
vi.mock("../../account-deletion/components/AccountDeletionSection", () => ({
  AccountDeletionSection: () => null,
}));

import { queryKeys } from "../../../core/query/keys";
import { createTestQueryClient } from "../../../test/utils";
import { useAppDialogStore } from "../../commands/state/useAppDialogStore";
import { AccountSettings } from "./AccountSettings";

function renderAccount(statusText: string | null) {
  const qc = createTestQueryClient();
  qc.setQueryDefaults(queryKeys.me, { staleTime: Infinity, gcTime: Infinity });
  qc.setQueryData(queryKeys.me, { id: "u-1", username: "ada", statusText });
  render(
    <QueryClientProvider client={qc}>
      <AccountSettings onNavigateToWorkspace={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  useAppDialogStore.getState().close();
});

describe("AccountSettings", () => {
  it("sets the status with people.set_status, which opens the status dialog", async () => {
    renderAccount(null);
    fireEvent.click(await screen.findByRole("button", { name: "Set status" }));
    await waitFor(() => expect(useAppDialogStore.getState().dialog).toBe("status"));
  });

  it("changes a set status the same way", async () => {
    renderAccount("Out today");
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    await waitFor(() => expect(useAppDialogStore.getState().dialog).toBe("status"));
  });

  it("signs out with app.sign_out, which opens the sign-out dialog", async () => {
    renderAccount(null);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out..." }));
    await waitFor(() => expect(useAppDialogStore.getState().dialog).toBe("signOut"));
  });
});
